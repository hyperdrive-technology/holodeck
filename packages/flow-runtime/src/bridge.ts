/**
 * Signal bridges: how a flow runtime reads and writes signals of *other*
 * provider connections (`signal.in` / `signal.out` blocks).
 *
 * `createHubSignalBridge(hub)` is the normal one: it reaches the sessions a
 * `ProviderHub` already holds for a document's connections, so a flow and
 * the iso diagram next to it share one session per connection.
 * `createMemorySignalBridge()` is the test double.
 */

import { ProviderHubError, type ProviderContext, type ProviderHub, type ProviderSession, type Sample, type SignalQuality } from '@holodeck/sdk';
import { errorMessage, isFlowValue, isQuality, isRecord, pairKey, worstQuality, type FlowValue } from './values';

export interface SignalBridge {
  /**
   * Deliver samples of `source` on connection `connection` until the returned
   * function is called. May deliver synchronously (the current value) before
   * it returns. The returned function is idempotent.
   */
  subscribe(connection: string, source: string, onSample: (sample: Sample) => void): () => void;
  /** Write a value. Rejects when the connection is missing, down or read-only. */
  write(connection: string, source: string, value: FlowValue): Promise<void>;
}

export interface HubSignalBridgeOptions {
  /** Clock for samples the bridge makes up (connection down). Default `Date.now`. */
  now?: () => number;
  log?: ProviderContext['log'];
}

export interface HubSignalBridge extends SignalBridge {
  /** Drop every subscription and stop listening to the hub. Idempotent. */
  dispose(): void;
  /** Active subscriptions (for tests and diagnostics). */
  readonly subscriptions: number;
}

interface Subscription {
  readonly connection: string;
  readonly source: string;
  readonly onSample: (sample: Sample) => void;
  active: boolean;
  /** Session the provider subscription (if any) was made on. */
  session: ProviderSession | undefined;
  /** Connection was up (session present and live/stale) at the last check. */
  up: boolean;
  unsubscribe: (() => void) | undefined;
  /** Bumped per provider subscription; deliveries from an older one are dropped. */
  generation: number;
  /** Last value delivered, held while the connection is down. */
  last: FlowValue;
}

const safeCall = (fn: unknown, log: ProviderContext['log'], what: string): void => {
  if (typeof fn !== 'function') return;
  try {
    (fn as () => void)();
  } catch (error) {
    log('warn', what, error);
  }
};

/**
 * A `SignalBridge` over the sessions of a `ProviderHub` (`hub.session(id)`).
 *
 * Behaviour per subscription:
 * - It subscribes on the connection's current session. When the hub replaces
 *   the session (config changed, provider installed or reinstalled, connection
 *   re-added), the bridge moves the subscription to the new session.
 * - While the connection is down (no session: connecting, removed, provider
 *   missing or failed; or a session whose status is `connecting`,
 *   `disconnected` or `error`), the subscriber gets one sample with the last
 *   value and quality `uncertain`; `signal.in` blocks hold that value. When
 *   the connection is up again the bridge subscribes afresh, so the
 *   provider's first delivery brings the current value.
 * - Anything the provider delivers while the connection is down (a queued or
 *   cached sample, a late callback, the synchronous first delivery of a
 *   subscription made on a session that is already down) is passed on with
 *   its quality lowered to at least `uncertain`: only a delivery on a
 *   subscription made while the connection was up can be `good` (review P1).
 *   Up-ness is checked at delivery time against the hub, not only at the
 *   last sync, so a delivery racing the hub's status publish is covered too.
 * - Writes go to the current session's `write` only while the connection is
 *   up, and reject with `ProviderHubError` `NOT_CONNECTED` (no session, or
 *   the session is connecting/disconnected/errored) or `NOT_WRITABLE`.
 *
 * Dispose the bridge before (or with) the hub: a disposed hub stops notifying
 * listeners, so the bridge cannot tell its sessions are gone.
 */
export function createHubSignalBridge(hub: ProviderHub, options: HubSignalBridgeOptions = {}): HubSignalBridge {
  // Read the options once; later edits to the caller's object change nothing.
  const { now: nowOption, log: logOption } = options;
  const now = typeof nowOption === 'function' ? nowOption : Date.now;
  const log: ProviderContext['log'] = (level, message, data) => {
    try {
      if (typeof logOption === 'function') logOption(level, message, data);
    } catch {
      // logging must never break the bridge
    }
  };
  const subscriptions = new Set<Subscription>();
  let offHub: (() => void) | undefined;
  let disposed = false;
  let syncing = false;
  let again = false;

  const lookup = (connection: string): { session: ProviderSession | undefined; up: boolean } => {
    try {
      const session = hub.session(connection);
      if (!session) return { session: undefined, up: false };
      // `connections` is a null-prototype dict, so any connection id is a safe key.
      const state = hub.getSnapshot().connections[connection]?.status.state;
      return { session, up: state === 'live' || state === 'stale' };
    } catch (error) {
      log('warn', `signal bridge: looking up connection "${connection}" failed`, error);
      return { session: undefined, up: false };
    }
  };

  const emit = (sub: Subscription, value: FlowValue, quality: SignalQuality, ts?: number): void => {
    if (!sub.active || disposed) return;
    let at = ts;
    if (at === undefined || !Number.isFinite(at)) {
      try {
        at = now();
      } catch {
        at = Date.now();
      }
    }
    try {
      sub.onSample(Object.freeze({ source: sub.source, value, ts: at, quality }));
    } catch (error) {
      log('warn', `signal bridge: subscriber for "${sub.source}" threw`, error);
    }
  };

  const detach = (sub: Subscription): void => {
    sub.generation++;
    const unsubscribe = sub.unsubscribe;
    sub.unsubscribe = undefined;
    safeCall(unsubscribe, log, `signal bridge: unsubscribing "${sub.source}" failed`);
  };

  const onSamples = (sub: Subscription, samples: unknown): void => {
    if (!Array.isArray(samples)) return;
    let found: { value: FlowValue; quality: SignalQuality; ts: number | undefined } | undefined;
    for (const raw of samples) {
      if (!isRecord(raw)) continue;
      // Read each field once: a provider's objects are not ours to trust.
      const source = raw.source;
      const value = raw.value;
      if (source !== sub.source || !isFlowValue(value)) continue;
      const quality = raw.quality;
      const ts = raw.ts;
      found = {
        value,
        quality: quality === undefined ? 'good' : isQuality(quality) ? quality : 'uncertain',
        ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : undefined,
      };
    }
    if (!found) return;
    // `sub.up` is only set true by `attach`, which also resubscribes on
    // recovery; the live lookup catches a status change the hub has not
    // published to us yet. Both must agree before a sample may stay `good`.
    const live = lookup(sub.connection);
    const up = sub.up && live.up && live.session === sub.session;
    sub.last = found.value;
    emit(sub, found.value, up ? found.quality : worstQuality(found.quality, 'uncertain'), found.ts);
  };

  const subscribeOn = (sub: Subscription, session: ProviderSession): void => {
    const generation = ++sub.generation;
    const current = () => sub.generation === generation && sub.active && !disposed;
    try {
      const unsubscribe = session.subscribe([sub.source], (samples) => {
        if (current()) onSamples(sub, samples);
      });
      // A synchronous delivery may have released or moved this subscription.
      if (current()) sub.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : undefined;
      else safeCall(unsubscribe, log, `signal bridge: unsubscribing superseded "${sub.source}" failed`);
    } catch (error) {
      log('warn', `signal bridge: subscribing to "${sub.source}" on "${sub.connection}" failed`, error);
      if (current()) emit(sub, sub.last, 'bad');
    }
  };

  const attach = (sub: Subscription, session: ProviderSession | undefined, up: boolean): void => {
    if (!sub.active || disposed) return;
    const changed = session !== sub.session;
    const recovered = !changed && up && !sub.up;
    const wentDown = sub.up && !up;
    sub.up = up;
    if (changed || recovered) {
      detach(sub);
      sub.session = session;
      if (session) subscribeOn(sub, session);
    }
    if (wentDown) emit(sub, sub.last, 'uncertain');
  };

  const sync = (): void => {
    if (disposed) return;
    // A provider callback may change the hub while we attach, which publishes
    // again: finish this pass, then run another (bounded, in case two
    // callbacks keep re-triggering each other).
    if (syncing) {
      again = true;
      return;
    }
    syncing = true;
    try {
      for (let pass = 0; pass < 8; pass++) {
        again = false;
        const seen = new Map<string, { session: ProviderSession | undefined; up: boolean }>();
        for (const sub of [...subscriptions]) {
          let state = seen.get(sub.connection);
          if (!state) seen.set(sub.connection, (state = lookup(sub.connection)));
          attach(sub, state.session, state.up);
        }
        if (!again) break;
      }
    } finally {
      syncing = false;
    }
  };

  const release = (sub: Subscription): void => {
    if (!sub.active) return;
    sub.active = false;
    subscriptions.delete(sub);
    detach(sub);
    if (!subscriptions.size && offHub) {
      const off = offHub;
      offHub = undefined;
      safeCall(off, log, 'signal bridge: leaving the hub failed');
    }
  };

  return {
    subscribe(connection, source, onSample) {
      if (disposed) throw new ProviderHubError('signal bridge is disposed', 'DISPOSED');
      if (typeof connection !== 'string' || connection === '') throw new TypeError('connection must be a non-empty string');
      if (typeof source !== 'string' || source === '') throw new TypeError('source must be a non-empty string');
      if (typeof onSample !== 'function') throw new TypeError('onSample must be a function');
      const sub: Subscription = {
        connection,
        source,
        onSample,
        active: true,
        session: undefined,
        up: false,
        unsubscribe: undefined,
        generation: 0,
        last: null,
      };
      // Join the hub first: if that throws, nothing has been recorded yet.
      offHub ??= hub.subscribe(sync);
      subscriptions.add(sub);
      const { session, up } = lookup(connection);
      attach(sub, session, up);
      return () => release(sub);
    },

    async write(connection, source, value) {
      if (disposed) throw new ProviderHubError('signal bridge is disposed', 'DISPOSED');
      if (!isFlowValue(value)) throw new TypeError('value must be a JSON scalar');
      const { session, up } = lookup(connection);
      if (!session) throw new ProviderHubError(`connection "${connection}" is not connected`, 'NOT_CONNECTED');
      // A session that exists but is not live/stale may still accept the call
      // (and queue or drop it): refuse, so the caller sees a fault instead.
      if (!up) throw new ProviderHubError(`connection "${connection}" is down`, 'NOT_CONNECTED');
      if (typeof session.write !== 'function') {
        throw new ProviderHubError(`connection "${connection}" does not support write`, 'NOT_WRITABLE');
      }
      await session.write(source, value);
    },

    dispose() {
      if (disposed) return;
      for (const sub of [...subscriptions]) release(sub);
      disposed = true;
      if (offHub) {
        const off = offHub;
        offHub = undefined;
        safeCall(off, log, 'signal bridge: leaving the hub failed');
      }
    },

    get subscriptions() {
      return subscriptions.size;
    },
  };
}

// -----------------------------------------------------------------------------
// Test double
// -----------------------------------------------------------------------------

export interface MemorySignalWrite {
  readonly connection: string;
  readonly source: string;
  readonly value: FlowValue;
}

export interface MemorySignalBridgeOptions {
  /**
   * Replaces the default write (store the value and deliver it, like a
   * loopback). Throw or reject to simulate a failing backend.
   */
  write?: (connection: string, source: string, value: FlowValue) => void | Promise<void>;
  now?: () => number;
}

export interface MemorySignalBridge extends SignalBridge {
  /** Store a value and deliver it to that signal's subscribers synchronously. */
  set(connection: string, source: string, value: FlowValue, quality?: SignalQuality): void;
  get(connection: string, source: string): FlowValue | undefined;
  /** Every write requested, in order (including failed ones). */
  readonly writes: readonly MemorySignalWrite[];
  /** Active subscriptions. */
  readonly subscriptions: number;
}

/** In-memory `SignalBridge` for tests and demos. Subscribing delivers the stored value, if any. */
export function createMemorySignalBridge(options: MemorySignalBridgeOptions = {}): MemorySignalBridge {
  const now = options.now ?? Date.now;
  const values = new Map<string, { value: FlowValue; quality: SignalQuality }>();
  const listeners = new Map<string, Set<(sample: Sample) => void>>();
  const writes: MemorySignalWrite[] = [];
  let count = 0;

  const deliver = (connection: string, source: string) => {
    const stored = values.get(pairKey(connection, source));
    if (!stored) return;
    const sample = Object.freeze({ source, value: stored.value, ts: now(), quality: stored.quality });
    for (const listener of [...(listeners.get(pairKey(connection, source)) ?? [])]) listener(sample);
  };

  const bridge: MemorySignalBridge = {
    subscribe(connection, source, onSample) {
      const key = pairKey(connection, source);
      let group = listeners.get(key);
      if (!group) listeners.set(key, (group = new Set()));
      // Wrap so the same callback can be subscribed twice and released independently.
      const listener = (sample: Sample) => onSample(sample);
      group.add(listener);
      count++;
      let active = true;
      const stored = values.get(key);
      if (stored) listener(Object.freeze({ source, value: stored.value, ts: now(), quality: stored.quality }));
      return () => {
        if (!active) return;
        active = false;
        count--;
        group.delete(listener);
      };
    },
    async write(connection, source, value) {
      writes.push(Object.freeze({ connection, source, value }));
      if (options.write) {
        await options.write(connection, source, value);
        return;
      }
      bridge.set(connection, source, value);
    },
    set(connection, source, value, quality = 'good') {
      if (!isFlowValue(value)) throw new TypeError(`value must be a JSON scalar: ${errorMessage(value)}`);
      values.set(pairKey(connection, source), { value, quality });
      deliver(connection, source);
    },
    get(connection, source) {
      return values.get(pairKey(connection, source))?.value;
    },
    get writes() {
      return Object.freeze([...writes]);
    },
    get subscriptions() {
      return count;
    },
  };
  return bridge;
}
