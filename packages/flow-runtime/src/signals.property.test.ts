/**
 * Property tests for the edges of the quality contract that the taint oracle
 * in `quality.property.test.ts` does not reach (it drives `FlowRun` directly,
 * without a bridge or a writer):
 *
 * A. Hub bridge vs connection state (GPT review P1). Random status changes,
 *    deliveries (good/uncertain/bad, on current *and* superseded provider
 *    callbacks, i.e. late deliveries), cached first deliveries on subscribe,
 *    new subscriptions and writes. Properties:
 *      - safety: a `good` sample reaches a subscriber only while the hub says
 *        the connection is up, and only from a provider delivery made while up;
 *      - writes reach the session only while the connection is up, and are
 *        refused with NOT_CONNECTED otherwise;
 *      - liveness: once up, a fresh good delivery reaches every subscriber as good.
 *
 * B. `signal.out` writes against a remote that may apply-then-reject, time
 *    out and land late, or complete in any order (GPT review P2 ×2). After a
 *    quiet stretch (every outstanding write has answered, the backend is
 *    healthy, the input is good and steady), the remote holds the current
 *    value, the node is not faulted, and the writer has stopped sending.
 *    Deploys happen mid-run too, so writes of a replaced deployment land
 *    late on top of the new one's (issue #76).
 *
 * Parameters: FLOW_FUZZ_SEED, FLOW_FUZZ_RUNS (scaled down here), FLOW_FUZZ_SCANS.
 */

import { ContributionRegistry, createManualSchedule, createProviderContext, HOLODECK_KINDS, ProviderHub, type Sample, type SignalQuality } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { createHubSignalBridge, createMemorySignalBridge } from './bridge';
import { createLocalFlowProvider } from './provider';
import { clock, controllableProvider, flowDoc, graph, node, registryWith, wire } from './test-helpers';
import type { FlowValue } from './values';

const SEED = Number(process.env.FLOW_FUZZ_SEED ?? 0x5eed_f10e);
const RUNS = Math.max(1, Math.floor(Number(process.env.FLOW_FUZZ_RUNS ?? 400) / 2));
const STEPS = Number(process.env.FLOW_FUZZ_SCANS ?? 60);

/** mulberry32 (same as the quality property test): every failure reproduces from (seed, run). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
// setImmediate, not setTimeout(0): runs once the microtask queue is drained, without Node's 1 ms timer clamp.
const settle = () => new Promise((resolve) => setImmediate(resolve));

// -----------------------------------------------------------------------------
// A. Hub bridge vs connection state
// -----------------------------------------------------------------------------

const STATES = ['live', 'stale', 'connecting', 'disconnected', 'error'] as const;
const QUALITIES: readonly SignalQuality[] = ['good', 'uncertain', 'bad'];

async function bridgeRun(seed: number, run: number, stats: { goodSeen: number; downDeliveries: number; refusedWrites: number }): Promise<string | undefined> {
  const rand = prng(seed ^ Math.imul(run + 1, 0x85ebca6b));
  let cache: Sample | undefined;
  /** Whether the provider delivery currently being made happens while the connection is up. */
  let deliveringUp = true;
  const writes: Array<{ source: string; value: unknown }> = [];
  const ctl = controllableProvider('test.ctl', {
    writes,
    cached: () => {
      if (!cache) return undefined;
      deliveringUp = isUp();
      return [cache];
    },
  });
  const registry = new ContributionRegistry();
  registry.registerKind({ kind: HOLODECK_KINDS.provider });
  registry.install({ id: 'fuzz.providers', version: '1.0.0', contributions: { [HOLODECK_KINDS.provider]: [ctl.provider] } });
  const hub = new ProviderHub({ registry, now: () => 0 });
  hub.setConnections([{ id: 'c', provider: 'test.ctl' }]);
  await hub.settled();
  const isUp = () => {
    const state = hub.getSnapshot().connections.c?.status.state;
    return state === 'live' || state === 'stale';
  };
  const bridge = createHubSignalBridge(hub, { now: () => 0 });
  const entry = ctl.sessions[0]!;
  let failure: string | undefined;
  const last: Array<Sample | undefined> = [];
  const subscribe = () => {
    const index = last.length;
    last.push(undefined);
    bridge.subscribe('c', 'x', (sample) => {
      last[index] = sample;
      if (sample.quality !== 'good') return;
      stats.goodSeen++;
      if (!isUp()) failure ??= `sub ${index} got good ${String(sample.value)} while ${hub.getSnapshot().connections.c?.status.state}`;
      if (!deliveringUp) failure ??= `sub ${index} got good ${String(sample.value)} from a delivery made while down`;
    });
  };
  /** Every provider callback ever handed out, so we can replay late deliveries on superseded ones. */
  const callbacks = new Set<(samples: readonly Sample[]) => void>();
  const remember = () => {
    for (const cb of entry.subscribers) callbacks.add(cb);
  };
  subscribe();
  remember();
  let counter = 0;
  const where = (step: number, what: string) => `seed ${seed} run ${run} step ${step}: ${what}`;

  try {
    for (let step = 1; step <= STEPS; step++) {
      const r = rand();
      if (r < 0.25) {
        entry.setStatus(pick(rand, STATES));
      } else if (r < 0.6) {
        const sample: Sample = { source: 'x', value: ++counter, ts: counter, quality: pick(rand, QUALITIES) };
        if (rand() < 0.5) cache = sample;
        deliveringUp = isUp();
        if (!deliveringUp) stats.downDeliveries++;
        if (rand() < 0.3 && callbacks.size) pick(rand, [...callbacks])([sample]); // late, maybe superseded
        else entry.deliver([sample]);
      } else if (r < 0.7) {
        subscribe();
      } else {
        const before = writes.length;
        const up = isUp();
        const result = await bridge.write('c', 'y', ++counter).then(
          () => 'ok',
          (error: { code?: string }) => error.code ?? 'error',
        );
        if (up && (result !== 'ok' || writes.length !== before + 1)) return where(step, `write while up: ${result}`);
        if (!up) {
          stats.refusedWrites++;
          if (result !== 'NOT_CONNECTED' || writes.length !== before) return where(step, `write while down: ${result}, reached session: ${writes.length !== before}`);
        }
      }
      remember();
      if (failure) return where(step, failure);
    }
    // Liveness: up again plus a fresh good delivery → every subscriber sees it as good.
    entry.setStatus('live');
    deliveringUp = true;
    const fresh = ++counter;
    entry.deliver([{ source: 'x', value: fresh, ts: fresh, quality: 'good' }]);
    if (failure) return where(STEPS + 1, failure);
    for (const [i, sample] of last.entries()) {
      if (sample?.value !== fresh || sample.quality !== 'good') return where(STEPS + 1, `liveness: sub ${i} last saw ${JSON.stringify(sample)}`);
    }
    return undefined;
  } finally {
    bridge.dispose();
    await hub.dispose();
  }
}

// -----------------------------------------------------------------------------
// B. signal.out against an ambiguous, reordering remote
// -----------------------------------------------------------------------------

type Op = { value: FlowValue; resolve: () => void; reject: (error: unknown) => void; done: boolean };

const TIMEOUT_MS = 1000;
const RETRY_MS = 200;

async function writerRun(seed: number, run: number, stats: { ambiguous: number; orphans: number; reassertions: number; redeploys: number }): Promise<string | undefined> {
  const rand = prng(seed ^ Math.imul(run + 1, 0xc2b2ae35));
  let remote: FlowValue = null;
  let healthy = false;
  const ops: Op[] = [];
  const bridge = createMemorySignalBridge({
    write: (_c, _s, value) => {
      if (healthy) {
        remote = value;
        return undefined;
      }
      return new Promise<void>((resolve, reject) => ops.push({ value, resolve, reject, done: false }));
    },
  });
  const time = clock();
  const manual = createManualSchedule();
  const provider = createLocalFlowProvider({ schedule: manual.schedule, now: time.now, writeRetryMs: RETRY_MS, writeTimeoutMs: TIMEOUT_MS, signals: bridge });
  const session = await provider.connect({}, createProviderContext({ registry: registryWith(), now: time.now }));
  const plc = { id: 'plc', provider: 'acme.plc' };
  bridge.set('plc', 'a', 0);
  const doc = flowDoc(
    graph([node('i', 'signal.in', { connection: 'plc', source: 'a' }), node('o', 'signal.out', { connection: 'plc', source: 'b' })], [wire('w', 'i.value', 'o.value')]),
    [plc],
  );
  const where = (step: number, what: string) => `seed ${seed} run ${run} step ${step}: ${what}; ops ${JSON.stringify(ops.map((o) => [o.value, o.done]))}`;
  /**
   * Answer one outstanding op. An acknowledgement means "applied" (a backend
   * that acks without applying is undetectable by any writer); a rejection is
   * ambiguous: it may or may not have been applied first.
   */
  const answer = (op: Op) => {
    op.done = true;
    if (rand() < 0.5) {
      remote = op.value;
      op.resolve();
      return;
    }
    const applied = rand() < 0.5;
    if (applied) {
      remote = op.value;
      stats.ambiguous++;
    }
    op.reject(new Error(applied ? 'applied, but the ack was lost' : 'rejected'));
  };
  try {
    let input = 0;
    if (!(await session.deploy!(doc)).ok) return where(0, 'deploy failed');
    for (let step = 1; step <= STEPS; step++) {
      if (rand() < 0.4) {
        input = Math.floor(rand() * 4);
        bridge.set('plc', 'a', input, rand() < 0.15 ? 'uncertain' : 'good');
      }
      // Replace the deployment while writes are in flight: the old writer's writes may land after the new one's.
      if (rand() < 0.1) {
        if (!(await session.deploy!(doc)).ok) return where(step, 'redeploy failed');
        stats.redeploys++;
      }
      // Answer a few outstanding writes in random order (newest-first is as likely as oldest-first).
      for (const op of ops) if (!op.done && rand() < 0.3) answer(op);
      time.advance(Math.floor(rand() * 1.5 * TIMEOUT_MS));
      manual.tick();
      await settle();
    }
    // Quiet stretch: input good and steady, every outstanding write (incl. orphans) answers, backend healthy.
    // Half the time the input does not change: then only a late (orphaned or replaced) write can leave the remote wrong.
    const final = rand() < 0.5 ? input : Math.floor(rand() * 4);
    bridge.set('plc', 'a', final);
    const outstanding = ops.filter((op) => !op.done);
    stats.orphans += Math.max(0, outstanding.length - 1);
    for (let i = outstanding.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [outstanding[i], outstanding[j]] = [outstanding[j]!, outstanding[i]!];
    }
    for (const op of outstanding) answer(op);
    healthy = true;
    await settle();
    const before = bridge.writes.length;
    for (let i = 0; i < 6; i++) {
      time.advance(TIMEOUT_MS);
      manual.tick();
      await settle();
    }
    stats.reassertions += bridge.writes.length - before;
    if (remote !== final) return where(STEPS + 1, `remote holds ${String(remote)}, flow wants ${final}`);
    const fault = (await session.read!(['flow:o.$fault']))[0]?.value;
    if (fault !== null) return where(STEPS + 1, `still faulted: ${String(fault)}`);
    const settled = bridge.writes.length;
    for (let i = 0; i < 3; i++) {
      time.advance(TIMEOUT_MS);
      manual.tick();
      await settle();
    }
    if (bridge.writes.length !== settled) return where(STEPS + 2, 'kept writing after the target was acknowledged');
    return undefined;
  } finally {
    await session.close();
  }
}

describe('signal edges (property tests)', () => {
  it(`A: the hub bridge never passes good data from a down connection, nor writes to one (${RUNS} runs × ${STEPS} steps, seed ${SEED})`, async () => {
    const stats = { goodSeen: 0, downDeliveries: 0, refusedWrites: 0 };
    for (let run = 0; run < RUNS; run++) {
      const failure = await bridgeRun(SEED, run, stats);
      expect(failure, failure).toBeUndefined();
    }
    // Not vacuous: plenty of good samples, deliveries while down, and refused writes.
    expect(stats.goodSeen).toBeGreaterThan(RUNS * 2);
    expect(stats.downDeliveries).toBeGreaterThan(RUNS * 2);
    expect(stats.refusedWrites).toBeGreaterThan(RUNS / 2);
  }, 120_000);

  it(`B: signal.out converges on the current value despite ambiguous, reordered and replaced writes (${RUNS} runs × ${STEPS} steps, seed ${SEED})`, async () => {
    const stats = { ambiguous: 0, orphans: 0, reassertions: 0, redeploys: 0 };
    for (let run = 0; run < RUNS; run++) {
      const failure = await writerRun(SEED, run, stats);
      expect(failure, failure).toBeUndefined();
    }
    expect(stats.ambiguous).toBeGreaterThan(RUNS);
    expect(stats.orphans).toBeGreaterThan(RUNS / 4);
    expect(stats.reassertions).toBeGreaterThan(RUNS / 4);
    expect(stats.redeploys).toBeGreaterThan(RUNS);
  }, 120_000);
});
