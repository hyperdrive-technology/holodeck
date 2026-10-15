/**
 * `holodeck.flow.local`: a provider that deploys flow documents and runs them
 * in this JavaScript realm (browser tab, worker or Node).
 *
 *   const session = await provider.connect({}, ctx);       // or hub.session(id)
 *   const result = await session.deploy(doc);               // { ok, diagnostics, sources }
 *   session.subscribe(['flow:and1.out'], (samples) => …);   // values each scan
 *
 * - `deploy(doc)` checks the envelope (engine `holodeck.flow`, engine version
 *   `^1`), validates the body against the blocks in `ctx.registry`, checks
 *   that every `signal.in` / `signal.out` names a connection of the document,
 *   then compiles, stops the previous run and starts the new one. A failed
 *   deploy changes nothing: the previous flow keeps running.
 * - Sources are `flow:<nodeId>.<port>` for every output, plus
 *   `flow:<nodeId>.$fault` per node. Subscribers get the current values on
 *   subscribe and after every deploy, then the changed values after each
 *   scan. A source the running flow does not publish reads `null` with
 *   quality `bad`.
 * - `signal.in` / `signal.out` reach other connections through a
 *   `SignalBridge` (`options.signals`), normally `createHubSignalBridge(hub)`.
 *   Without one, `signal.in` reads `null` (quality `bad`), `signal.out`
 *   nodes are faulted, and deploy says so with warnings.
 *
 * Everything in a deploy happens synchronously inside the call: two deploys,
 * or a deploy and a close, can never interleave. Callbacks made during a
 * deploy (block `initialState`, status listeners, subscribers, the bridge)
 * may deploy again or close the session; a generation check after each of
 * them makes the outer deploy stop and report `SUPERSEDED`, leaving whatever
 * the inner call installed (or nothing, after a close) running.
 */

import {
  isValidVersion,
  satisfiesRange,
  validateHolodeckDocument,
  type DeployResult,
  type Diagnostic,
  type HolodeckDocument,
  type HolodeckProvider,
  type ProviderContext,
  type ProviderSession,
  type ProviderStatus,
  type Sample,
  type SignalNode,
  type SignalQuality,
} from '@holodeck/sdk';
import type { SignalBridge } from './bridge';
import { tryCompileFlow, type FlowPlan, type FlowSignalRef } from './compile';
import type { FlowProblem, FlowProblemCode } from './graph';
import { checkScanMs, createFlowRun, type FlowRun, type FlowScan, type FlowSchedule } from './run';
import { FLOW_ENGINE_API_RANGE, FLOW_ENGINE_ID } from './engine';
import { errorMessage, FAULT_PORT, FLOW_SOURCE_PREFIX, isRecord, pairKey, quote, type FlowValue } from './values';

export const LOCAL_FLOW_PROVIDER_ID = 'holodeck.flow.local';

/** Default wait before retrying a failed `signal.out` write (ms). */
export const DEFAULT_WRITE_RETRY_MS = 1000;

/** Default time after which an unanswered `signal.out` write counts as failed (ms). */
export const DEFAULT_WRITE_TIMEOUT_MS = 10_000;

/**
 * A host logger that throws must never break the runtime (an exception in a
 * write handler would become an unhandled rejection; one in setStatus would
 * make deploy() or close() reject halfway). Read the function once.
 */
function safeLog(log: unknown): ProviderContext['log'] {
  return (level, message, data) => {
    try {
      if (typeof log === 'function') log(level, message, data);
    } catch {
      // nowhere left to report to
    }
  };
}

/** Budget for copying a document before validation (JSON values) and its nesting depth. */
const MAX_DOCUMENT_VALUES = 1_000_000;
const MAX_DOCUMENT_DEPTH = 64;

export interface LocalFlowProviderOptions {
  /**
   * How `signal.in` / `signal.out` reach other connections. A function is
   * called once per `connect` with that session's context; a bridge it
   * returns that has a `dispose()` method is disposed when the session closes.
   */
  signals?: SignalBridge | ((ctx: ProviderContext) => SignalBridge | undefined);
  /** Default scan period (ms) for sessions whose config does not set `scanMs`. Default 100. */
  scanMs?: number;
  /** Timer for scans (default `setInterval`); tests pass `createManualSchedule().schedule`. */
  schedule?: FlowSchedule;
  /** Clock for scans and samples. Default `ctx.now`. */
  now?: () => number;
  /** Wait before retrying a failed write (ms, default 1000). */
  writeRetryMs?: number;
  /** A write with no answer after this long (ms, default 10 000) counts as failed. */
  writeTimeoutMs?: number;
}

/** Codes on `DeployResult.diagnostics`: every `FlowProblemCode`, plus the deploy-level ones. */
export type FlowDeployCode =
  | FlowProblemCode
  | 'SESSION_CLOSED'
  | 'INVALID_DOCUMENT'
  | 'WRONG_ENGINE'
  | 'UNSUPPORTED_ENGINE_VERSION'
  | 'UNKNOWN_CONNECTION'
  | 'NO_SIGNAL_BRIDGE'
  | 'SIGNAL_SUBSCRIBE_FAILED'
  | 'SCHEDULE_FAILED'
  | 'SUPERSEDED';

/** JSON Schema of the connection config. */
export const LOCAL_FLOW_CONFIG_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: Object.freeze({
    scanMs: Object.freeze({ type: 'integer', minimum: 10, maximum: 3_600_000, description: 'Scan period in milliseconds.' }),
  }),
});

const diag = (severity: Diagnostic['severity'], code: FlowDeployCode, message: string, objectId?: string): Diagnostic =>
  Object.freeze(objectId === undefined ? { severity, code, message } : { severity, code, message, objectId });

const fromProblem = (p: FlowProblem): Diagnostic => diag(p.severity, p.code, p.message, p.node);

/** Results are frozen; `DeployResult` types `diagnostics` as a plain array, hence the cast. */
const result = (ok: boolean, diagnostics: Diagnostic[], sources?: readonly string[]): DeployResult =>
  Object.freeze({
    ok,
    diagnostics: Object.freeze([...diagnostics]) as Diagnostic[],
    ...(sources ? { sources: Object.freeze([...sources]) as string[] } : {}),
  });

const failed = (diagnostics: Diagnostic[]): DeployResult => result(false, diagnostics);

/**
 * Plain-data copy of a document (null-prototype objects), so validation and
 * compilation read one fixed snapshot and never touch the caller's objects.
 * Non-JSON values (functions, symbols, undefined) are dropped, as
 * `JSON.stringify` would; validators then report the missing fields.
 */
function copyDocument(raw: unknown): unknown {
  let budget = MAX_DOCUMENT_VALUES;
  const copy = (v: unknown, depth: number): unknown => {
    if (--budget < 0) throw new RangeError(`document has more than ${MAX_DOCUMENT_VALUES} values`);
    if (depth > MAX_DOCUMENT_DEPTH) throw new RangeError(`document is nested deeper than ${MAX_DOCUMENT_DEPTH}`);
    if (v === null || typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') return v;
    if (Array.isArray(v)) {
      const length = v.length;
      if (length > budget) throw new RangeError(`document has more than ${MAX_DOCUMENT_VALUES} values`);
      const out: unknown[] = [];
      for (let i = 0; i < length; i++) out.push(copy(v[i], depth + 1));
      return out;
    }
    if (typeof v === 'object') {
      const out = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(v)) {
        const child = copy((v as Record<string, unknown>)[key], depth + 1);
        if (child !== undefined) out[key] = child;
      }
      return out;
    }
    return undefined;
  };
  return copy(raw, 0);
}

function readConfig(input: unknown, fallbackScanMs: number): { scanMs: number } {
  if (input === undefined || input === null) return { scanMs: fallbackScanMs };
  if (!isRecord(input)) throw new TypeError('holodeck.flow.local config must be an object');
  const config = { ...input };
  for (const key of Object.keys(config)) {
    if (key !== 'scanMs') throw new TypeError(`holodeck.flow.local config: unknown field ${quote(key)}`);
  }
  const scanMs = config.scanMs;
  return { scanMs: scanMs === undefined ? fallbackScanMs : checkScanMs(scanMs, 'config.scanMs') };
}

const BROWSE_TYPE = { bool: 'boolean', number: 'number', string: 'string' } as const;

interface Subscriber {
  readonly sources: readonly string[];
  readonly set: ReadonlySet<string>;
  readonly onSamples: (samples: readonly Sample[]) => void;
  active: boolean;
}

interface Deployment {
  readonly plan: FlowPlan;
  readonly run: FlowRun;
  readonly label: string;
  readonly nodes: ReadonlyMap<string, FlowPlan['nodes'][number]>;
  readonly unsubscribes: Array<() => void>;
  readonly writers: Map<string, SignalWriter>;
}

/**
 * The live `signal.out` writers of every target (connection + source) per
 * bridge, across deployments and sessions (issue #76). A retired writer (its
 * deployment was replaced, or its session closed) can still have writes in
 * flight; when one of them answers, it may just have landed on top of what a
 * live writer of the same target has since acknowledged, so those writers are
 * told to forget it and re-assert their current value.
 *
 * Keyed by the bridge object, because `(connection, source)` only names a
 * target within one bridge. A `WeakMap` lets a bridge nobody uses any more be
 * garbage-collected along with its entry.
 */
const liveWriters = new WeakMap<SignalBridge, Map<string, Set<SignalWriter>>>();

function writersOf(bridge: SignalBridge, key: string): Set<SignalWriter> {
  let targets = liveWriters.get(bridge);
  if (!targets) liveWriters.set(bridge, (targets = new Map()));
  let writers = targets.get(key);
  if (!writers) targets.set(key, (writers = new Set()));
  return writers;
}

/**
 * Forwards one `signal.out` node's value to the bridge:
 * - at most one write in flight; the newest value wins (intermediate values are skipped);
 * - a value equal to the last *acknowledged* write is not sent again;
 * - after a failure the node is faulted and the latest value is retried no
 *   sooner than `retryMs` later. A failure is ambiguous — the bridge contract
 *   gives no rollback guarantee, so a rejected (or timed-out) write may still
 *   have been applied remotely — so it also forgets the last acknowledged
 *   write: the current value is sent again even if it equals that write
 *   (review P2: "rejection after remote application");
 * - a write with no answer after `timeoutMs` counts as failed, so a hung
 *   backend cannot block the node for good. Timing out does not cancel it,
 *   though: it may still land remotely after a newer write. So when such an
 *   *orphaned* write finally answers (either way), the writer forgets the
 *   last acknowledged write and re-asserts the current value; a write that
 *   was in flight while an orphan answered is not remembered either (review
 *   P2: "reverse completion order"). An orphan that never answers cannot be
 *   reconciled from here — that would need remote sequencing/cancellation,
 *   which the `SignalBridge` contract does not offer;
 * - `hold()` (the run's input reading stopped being `good`) drops the pending
 *   value, so nothing computed from data that is now in doubt is retried, and
 *   forgets the last acknowledged write, so the value is sent again once the
 *   reading is good. A write already in flight cannot be recalled; if it
 *   succeeds after the hold it is not remembered as written;
 * - a write of a *retired* writer (its deployment was replaced or closed)
 *   that answers late changes nothing of its own, but tells the live writers
 *   of the same target to forget their acknowledged value and re-assert it
 *   (`invalidate()`, issue #76). Only retired writers do this: two live
 *   `signal.out` nodes of one target (DUPLICATE_SIGNAL_TARGET) would
 *   otherwise invalidate each other forever.
 * Time is the provider's clock and every check runs on a request or a scan.
 */
class SignalWriter {
  private desired: FlowValue | undefined;
  /** Last value the bridge acknowledged, while we still trust the target to hold it. */
  private written: FlowValue | undefined;
  /** The write in flight: its token, start time and the `epoch` it started in. */
  private attempt: { token: number; startedAt: number; epoch: number } | undefined;
  private tokens = 0;
  /**
   * Bumped whenever what the target holds becomes unknown while a write may
   * be in flight (`hold()`, an orphaned write answering): an attempt that
   * started in an older epoch is not remembered as written when it succeeds.
   */
  private epoch = 0;
  private failedAt: number | undefined;
  private retired = false;
  /** The live writers of this writer's target (shared with every deployment using `bridge`). */
  private readonly peers: Set<SignalWriter>;

  constructor(
    private readonly ref: FlowSignalRef,
    private readonly bridge: SignalBridge,
    private readonly run: FlowRun,
    private readonly now: () => number,
    private readonly retryMs: number,
    private readonly timeoutMs: number,
    private readonly log: ProviderContext['log'],
  ) {
    this.peers = writersOf(bridge, pairKey(ref.connection, ref.source));
    this.peers.add(this);
  }

  request(value: FlowValue): void {
    this.desired = value;
    this.pump();
  }

  /** Stop writing: drop the pending value and forget the last write (see the class comment). The fault, if any, stays. */
  hold(): void {
    this.desired = undefined;
    this.forget();
  }

  /** Called on every request and once per scan. */
  pump(): void {
    if (this.retired || this.desired === undefined) return;
    if (this.attempt) {
      if (this.now() - this.attempt.startedAt < this.timeoutMs) return;
      this.attempt = undefined;
      this.fail(new Error(`no answer within ${this.timeoutMs} ms`));
    }
    if (this.written !== undefined && Object.is(this.desired, this.written)) {
      this.clearFault();
      return;
    }
    if (this.failedAt !== undefined && this.now() - this.failedAt < this.retryMs) return;
    const value = this.desired;
    const token = ++this.tokens;
    this.attempt = { token, startedAt: this.now(), epoch: this.epoch };
    let writing: Promise<void>;
    try {
      writing = Promise.resolve(this.bridge.write(this.ref.connection, this.ref.source, value));
    } catch (error) {
      writing = Promise.reject(error);
    }
    writing
      .then(
        () => this.settle(token, value, undefined),
        (error: unknown) => this.settle(token, value, error ?? new Error('write failed')),
      )
      // settle() does not throw; this only guards against a bug becoming an unhandled rejection.
      .catch((error: unknown) => this.log('error', `signal.out ${quote(this.ref.node)}: write handler failed`, error));
  }

  retire(): void {
    this.retired = true;
    this.peers.delete(this);
  }

  /** Another (retired) writer's write to our target just answered: what the target holds is unknown again. */
  invalidate(): void {
    if (this.retired) return;
    this.forget();
    this.pump();
  }

  private settle(token: number, value: FlowValue, error: unknown): void {
    if (this.retired) {
      // Our deployment is gone, so our own state no longer matters — but this
      // write may have landed after a live writer's acknowledged one (either
      // answer is ambiguous). Copy the set: invalidate() may write synchronously.
      for (const peer of [...this.peers]) peer.invalidate();
      return;
    }
    if (this.attempt?.token !== token) {
      // An orphan: this write timed out earlier, and a newer one may have been
      // acknowledged since. Whatever the answer, it may just have landed on
      // top of that newer value, so the target is unknown again: forget and
      // re-assert the current value (subject to the retry wait, if faulted).
      this.forget();
      this.pump();
      return;
    }
    const stale = this.attempt.epoch !== this.epoch;
    this.attempt = undefined;
    if (error !== undefined) {
      this.fail(error);
      return;
    }
    if (!stale) this.written = value;
    this.clearFault();
    this.pump();
  }

  /** The target's value is unknown: nothing acknowledged so far, or in flight now, can be trusted. */
  private forget(): void {
    this.written = undefined;
    this.epoch++;
  }

  /** A failed or timed-out write. Ambiguous: it may have been applied remotely, so forget the last acknowledged value. */
  private fail(error: unknown): void {
    this.forget();
    this.failedAt = this.now();
    this.run.reportFault(this.ref.node, `write to ${quote(this.ref.source)} on ${quote(this.ref.connection)} failed: ${errorMessage(error)}`);
    this.log('warn', `signal.out ${quote(this.ref.node)}: write failed`, error);
  }

  private clearFault(): void {
    if (this.failedAt === undefined) return;
    this.failedAt = undefined;
    this.run.reportFault(this.ref.node, null);
  }
}

class LocalFlowSession implements ProviderSession {
  private closed = false;
  /** Bumped by every committed deploy and by close; a deploy whose generation is stale stops. */
  private generation = 0;
  private deployment: Deployment | undefined;
  private current: ProviderStatus;
  private readonly statusListeners = new Set<(status: ProviderStatus) => void>();
  private readonly subscribers = new Set<Subscriber>();
  private readonly log: ProviderContext['log'];

  constructor(
    private readonly ctx: ProviderContext,
    private readonly bridge: SignalBridge | undefined,
    private readonly ownsBridge: boolean,
    private readonly scanMs: number,
    private readonly schedule: FlowSchedule | undefined,
    private readonly now: () => number,
    private readonly retryMs: number,
    private readonly timeoutMs: number,
  ) {
    this.log = safeLog(ctx.log);
    this.current = Object.freeze({ state: 'live', since: this.clock(), message: 'no flow deployed' });
  }

  status(): ProviderStatus {
    return this.current;
  }

  onStatus(listener: (status: ProviderStatus) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribe(sources: readonly string[], onSamples: (samples: readonly Sample[]) => void): () => void {
    const list = this.sourceList(sources);
    if (typeof onSamples !== 'function') throw new TypeError('onSamples must be a function');
    if (this.closed) return () => {};
    const sub: Subscriber = { sources: list, set: new Set(list), onSamples, active: true };
    this.subscribers.add(sub);
    if (list.length) this.deliver(sub, list.map((source) => this.sampleOf(source)));
    return () => {
      if (!sub.active) return;
      sub.active = false;
      this.subscribers.delete(sub);
    };
  }

  async read(sources: readonly string[]): Promise<Sample[]> {
    return this.sourceList(sources).map((source) => this.sampleOf(source));
  }

  async browse(path?: string): Promise<SignalNode[]> {
    const deployment = this.deployment;
    if (!deployment) return [];
    if (path === undefined || path === '') {
      return deployment.plan.nodes.map((node) =>
        Object.freeze({ path: node.id, label: node.label ?? node.id, hasChildren: true, description: node.block }),
      );
    }
    if (typeof path !== 'string') return [];
    const node = deployment.nodes.get(path);
    if (!node) return [];
    const leaves: SignalNode[] = node.outputs.map((output) => {
      const leaf: SignalNode = { path: output.source, label: output.port, source: output.source, writable: false };
      if (output.type !== 'any') leaf.type = BROWSE_TYPE[output.type];
      return Object.freeze(leaf);
    });
    leaves.push(
      Object.freeze({ path: node.faultSource, label: FAULT_PORT, source: node.faultSource, type: 'string' as const, writable: false, description: 'Fault message, null while healthy' }),
    );
    return leaves;
  }

  async deploy(doc: HolodeckDocument): Promise<DeployResult> {
    return this.deployNow(doc);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    const deployment = this.deployment;
    this.deployment = undefined;
    this.teardown(deployment);
    for (const sub of this.subscribers) sub.active = false;
    this.subscribers.clear();
    this.setStatus('disconnected', 'closed');
    this.statusListeners.clear();
    if (this.ownsBridge) {
      const dispose = (this.bridge as { dispose?: unknown } | undefined)?.dispose;
      if (typeof dispose === 'function') {
        try {
          dispose.call(this.bridge);
        } catch (error) {
          this.log('warn', 'holodeck.flow.local: disposing the signal bridge failed', error);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Deploy
  // ---------------------------------------------------------------------------

  private deployNow(raw: unknown): DeployResult {
    if (this.closed) return failed([diag('error', 'SESSION_CLOSED', 'the session is closed')]);
    const diagnostics: Diagnostic[] = [];

    let doc: unknown;
    try {
      doc = copyDocument(raw);
    } catch (error) {
      return failed([diag('error', 'INVALID_DOCUMENT', `document could not be read: ${errorMessage(error)}`)]);
    }
    const envelope = validateHolodeckDocument(doc);
    for (const message of envelope) diagnostics.push(diag('error', 'INVALID_DOCUMENT', message));
    const record = isRecord(doc) ? doc : undefined;
    if (record && record.engine !== FLOW_ENGINE_ID) {
      diagnostics.push(diag('error', 'WRONG_ENGINE', `engine must be "${FLOW_ENGINE_ID}", not ${quote(record.engine)}`));
    }
    const version = record?.engineVersion;
    if (isValidVersion(version) && !satisfiesRange(version, FLOW_ENGINE_API_RANGE)) {
      diagnostics.push(
        diag('error', 'UNSUPPORTED_ENGINE_VERSION', `engineVersion ${version} is not supported (this runtime runs ${FLOW_ENGINE_ID} ${FLOW_ENGINE_API_RANGE})`),
      );
    }
    const { plan, problems } = tryCompileFlow(record?.body, this.ctx.registry);
    for (const problem of problems) diagnostics.push(fromProblem(problem));
    if (plan && envelope.length === 0) {
      const connections = new Set(((record?.connections as Array<{ id: string }> | undefined) ?? []).map((c) => c.id));
      for (const ref of [...plan.signalsIn, ...plan.signalsOut]) {
        if (!connections.has(ref.connection)) {
          diagnostics.push(
            diag('error', 'UNKNOWN_CONNECTION', `node ${quote(ref.node)}: connection ${quote(ref.connection)} is not in the document's connections`, ref.node),
          );
        }
      }
    }
    if (!plan || diagnostics.some((d) => d.severity === 'error')) return failed(diagnostics);

    const superseded = (): DeployResult =>
      failed([...diagnostics, diag('error', 'SUPERSEDED', 'a later deploy or close replaced this deployment while it started')]);

    // Commit: from here on the previous flow is gone. The generation moves only
    // here and in close(), so a re-entrant deploy that fails validation does
    // not supersede this one.
    const generation = ++this.generation;
    const run = createFlowRun(plan, {
      scanMs: this.scanMs,
      now: this.now,
      schedule: this.schedule,
      onError: (error) => this.log('warn', 'holodeck.flow.local: scan error', error),
    });
    // createFlowRun() calls block `initialState` callbacks, which may deploy
    // again or close the session. Such a deploy has already committed (and
    // reported ok) by now, so this one must not install itself over it: drop
    // our run, which nothing else has seen yet, and report SUPERSEDED, so the
    // results match what actually runs (issue #77).
    if (this.closed || this.generation !== generation) {
      run.dispose();
      return superseded();
    }
    const name = record?.name;
    const deployment: Deployment = {
      plan,
      run,
      label: typeof name === 'string' && name !== '' ? name : String(record?.id),
      nodes: new Map(plan.nodes.map((node) => [node.id, node])),
      unsubscribes: [],
      writers: new Map(),
    };
    const previous = this.deployment;
    this.deployment = deployment;
    this.teardown(previous);
    if (!this.isCurrent(deployment, generation)) return superseded();

    this.connectSignals(deployment, diagnostics);
    if (!this.isCurrent(deployment, generation)) return superseded();

    // First scan right away, so every source has a value when deploy returns.
    this.forwardWrites(deployment, run.step());
    if (!this.isCurrent(deployment, generation)) return superseded();
    run.subscribe((scan) => this.onScan(deployment, scan));
    try {
      run.start();
    } catch (error) {
      const message = `scan schedule failed: ${errorMessage(error)}`;
      // Only undo what is still ours: a callback may already have replaced or closed it.
      if (this.isCurrent(deployment, generation)) {
        this.deployment = undefined;
        this.teardown(deployment);
        this.setStatus('error', message);
      }
      return failed([...diagnostics, diag('error', 'SCHEDULE_FAILED', message)]);
    }
    // A schedule may tick synchronously inside start(), and that scan's
    // subscribers may have closed the session or deployed again.
    if (!this.isCurrent(deployment, generation)) return superseded();

    this.setStatus('live', `running ${quote(deployment.label)}`);
    if (!this.isCurrent(deployment, generation)) return superseded();
    for (const sub of [...this.subscribers]) {
      if (sub.active && sub.sources.length) this.deliver(sub, sub.sources.map((source) => this.sampleOf(source)));
      if (!this.isCurrent(deployment, generation)) return superseded();
    }
    return result(true, diagnostics, plan.sources);
  }

  private connectSignals(deployment: Deployment, diagnostics: Diagnostic[]): void {
    const { plan, run } = deployment;
    const bridge = this.bridge;
    if (!bridge) {
      for (const ref of plan.signalsIn) {
        run.setSignal(ref.node, null, 'bad');
        diagnostics.push(diag('warning', 'NO_SIGNAL_BRIDGE', `node ${quote(ref.node)}: no signal bridge; it reads null`, ref.node));
      }
      for (const ref of plan.signalsOut) {
        run.reportFault(ref.node, 'no signal bridge: writes are dropped');
        diagnostics.push(diag('warning', 'NO_SIGNAL_BRIDGE', `node ${quote(ref.node)}: no signal bridge; its writes are dropped`, ref.node));
      }
      return;
    }
    for (const ref of plan.signalsOut) {
      deployment.writers.set(ref.node, new SignalWriter(ref, bridge, run, () => this.clock(), this.retryMs, this.timeoutMs, this.log));
    }
    // One bridge subscription per distinct signal, fanned out to its nodes.
    const groups = new Map<string, { connection: string; source: string; nodes: string[] }>();
    for (const ref of plan.signalsIn) {
      const key = pairKey(ref.connection, ref.source);
      const group = groups.get(key);
      if (group) group.nodes.push(ref.node);
      else groups.set(key, { connection: ref.connection, source: ref.source, nodes: [ref.node] });
    }
    for (const { connection, source, nodes } of groups.values()) {
      let unsubscribe: unknown;
      try {
        unsubscribe = bridge.subscribe(connection, source, (sample) => this.onSignal(deployment, nodes, sample));
      } catch (error) {
        const message = `subscribing to ${quote(source)} on ${quote(connection)} failed: ${errorMessage(error)}`;
        for (const node of nodes) {
          run.setSignal(node, null, 'bad');
          run.reportFault(node, message);
          diagnostics.push(diag('warning', 'SIGNAL_SUBSCRIBE_FAILED', `node ${quote(node)}: ${message}`, node));
        }
        continue;
      }
      if (typeof unsubscribe !== 'function') continue;
      if (this.deployment !== deployment) {
        // A callback replaced this deployment while we subscribed.
        this.safely(unsubscribe as () => void, 'unsubscribing a superseded signal failed');
        return;
      }
      deployment.unsubscribes.push(unsubscribe as () => void);
    }
  }

  private onSignal(deployment: Deployment, nodes: readonly string[], sample: unknown): void {
    if (this.deployment !== deployment || this.closed) return;
    const value = isRecord(sample) ? sample.value : undefined;
    const quality = isRecord(sample) ? sample.quality : undefined;
    for (const node of nodes) {
      try {
        deployment.run.setSignal(node, value as FlowValue, (quality ?? 'good') as SignalQuality);
      } catch {
        // Not a JSON scalar, too long, or a bad quality: the node reads null/bad.
        deployment.run.setSignal(node, null, 'bad');
      }
    }
  }

  private onScan(deployment: Deployment, scan: FlowScan): void {
    if (this.deployment !== deployment || this.closed) return;
    this.forwardWrites(deployment, scan);
    if (this.deployment !== deployment || this.closed || !scan.changes.length) return;
    let samples: Map<string, Sample> | undefined;
    for (const sub of [...this.subscribers]) {
      if (!sub.active) continue;
      const batch: Sample[] = [];
      for (const change of scan.changes) {
        if (!sub.set.has(change.source)) continue;
        samples ??= new Map();
        let sample = samples.get(change.source);
        if (!sample) {
          sample = Object.freeze({ source: change.source, value: change.value, ts: scan.nowMs, quality: change.quality });
          samples.set(change.source, sample);
        }
        batch.push(sample);
      }
      if (batch.length) this.deliver(sub, batch);
      if (this.deployment !== deployment || this.closed) return;
    }
  }

  private forwardWrites(deployment: Deployment, scan: FlowScan): void {
    // Holds first: a node is never in both lists in one scan, but order makes the intent explicit.
    for (const hold of scan.holds) deployment.writers.get(hold.node)?.hold();
    for (const write of scan.writes) deployment.writers.get(write.node)?.request(write.value);
    // Retries of failed writes are due-checked once per scan.
    for (const writer of deployment.writers.values()) writer.pump();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private teardown(deployment: Deployment | undefined): void {
    if (!deployment) return;
    deployment.run.dispose();
    for (const writer of deployment.writers.values()) writer.retire();
    const unsubscribes = deployment.unsubscribes.splice(0);
    for (const unsubscribe of unsubscribes) this.safely(unsubscribe, 'unsubscribing a signal failed');
  }

  private isCurrent(deployment: Deployment, generation: number): boolean {
    return !this.closed && this.generation === generation && this.deployment === deployment;
  }

  private sampleOf(source: string): Sample {
    const deployment = this.deployment;
    const reading = deployment?.run.read(source);
    const ts = deployment?.run.nowMs ?? this.clock();
    if (!reading) return Object.freeze({ source, value: null, ts, quality: 'bad' as const });
    return Object.freeze({ source, value: reading.value, ts, quality: reading.quality });
  }

  private sourceList(sources: readonly string[]): readonly string[] {
    if (!Array.isArray(sources)) throw new TypeError('sources must be an array of strings');
    // Copy by index once and validate the copy: what is checked is what is used
    // (a custom Symbol.iterator or a getter cannot slip a non-string through).
    const copy: unknown[] = Array.prototype.slice.call(sources);
    if (!copy.every((s) => typeof s === 'string')) throw new TypeError('sources must be an array of strings');
    return Object.freeze([...new Set(copy as string[])]);
  }

  private deliver(sub: Subscriber, samples: readonly Sample[]): void {
    try {
      sub.onSamples(Object.freeze(samples));
    } catch (error) {
      this.log('warn', 'holodeck.flow.local: subscriber threw', error);
    }
  }

  private setStatus(state: ProviderStatus['state'], message: string): void {
    this.current = Object.freeze({ state, since: this.clock(), message });
    for (const listener of [...this.statusListeners]) {
      try {
        listener(this.current);
      } catch (error) {
        this.log('warn', 'holodeck.flow.local: status listener threw', error);
      }
    }
  }

  private clock(): number {
    try {
      const t = this.now();
      return Number.isFinite(t) ? t : Date.now();
    } catch {
      return Date.now();
    }
  }

  private safely(fn: () => void, what: string): void {
    try {
      fn();
    } catch (error) {
      this.log('warn', `holodeck.flow.local: ${what}`, error);
    }
  }
}

/**
 * The `holodeck.flow.local` provider. Capabilities: `deploy`, `read`,
 * `browse` (subscribe is always there). Connection config: `{ scanMs? }`.
 */
export function createLocalFlowProvider(options: LocalFlowProviderOptions = {}): HolodeckProvider {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new TypeError('options must be an object');
  // Read every option once; later edits to the caller's object change nothing.
  const { signals, schedule, now } = options;
  const scanMs = checkScanMs(options.scanMs);
  const retryMs = options.writeRetryMs ?? DEFAULT_WRITE_RETRY_MS;
  if (!Number.isFinite(retryMs) || retryMs < 0) throw new RangeError('writeRetryMs must be a finite number ≥ 0');
  const timeoutMs = options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('writeTimeoutMs must be a finite number > 0');
  if (signals !== undefined && typeof signals !== 'function' && (typeof signals !== 'object' || signals === null)) {
    throw new TypeError('signals must be a SignalBridge or a function returning one');
  }
  if (schedule !== undefined && typeof schedule !== 'function') throw new TypeError('schedule must be a function');
  if (now !== undefined && typeof now !== 'function') throw new TypeError('now must be a function');

  const provider: HolodeckProvider = {
    id: LOCAL_FLOW_PROVIDER_ID,
    label: 'Local flow runtime',
    description: 'Deploys holodeck.flow documents and runs them here, publishing every block output.',
    capabilities: Object.freeze({ deploy: true, read: true, browse: true }),
    sourceSyntax: `${FLOW_SOURCE_PREFIX}<nodeId>.<port>  (or ${FLOW_SOURCE_PREFIX}<nodeId>.${FAULT_PORT})`,
    configSchema: LOCAL_FLOW_CONFIG_SCHEMA,
    async connect(config, ctx) {
      const { scanMs: sessionScanMs } = readConfig(config, scanMs);
      let bridge: SignalBridge | undefined;
      let owns = false;
      if (typeof signals === 'function') {
        try {
          bridge = signals(ctx);
          owns = true;
        } catch (error) {
          safeLog(ctx.log)('warn', 'holodeck.flow.local: creating the signal bridge failed', error);
        }
      } else bridge = signals;
      const session = new LocalFlowSession(ctx, bridge, owns, sessionScanMs, schedule, now ?? (() => ctx.now()), retryMs, timeoutMs);
      if (ctx.signal.aborted) void session.close();
      else ctx.signal.addEventListener('abort', () => void session.close(), { once: true });
      return session;
    },
  };
  return Object.freeze(provider);
}
