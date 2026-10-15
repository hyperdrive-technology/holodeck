/**
 * Cyclic dataflow scheduler: runs a compiled `FlowPlan` scan by scan.
 *
 * One scan:
 *   1. read the clock (`nowMs`, `dtMs`);
 *   2. main phase: evaluate every non-delay node in topological order; each
 *      node reads the current values of the outputs wired to it (unconnected
 *      inputs read their default) and its outputs are updated at once;
 *   3. quality pass: give every main-phase output its quality (below);
 *   4. delay phase: evaluate every `flow.delay` node against the values of
 *      step 2, then commit all their outputs (and qualities) together;
 *   5. publish: changed outputs, changed faults, and `signal.out` values that
 *      changed (`writes`), to every listener, synchronously.
 *
 * A node whose `evaluate` throws or returns something invalid is *faulted*
 * for that scan: none of its outputs or state change, its outputs' quality
 * becomes `bad`, and its `$fault` source carries the message. The other nodes
 * keep running; the next successful scan clears the fault.
 *
 * ## Quality: the safety contract (README "Quality and the write gate")
 *
 * A value reaches `signal.out` only if every external reading that influenced
 * it, along any path (delays and loop state included), was `good` when it was
 * consumed, and no node on that path faulted (or substituted a missing value)
 * since — with one deliberate exception: a feedback loop's *state* may survive
 * a non-good period (PLC latch behaviour), but nothing read from the loop is
 * `good` until every input the loop takes from outside has been `good` (and no
 * node on the loop faulted) for at least one whole scan after the disturbance.
 *
 * Rules that implement it:
 *   - a node outside any loop: worst quality (good < uncertain < bad) of the
 *     readings it consumed this scan; `bad` when faulted. Constants and
 *     unconnected inputs read `good`; a substituted conversion reads `bad`.
 *     Block state (`initialState`/`state`) is the one-node case of the loop
 *     exception: the outputs follow this scan's readings only.
 *   - a `flow.delay` outside any loop is a time shift: it carries the quality
 *     its input had, one scan later, with the value.
 *   - a feedback loop (a cycle through delays) computes one *health* per scan:
 *     the worst of every reading its nodes take from outside the loop, `bad`
 *     for any fault or substitution on the loop, `uncertain` for a `null` read
 *     inside the loop. Readings *inside* the loop count as `good` otherwise.
 *     Every non-delay node on the loop publishes this scan's health; a loop
 *     delay publishes the health of the scan that stored its value.
 *   - `signal.out` writes only a `good`, non-null reading, holds otherwise, and
 *     writes the current value again when its reading turns good.
 *
 * Why loop health, and not the alternatives (re-reviews of #62):
 *   - v1 carried quality through every delay: one non-good scan circulated in
 *     a loop forever and every latch, seal-in or integrator stopped writing
 *     until the next deploy.
 *   - v2 made a loop delay `good` whenever it held a value: its readers then
 *     saw `good` for values built only from bad readings (an integrator's
 *     `prev.out` kept writing while its only input was bad).
 *   - Laundering only the loop's own delay edges is not enough either: in a
 *     loop through two delays a node can be fed this scan only by the loop
 *     state while a bad reading enters elsewhere on the loop and reaches it one
 *     scan later. Everything on a loop influences everything else on it, so
 *     the loop as a whole is the unit of trust: that is the health.
 *   - Of the two options proposed in review, this is (a) — a loop delay
 *     publishes the health of the scan its value was *stored* in — extended
 *     to every node on the loop, computed in a compile-time topological order
 *     of the loops (b's compile-time in-wire set) so a loop's health is known
 *     before anything downstream reads it. (b) alone, the *current* quality of
 *     the loop's in-wires, cannot be evaluated when a loop delay's output is
 *     read: the delay is a source, read before this scan's in-wires settle.
 *
 * The property test in `quality.property.test.ts` checks this contract on
 * random graphs against an independent taint simulation.
 *
 * Everything the run hands out (scans, readings, snapshots) is frozen, and it
 * never keeps objects that callers or blocks gave it: values are scalars,
 * block state is deep-copied and frozen after every `evaluate`.
 */

import type { SignalQuality } from '@holodeck/sdk';
import type { FlowEvalArgs, FlowState } from './block';
import { programOf, type FlowPlan, type Program, type ProgramLoop, type ProgramNode, type ProgramSlot } from './compile';
import {
  convertReading,
  DEFAULT_SCAN_MS,
  dict,
  errorMessage,
  FAULT_PORT,
  FLOW_LIMITS,
  isFlowValue,
  isQuality,
  isRecord,
  matchesType,
  quote,
  typeDefault,
  worstQuality,
  type FlowValue,
} from './values';

/** Same shape as the SDK's `SimProviderOptions.schedule`, so `createManualSchedule()` drives a run. */
export type FlowSchedule = (tick: () => void, intervalMs: number) => () => void;

export interface FlowRunOptions {
  /** Scan period in ms, an integer in `FLOW_LIMITS.minScanMs`–`maxScanMs` (default 100). */
  scanMs?: number;
  /** Clock in ms (default `Date.now`). A non-finite reading repeats the previous one. */
  now?: () => number;
  /** Timer for `start()` (default `setInterval`). Tests pass `createManualSchedule().schedule`. */
  schedule?: FlowSchedule;
  /** Receives errors thrown by scan listeners and by scheduled scans. Default: ignored. */
  onError?: (error: unknown) => void;
}

export interface FlowValueChange {
  readonly node: string;
  /** Output port, or `$fault`. */
  readonly port: string;
  readonly source: string;
  readonly value: FlowValue;
  readonly quality: SignalQuality;
}

/**
 * A `signal.out` write requested by this scan. Listed when the node's input
 * reading is `good` and non-null and either its value changed or the
 * previous scan's reading was not writable (recovery). Never `null`; unwired
 * `signal.out` nodes never write.
 */
export interface FlowWrite {
  readonly node: string;
  readonly connection: string;
  readonly source: string;
  readonly value: FlowValue;
}

/**
 * A `signal.out` node whose input stopped being writable this scan (quality
 * dropped below `good`, or the value became `null`). The target keeps the
 * last value written to it; consumers must drop any pending or retried write
 * of an older value. Listed once per transition, not every scan.
 */
export interface FlowHold {
  readonly node: string;
  readonly connection: string;
  readonly source: string;
  /** Quality of the input reading that caused the hold. */
  readonly quality: SignalQuality;
}

export interface FlowFault {
  readonly node: string;
  readonly message: string;
}

export interface FlowScan {
  /** 1 for the first scan of the run. */
  readonly scan: number;
  readonly nowMs: number;
  readonly dtMs: number;
  /** Outputs (and `$fault`s) whose value or quality changed in this scan. */
  readonly changes: readonly FlowValueChange[];
  readonly writes: readonly FlowWrite[];
  /** `signal.out` nodes that stopped writing in this scan. */
  readonly holds: readonly FlowHold[];
  /** Every node faulted after this scan. */
  readonly faults: readonly FlowFault[];
}

export interface FlowReading {
  readonly value: FlowValue;
  readonly quality: SignalQuality;
}

export interface FlowRunSnapshot {
  /** Scans completed (0 before the first). */
  readonly scan: number;
  /** Clock of the last scan (`undefined` before the first). */
  readonly nowMs: number | undefined;
  /** source → reading, for every source of the plan. */
  readonly values: Readonly<Record<string, FlowReading>>;
  /** node id → message, for faulted nodes. */
  readonly faults: Readonly<Record<string, string>>;
}

export type FlowRunState = 'idle' | 'running' | 'disposed';

export type FlowRunErrorCode = 'INVALID_PLAN' | 'BUSY' | 'DISPOSED' | 'UNKNOWN_NODE' | 'NOT_A_SIGNAL';

export class FlowRunError extends Error {
  constructor(
    message: string,
    readonly code: FlowRunErrorCode,
  ) {
    super(message);
    this.name = 'FlowRunError';
  }
}

export interface FlowRun {
  readonly plan: FlowPlan;
  readonly scanMs: number;
  readonly state: FlowRunState;
  /** Scans completed. */
  readonly scans: number;
  /** Clock reading of the last scan (`undefined` before the first). */
  readonly nowMs: number | undefined;
  /** Start scheduled scans (every `scanMs`). Idempotent while running. */
  start(): void;
  /** Stop scheduled scans; `start()` resumes. Idempotent. */
  stop(): void;
  /** Stop for good and drop every listener. Idempotent; `step`/`start` then throw `DISPOSED`. */
  dispose(): void;
  /**
   * Run one scan now and return it. Deterministic with an injected clock.
   * Throws `BUSY` when called from inside a scan (a listener), `DISPOSED` after `dispose()`.
   */
  step(): FlowScan;
  /**
   * New external value for a `signal.in` node (takes effect at the next scan).
   * Ignored after `dispose()`. Throws `NOT_A_SIGNAL` for other nodes and
   * `TypeError` for a value that is not a JSON scalar (strings ≤ `maxValueLength`).
   */
  setSignal(nodeId: string, value: FlowValue, quality?: SignalQuality): void;
  /**
   * Set (or clear with `null`) a fault found outside `evaluate`, e.g. a failed
   * write of a `signal.out` node. Shown on `$fault` from the next scan while
   * `evaluate` itself is healthy. Ignored after `dispose()`.
   */
  reportFault(nodeId: string, message: string | null): void;
  /** Latest reading of a source; `undefined` for a source this plan does not publish. */
  read(source: string): FlowReading | undefined;
  snapshot(): FlowRunSnapshot;
  /** Called synchronously after every scan. */
  subscribe(listener: (scan: FlowScan) => void): () => void;
}

const defaultSchedule: FlowSchedule = (tick, intervalMs) => {
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
};

/** Validate a scan period; `RangeError` otherwise. */
export function checkScanMs(value: unknown, what = 'scanMs'): number {
  if (value === undefined) return DEFAULT_SCAN_MS;
  if (!Number.isInteger(value) || (value as number) < FLOW_LIMITS.minScanMs || (value as number) > FLOW_LIMITS.maxScanMs) {
    throw new RangeError(`${what} must be an integer from ${FLOW_LIMITS.minScanMs} to ${FLOW_LIMITS.maxScanMs}`);
  }
  return value as number;
}

function optionalFunction<T>(value: T | undefined, what: string): T | undefined {
  if (value !== undefined && typeof value !== 'function') throw new TypeError(`${what} must be a function`);
  return value;
}

/**
 * Deep copy of block state into frozen JSON-like data. Throws `TypeError` for
 * anything else (functions, class instances, cycles, non-finite numbers) and
 * `RangeError` past `maxStateValues` / `maxStateDepth`. Object keys are
 * defined as own properties, so a `__proto__` key stays data.
 */
export function snapshotState(value: unknown): FlowState {
  let budget = FLOW_LIMITS.maxStateValues;
  const copy = (v: unknown, depth: number): FlowState => {
    if (--budget < 0) throw new RangeError(`state has more than ${FLOW_LIMITS.maxStateValues} values`);
    if (depth > FLOW_LIMITS.maxStateDepth) throw new RangeError(`state is nested deeper than ${FLOW_LIMITS.maxStateDepth}`);
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new TypeError('state numbers must be finite');
      return v;
    }
    if (Array.isArray(v)) {
      const length = v.length;
      if (length > budget) throw new RangeError(`state has more than ${FLOW_LIMITS.maxStateValues} values`);
      const out: FlowState[] = [];
      for (let i = 0; i < length; i++) {
        const item: unknown = v[i];
        if (item === undefined) throw new TypeError('state arrays cannot hold undefined');
        out.push(copy(item, depth + 1));
      }
      return Object.freeze(out);
    }
    if (typeof v === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new TypeError('state objects must be plain objects');
      const out: Record<string, FlowState> = {};
      for (const key of Object.keys(v)) {
        const child = (v as Record<string, unknown>)[key];
        if (child === undefined) continue;
        Object.defineProperty(out, key, { value: copy(child, depth + 1), enumerable: true, writable: false, configurable: false });
      }
      return Object.freeze(out);
    }
    throw new TypeError(`state cannot hold a ${typeof v}`);
  };
  return copy(value, 0);
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `a string of ${value.length} characters`;
  if (value === null || typeof value === 'boolean') return String(value);
  return `a ${Array.isArray(value) ? 'array' : typeof value}`;
}

type Evaluated =
  | { readonly node: ProgramNode; readonly fault: string }
  | {
      readonly node: ProgramNode;
      readonly updates: ReadonlyArray<readonly [slot: number, value: FlowValue]>;
      readonly state: FlowState;
      /** Some input read a substitute for a missing value (`convertReading` not exact). */
      readonly substituted: boolean;
    };

class Run implements FlowRun {
  readonly plan: FlowPlan;
  readonly scanMs: number;
  private readonly program: Program;
  private readonly now: () => number;
  private readonly schedule: FlowSchedule;
  private readonly onError: (error: unknown) => void;

  private readonly values: FlowValue[];
  private readonly quality: SignalQuality[];
  private readonly states: FlowState[];
  /** Fault from `evaluate`, per node. */
  private readonly faults: (string | null)[];
  /**
   * `initialState` threw: the node has no valid state, so it is never
   * evaluated and stays faulted with this message until the next deployment.
   */
  private readonly initFaults: (string | null)[];
  /** Fault reported with `reportFault`, per node. */
  private readonly external: (string | null)[];
  /** `$fault` value published by the last scan, per node. */
  private readonly published: (string | null)[];
  /** `signal.in`: quality of the external value. */
  private readonly signalQuality: SignalQuality[];
  /** Per node, this scan: some input read a substitute (set by `apply`). */
  private readonly substituted: boolean[];
  /** Per loop (`Program.loops`): health computed by this scan's quality pass. */
  private readonly loopHealth: SignalQuality[];
  /**
   * `signal.out`: input reading seen by the previous scan (`undefined` before
   * the first), and whether it was writable (good and non-null). A write is
   * due when the reading is writable and either the value changed or the
   * previous one was not writable.
   */
  private readonly lastOut: ({ value: FlowValue; writable: boolean } | undefined)[];
  /** Value/quality last listed in a scan's `changes`, per output slot (`undefined` before the first scan). */
  private readonly publishedOut: ({ value: FlowValue; quality: SignalQuality } | undefined)[];

  private readonly listeners = new Set<(scan: FlowScan) => void>();
  private scanCount = 0;
  private prevNow: number | undefined;
  private stepping = false;
  private running = false;
  private disposed = false;
  /** Bumped by every start/stop, so a tick from an older schedule is ignored. */
  private startGeneration = 0;
  private cancel: (() => void) | undefined;
  private snapshotCache: FlowRunSnapshot | undefined;

  constructor(plan: FlowPlan, options: FlowRunOptions) {
    const program = programOf(plan);
    if (!program) throw new FlowRunError('createFlowRun needs a plan made by compileFlow', 'INVALID_PLAN');
    if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new TypeError('options must be an object');
    // Read every option once; later edits to the caller's object change nothing.
    const { scanMs, now, schedule, onError } = options;
    this.scanMs = checkScanMs(scanMs);
    this.now = optionalFunction(now, 'now') ?? Date.now;
    this.schedule = optionalFunction(schedule, 'schedule') ?? defaultSchedule;
    this.onError = optionalFunction(onError, 'onError') ?? (() => {});
    this.plan = plan;
    this.program = program;

    const n = program.nodes.length;
    this.values = new Array<FlowValue>(program.slotCount);
    this.quality = new Array<SignalQuality>(program.slotCount).fill('uncertain');
    this.states = new Array<FlowState>(n).fill(null);
    this.faults = new Array<string | null>(n).fill(null);
    this.initFaults = new Array<string | null>(n).fill(null);
    this.external = new Array<string | null>(n).fill(null);
    this.published = new Array<string | null>(n).fill(null);
    this.signalQuality = new Array<SignalQuality>(n).fill('uncertain');
    this.substituted = new Array<boolean>(n).fill(false);
    this.loopHealth = new Array<SignalQuality>(program.loops.length).fill('uncertain');
    this.lastOut = new Array<{ value: FlowValue; writable: boolean } | undefined>(n).fill(undefined);
    this.publishedOut = new Array<{ value: FlowValue; quality: SignalQuality } | undefined>(program.slotCount).fill(undefined);
    for (const node of program.nodes) {
      for (const output of node.outputs) {
        if (node.role === 'delay') {
          // A delay's `initial` is configuration, as trustworthy as a constant.
          // An unset (null) initial is "unknown": readers that need a typed
          // value get a bad substitute until the delay holds a real value.
          const initial = node.plan.params.initial as FlowValue;
          this.values[output.slot] = initial;
          this.quality[output.slot] = initial === null ? 'uncertain' : 'good';
        } else {
          this.values[output.slot] = typeDefault(output.type);
        }
      }
      if (node.info.initialState) {
        try {
          this.states[node.index] = snapshotState(node.info.initialState(node.plan.params));
        } catch (error) {
          this.initFaults[node.index] = `initialState failed: ${errorMessage(error)}`;
        }
      }
    }
  }

  get state(): FlowRunState {
    return this.disposed ? 'disposed' : this.running ? 'running' : 'idle';
  }

  get scans(): number {
    return this.scanCount;
  }

  get nowMs(): number | undefined {
    return this.prevNow;
  }

  start(): void {
    this.assertLive('start');
    if (this.running) return;
    this.running = true;
    const generation = ++this.startGeneration;
    let cancel: unknown;
    try {
      cancel = this.schedule(() => {
        if (generation === this.startGeneration && this.running && !this.disposed) this.tick();
      }, this.scanMs);
    } catch (error) {
      // The schedule may have registered the tick before it threw; there is no
      // handle to cancel it, but the generation bump makes every later tick inert.
      this.running = false;
      this.startGeneration++;
      throw error;
    }
    if (typeof cancel !== 'function') {
      // Same: a registered tick without a cancel function stays inert.
      this.running = false;
      this.startGeneration++;
      throw new TypeError('schedule must return a cancel function');
    }
    // The schedule may have called stop() or dispose() synchronously.
    if (generation !== this.startGeneration) this.safeCancel(cancel as () => void);
    else this.cancel = cancel as () => void;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.startGeneration++;
    const cancel = this.cancel;
    this.cancel = undefined;
    if (cancel) this.safeCancel(cancel);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
  }

  subscribe(listener: (scan: FlowScan) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSignal(nodeId: string, value: FlowValue, quality: SignalQuality = 'good'): void {
    if (this.disposed) return;
    const node = this.program.byId.get(nodeId);
    if (!node || node.role !== 'signal-in') throw new FlowRunError(`node ${quote(nodeId)} is not a signal.in node`, 'NOT_A_SIGNAL');
    if (!isFlowValue(value)) throw new TypeError('signal value must be a JSON scalar (finite number, string, boolean or null)');
    if (typeof value === 'string' && value.length > FLOW_LIMITS.maxValueLength) {
      throw new TypeError(`signal value is longer than ${FLOW_LIMITS.maxValueLength} characters`);
    }
    if (!isQuality(quality)) throw new TypeError('quality must be good, uncertain or bad');
    this.states[node.index] = value;
    this.signalQuality[node.index] = quality;
  }

  reportFault(nodeId: string, message: string | null): void {
    if (this.disposed) return;
    const node = this.program.byId.get(nodeId);
    if (!node) throw new FlowRunError(`node ${quote(nodeId)} is not in this plan`, 'UNKNOWN_NODE');
    if (message !== null && typeof message !== 'string') throw new TypeError('message must be a string or null');
    this.external[node.index] = message === null ? null : message.slice(0, 1000);
  }

  read(source: string): FlowReading | undefined {
    const target = this.program.bySource.get(source);
    if (!target) return undefined;
    if ('slot' in target) return Object.freeze({ value: this.values[target.slot] as FlowValue, quality: this.quality[target.slot] as SignalQuality });
    return Object.freeze({ value: this.published[target.fault.index] ?? null, quality: 'good' as const });
  }

  snapshot(): FlowRunSnapshot {
    if (!this.snapshotCache) {
      const values = dict<FlowReading>();
      const faults = dict<string>();
      for (const source of this.plan.sources) values[source] = this.read(source)!;
      for (const node of this.program.nodes) {
        const fault = this.published[node.index];
        if (fault !== null && fault !== undefined) faults[node.plan.id] = fault;
      }
      this.snapshotCache = Object.freeze({
        scan: this.scanCount,
        nowMs: this.prevNow,
        values: Object.freeze(values),
        faults: Object.freeze(faults),
      });
    }
    return this.snapshotCache;
  }

  step(): FlowScan {
    this.assertLive('step');
    if (this.stepping) throw new FlowRunError('step() called from inside a scan', 'BUSY');
    this.stepping = true;
    try {
      const scan = this.runScan();
      // Listeners run while `stepping` is still set, so a listener cannot start
      // a nested scan and deliver it before the remaining listeners see this one.
      for (const listener of [...this.listeners]) {
        if (this.disposed) break;
        if (!this.listeners.has(listener)) continue;
        try {
          listener(scan);
        } catch (error) {
          this.reportError(error);
        }
      }
      return scan;
    } finally {
      this.stepping = false;
    }
  }

  // ---------------------------------------------------------------------------

  private runScan(): FlowScan {
    const raw = this.readClock();
    const nowMs = Number.isFinite(raw) ? raw : (this.prevNow ?? 0);
    const dtMs = this.prevNow === undefined ? 0 : Math.max(0, nowMs - this.prevNow);
    this.prevNow = nowMs;
    this.scanCount++;
    this.snapshotCache = undefined;

    const changes: FlowValueChange[] = [];
    const { nodes, delayStart, qualityOrder } = this.program;
    // Main phase: values. Blocks never see quality, so it is computed after.
    for (let i = 0; i < delayStart; i++) this.apply(this.evaluate(nodes[i]!, dtMs, nowMs));
    // Quality pass, upstream first (a loop as one unit; see the header).
    for (const step of qualityOrder) {
      if ('loop' in step) this.loopQuality(step.loop);
      else this.setQuality(step.node, this.outputQuality(step.node, this.readingsQuality(step.node)));
    }
    for (let i = 0; i < delayStart; i++) this.publishOutputs(nodes[i]!, changes);
    // Delays read the main phase's values and qualities, then commit together
    // (chains shift one scan each). A delay outside a loop carries the quality
    // its input had, so it is captured before any delay commits.
    const delayed: Array<readonly [Evaluated, SignalQuality]> = [];
    for (let i = delayStart; i < nodes.length; i++) {
      const result = this.evaluate(nodes[i]!, dtMs, nowMs);
      delayed.push([result, 'fault' in result ? 'bad' : this.readingsQuality(result.node, result.substituted)]);
    }
    for (const [result, readings] of delayed) {
      this.apply(result);
      this.setQuality(result.node, this.outputQuality(result.node, readings));
      this.publishOutputs(result.node, changes);
    }

    const faults: FlowFault[] = [];
    const writes: FlowWrite[] = [];
    const holds: FlowHold[] = [];
    for (const node of nodes) {
      const fault = this.faults[node.index] ?? this.external[node.index] ?? null;
      if (fault !== this.published[node.index]) {
        this.published[node.index] = fault;
        changes.push(Object.freeze({ node: node.plan.id, port: FAULT_PORT, source: node.plan.faultSource, value: fault, quality: 'good' as const }));
      }
      if (fault !== null) faults.push(Object.freeze({ node: node.plan.id, message: fault }));
      if (node.role === 'signal-out') this.collectWrite(node, writes, holds);
    }
    return Object.freeze({
      scan: this.scanCount,
      nowMs,
      dtMs,
      changes: Object.freeze(changes),
      writes: Object.freeze(writes),
      holds: Object.freeze(holds),
      faults: Object.freeze(faults),
    });
  }

  private readClock(): number {
    try {
      return this.now();
    } catch (error) {
      this.reportError(error);
      return Number.NaN;
    }
  }

  /**
   * Read one input instance's value. `exact` is false when a converted value
   * had to be substituted (null, unparsable string): it is made up, so the
   * reading is `bad` and must never be written as if it were real.
   */
  private readValue(slot: ProgramSlot): { value: FlowValue; exact: boolean } {
    if ('value' in slot) return { value: slot.value, exact: true };
    const value = this.values[slot.slot] as FlowValue;
    return slot.convert ? convertReading(slot.convert, value) : { value, exact: true };
  }

  private evaluate(node: ProgramNode, dtMs: number, nowMs: number): Evaluated {
    const initFault = this.initFaults[node.index];
    if (initFault) return { node, fault: initFault };
    const inputs = dict<FlowValue | readonly FlowValue[]>();
    let substituted = false;
    const take = (slot: ProgramSlot): FlowValue => {
      const reading = this.readValue(slot);
      if (!reading.exact) substituted = true;
      return reading.value;
    };
    for (const input of node.inputs) {
      inputs[input.name] = input.variadic ? Object.freeze(input.slots.map(take)) : take(input.slots[0]!);
    }
    const state = this.states[node.index] as FlowState;
    const args: FlowEvalArgs = Object.freeze({ inputs: Object.freeze(inputs), params: node.plan.params, state, dtMs, nowMs });
    try {
      const result: unknown = node.info.evaluate(args);
      if (typeof (result as { then?: unknown } | null)?.then === 'function') {
        // Swallow the promise's own outcome so it cannot become an unhandled rejection.
        Promise.resolve(result).catch(() => {});
        throw new TypeError('evaluate must be synchronous (it returned a promise)');
      }
      if (!isRecord(result)) throw new TypeError('evaluate must return { outputs, state? }');
      const outputs = result.outputs;
      if (!isRecord(outputs)) throw new TypeError('evaluate must return { outputs: { … } }');
      const updates: Array<readonly [number, FlowValue]> = [];
      for (const port of Object.keys(outputs)) {
        const value: unknown = outputs[port];
        if (value === undefined) continue; // same as leaving the output out: it holds
        const output = node.outputs.find((o) => o.port === port);
        if (!output) throw new TypeError(`evaluate returned unknown output ${quote(port)}`);
        if (!matchesType(value, output.type)) throw new TypeError(`output ${quote(port)} must be ${output.type}, got ${describe(value)}`);
        if (typeof value === 'string' && value.length > FLOW_LIMITS.maxValueLength) {
          throw new RangeError(`output ${quote(port)} is longer than ${FLOW_LIMITS.maxValueLength} characters`);
        }
        updates.push([output.slot, value]);
      }
      const next = result.state;
      return { node, updates, state: next === undefined || next === state ? state : snapshotState(next), substituted };
    } catch (error) {
      return { node, fault: errorMessage(error) };
    }
  }

  /** Store an evaluation's values, state and fault (quality comes later). A faulted node keeps its values and state. */
  private apply(result: Evaluated): void {
    const { node } = result;
    if ('fault' in result) {
      this.faults[node.index] = result.fault;
      this.substituted[node.index] = false;
      return;
    }
    this.faults[node.index] = null;
    this.substituted[node.index] = result.substituted;
    this.states[node.index] = result.state;
    for (const [slot, value] of result.updates) this.values[slot] = value;
  }

  /** Faulted this scan: `evaluate` failed (or `initialState` did), or a fault is reported from outside. */
  private isFaulted(node: ProgramNode): boolean {
    return this.faults[node.index] !== null || this.external[node.index] !== null;
  }

  /**
   * Worst quality of the readings `node` consumes, from the qualities stored
   * now. Constants read `good`; a substitute (`substituted`, defaulting to
   * what `apply` recorded this scan) reads `bad`. A reading *inside* the
   * node's loop is the loop's own state and counts as `good`, or `uncertain`
   * when it is `null` (no value is never good): the loop's health stands in
   * for its quality (see `loopQuality`).
   */
  private readingsQuality(node: ProgramNode, substituted = this.substituted[node.index]!): SignalQuality {
    if (substituted) return 'bad';
    let quality: SignalQuality = 'good';
    for (const input of node.inputs) {
      for (const slot of input.slots) {
        if ('value' in slot) continue;
        if (!slot.internal) quality = worstQuality(quality, this.quality[slot.slot] as SignalQuality);
        else if (this.values[slot.slot] === null) quality = worstQuality(quality, 'uncertain');
      }
    }
    return quality;
  }

  /**
   * A loop's health for this scan: the worst reading any of its nodes took
   * this scan (from outside the loop, or a null/substitute inside it), and
   * `bad` while any node on it is faulted. Every non-delay node on the loop
   * publishes it now; each loop delay publishes it when it commits, so
   * readers see the health of the scan that stored the delay's value.
   */
  private loopQuality(loop: ProgramLoop): void {
    let health: SignalQuality = 'good';
    for (const member of loop.members) {
      // A delay's only input is on the loop too, so it adds `uncertain` while it reads null
      // (a ring of delays can circulate a null without any block reading it).
      if (this.isFaulted(member)) health = 'bad';
      else health = worstQuality(health, this.readingsQuality(member));
      if (health === 'bad') break;
    }
    this.loopHealth[loop.index] = health;
    for (const member of loop.members) if (member.role !== 'delay') this.setQuality(member, this.outputQuality(member, health));
  }

  /**
   * Quality of a node's outputs after it ran, given its `readings`:
   *   - `bad` while it is faulted (its held values are kept);
   *   - on a loop: the loop's health this scan; a loop delay holding `null`
   *     is at best `uncertain`;
   *   - `signal.in`: also the sample's quality, and at best `uncertain` while
   *     it holds `null` (no sample yet);
   *   - anything else (a delay outside any loop included): `readings`.
   */
  private outputQuality(node: ProgramNode, readings: SignalQuality): SignalQuality {
    if (this.isFaulted(node)) return 'bad';
    if (node.loop !== undefined) {
      const health = this.loopHealth[node.loop] as SignalQuality;
      const empty = node.role === 'delay' && node.outputs.some((o) => this.values[o.slot] === null);
      return empty ? worstQuality(health, 'uncertain') : health;
    }
    if (node.role !== 'signal-in') return readings;
    const quality = worstQuality(readings, this.signalQuality[node.index] as SignalQuality);
    return this.states[node.index] === null ? worstQuality(quality, 'uncertain') : quality;
  }

  private setQuality(node: ProgramNode, quality: SignalQuality): void {
    for (const output of node.outputs) this.quality[output.slot] = quality;
  }

  /** List a change for every output whose value or quality differs from what was last published. */
  private publishOutputs(node: ProgramNode, changes: FlowValueChange[]): void {
    for (const output of node.outputs) {
      const value = this.values[output.slot] as FlowValue;
      const quality = this.quality[output.slot] as SignalQuality;
      const before = this.publishedOut[output.slot];
      if (before !== undefined && Object.is(before.value, value) && before.quality === quality) continue;
      this.publishedOut[output.slot] = { value, quality };
      changes.push(Object.freeze({ node: node.plan.id, port: output.port, source: output.source, value, quality }));
    }
  }

  /**
   * The write gate. Only a `good`, non-null reading is ever written: anything
   * else is unknown data, and writing it (or a substitute for it) to a real
   * target is exactly what this runtime must never do. While the reading is
   * not writable the node holds: no write, and the target keeps the last
   * value written to it. When it becomes writable again the current value is
   * written even if it equals the last one, because the target may have
   * changed while the flow was not in control.
   */
  private collectWrite(node: ProgramNode, writes: FlowWrite[], holds: FlowHold[]): void {
    const slot = node.inputs[0]!.slots[0]!;
    if ('value' in slot) return; // unwired: inert
    const { value, exact } = this.readValue(slot);
    const quality: SignalQuality = exact ? (this.quality[slot.slot] as SignalQuality) : 'bad';
    const writable = quality === 'good' && value !== null;
    const previous = this.lastOut[node.index];
    this.lastOut[node.index] = { value, writable };
    const connection = String(node.plan.params.connection);
    const source = String(node.plan.params.source);
    if (!writable) {
      if (previous?.writable) holds.push(Object.freeze({ node: node.plan.id, connection, source, quality: value === null ? worstQuality(quality, 'uncertain') : quality }));
      return;
    }
    if (previous?.writable && Object.is(previous.value, value)) return;
    writes.push(Object.freeze({ node: node.plan.id, connection, source, value }));
  }

  private tick(): void {
    try {
      this.step();
    } catch (error) {
      this.reportError(error);
    }
  }

  private safeCancel(cancel: () => void): void {
    try {
      cancel();
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // An error reporter that throws has nowhere left to report to.
    }
  }

  private assertLive(what: string): void {
    if (this.disposed) throw new FlowRunError(`${what}() on a disposed flow run`, 'DISPOSED');
  }
}

/**
 * Create a run for a plan from `compileFlow`. It starts idle: call `start()`
 * for scheduled scans or `step()` for one scan at a time.
 */
export function createFlowRun(plan: FlowPlan, options: FlowRunOptions = {}): FlowRun {
  return new Run(plan, options);
}
