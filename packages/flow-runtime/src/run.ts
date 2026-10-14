/**
 * Cyclic dataflow scheduler: runs a compiled `FlowPlan` scan by scan.
 *
 * One scan:
 *   1. read the clock (`nowMs`, `dtMs`);
 *   2. main phase: evaluate every non-delay node in topological order; each
 *      node reads the current values of the outputs wired to it (unconnected
 *      inputs read their default) and its outputs are updated at once;
 *   3. delay phase: evaluate every `flow.delay` node against the values of
 *      step 2, then commit all their outputs together;
 *   4. publish: changed outputs, changed faults, and `signal.out` values that
 *      changed (`writes`), to every listener, synchronously.
 *
 * A node whose `evaluate` throws or returns something invalid is *faulted*
 * for that scan: none of its outputs or state change, its outputs' quality
 * becomes `bad`, and its `$fault` source carries the message. The other nodes
 * keep running; the next successful scan clears the fault.
 *
 * Everything the run hands out (scans, readings, snapshots) is frozen, and it
 * never keeps objects that callers or blocks gave it: values are scalars,
 * block state is deep-copied and frozen after every `evaluate`.
 */

import type { SignalQuality } from '@holodeck/sdk';
import type { FlowEvalArgs, FlowState } from './block';
import { programOf, type FlowPlan, type Program, type ProgramNode, type ProgramSlot } from './compile';
import {
  convertTo,
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

/** A `signal.out` input that changed this scan (never `null`; unwired `signal.out` nodes never write). */
export interface FlowWrite {
  readonly node: string;
  readonly connection: string;
  readonly source: string;
  readonly value: FlowValue;
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
  | { readonly node: ProgramNode; readonly updates: ReadonlyArray<readonly [slot: number, value: FlowValue]>; readonly state: FlowState };

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
  /** `signal.out`: input value seen by the previous scan (`undefined` before the first). */
  private readonly lastOut: (FlowValue | undefined)[];
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
    this.lastOut = new Array<FlowValue | undefined>(n).fill(undefined);
    this.publishedOut = new Array<{ value: FlowValue; quality: SignalQuality } | undefined>(program.slotCount).fill(undefined);
    for (const node of program.nodes) {
      for (const output of node.outputs) {
        this.values[output.slot] = node.role === 'delay' ? (node.plan.params.initial as FlowValue) : typeDefault(output.type);
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
    const { nodes, delayStart } = this.program;
    for (let i = 0; i < delayStart; i++) this.commit(this.evaluate(nodes[i]!, dtMs, nowMs), changes);
    // Delays read the main phase's values, then commit together (chains shift one scan each).
    const delayed: Evaluated[] = [];
    for (let i = delayStart; i < nodes.length; i++) delayed.push(this.evaluate(nodes[i]!, dtMs, nowMs));
    for (const result of delayed) this.commit(result, changes);

    const faults: FlowFault[] = [];
    const writes: FlowWrite[] = [];
    for (const node of nodes) {
      const fault = this.faults[node.index] ?? this.external[node.index] ?? null;
      if (fault !== this.published[node.index]) {
        this.published[node.index] = fault;
        changes.push(Object.freeze({ node: node.plan.id, port: FAULT_PORT, source: node.plan.faultSource, value: fault, quality: 'good' as const }));
      }
      if (fault !== null) faults.push(Object.freeze({ node: node.plan.id, message: fault }));
      if (node.role === 'signal-out') this.collectWrite(node, writes);
    }
    return Object.freeze({
      scan: this.scanCount,
      nowMs,
      dtMs,
      changes: Object.freeze(changes),
      writes: Object.freeze(writes),
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

  private read1(slot: ProgramSlot): FlowValue {
    if ('value' in slot) return slot.value;
    const value = this.values[slot.slot] as FlowValue;
    return slot.convert ? convertTo(slot.convert, value) : value;
  }

  private evaluate(node: ProgramNode, dtMs: number, nowMs: number): Evaluated {
    const initFault = this.initFaults[node.index];
    if (initFault) return { node, fault: initFault };
    const inputs = dict<FlowValue | readonly FlowValue[]>();
    for (const input of node.inputs) {
      inputs[input.name] = input.variadic ? Object.freeze(input.slots.map((slot) => this.read1(slot))) : this.read1(input.slots[0]!);
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
      return { node, updates, state: next === undefined || next === state ? state : snapshotState(next) };
    } catch (error) {
      return { node, fault: errorMessage(error) };
    }
  }

  private commit(result: Evaluated, changes: FlowValueChange[]): void {
    const { node } = result;
    if ('fault' in result) {
      this.faults[node.index] = result.fault;
      for (const output of node.outputs) this.setOutput(node, output, this.values[output.slot] as FlowValue, 'bad', changes);
      return;
    }
    this.faults[node.index] = null;
    this.states[node.index] = result.state;
    for (const [slot, value] of result.updates) this.values[slot] = value;
    const quality: SignalQuality = node.role === 'signal-in' ? (this.signalQuality[node.index] as SignalQuality) : 'good';
    for (const output of node.outputs) this.setOutput(node, output, this.values[output.slot] as FlowValue, quality, changes);
  }

  /** Record `value`/`quality` for an output and list a change when either differs from what was last published. */
  private setOutput(node: ProgramNode, output: ProgramNode['outputs'][number], value: FlowValue, quality: SignalQuality, changes: FlowValueChange[]): void {
    this.quality[output.slot] = quality;
    const before = this.publishedOut[output.slot];
    if (before !== undefined && Object.is(before.value, value) && before.quality === quality) return;
    this.publishedOut[output.slot] = { value, quality };
    changes.push(Object.freeze({ node: node.plan.id, port: output.port, source: output.source, value, quality }));
  }

  private collectWrite(node: ProgramNode, writes: FlowWrite[]): void {
    const slot = node.inputs[0]!.slots[0]!;
    if ('value' in slot) return; // unwired: inert
    const value = this.read1(slot);
    const previous = this.lastOut[node.index];
    this.lastOut[node.index] = value;
    if (previous !== undefined && Object.is(previous, value)) return;
    if (value === null) return; // null means "no value" and is never written
    writes.push(
      Object.freeze({ node: node.plan.id, connection: String(node.plan.params.connection), source: String(node.plan.params.source), value }),
    );
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
