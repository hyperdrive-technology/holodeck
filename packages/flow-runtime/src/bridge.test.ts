import {
  ContributionRegistry,
  createManualSchedule,
  createSimProvider,
  HOLODECK_KINDS,
  HolodeckHost,
  ProviderHub,
  ProviderHubError,
  type HolodeckProvider,
  type Sample,
} from '@holodeck/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOW_BLOCK_KIND } from './block';
import { createHubSignalBridge, createMemorySignalBridge, type HubSignalBridge } from './bridge';
import { createLocalFlowProvider } from './provider';
import { controllableProvider, flowDoc, graph, node, TEST_BLOCKS, wire } from './test-helpers';

const PROVIDER_EXT = 'test.providers';

function setup(providers: HolodeckProvider[]) {
  const registry = new ContributionRegistry();
  registry.registerKind({ kind: HOLODECK_KINDS.provider });
  registry.install({ id: PROVIDER_EXT, version: '1.0.0', contributions: { [HOLODECK_KINDS.provider]: providers } });
  const hub = new ProviderHub({ registry, now: () => 1000 });
  return { registry, hub };
}

let bridges: HubSignalBridge[] = [];
const track = (bridge: HubSignalBridge) => {
  bridges.push(bridge);
  return bridge;
};
let unhandled: ReturnType<typeof vi.fn>;
beforeEach(() => {
  unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
});
afterEach(async () => {
  for (const bridge of bridges) bridge.dispose();
  bridges = [];
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
});

describe('createHubSignalBridge with the sim provider', () => {
  async function simSetup() {
    const manual = createManualSchedule();
    const sim = createSimProvider({ schedule: manual.schedule });
    const { hub, registry } = setup([sim]);
    hub.setConnections([{ id: 'sim', provider: 'holodeck.sim' }]);
    await hub.settled();
    return { manual, hub, registry, bridge: track(createHubSignalBridge(hub, { now: () => 7 })) };
  }

  it('subscribes on the connection’s session and writes through it', async () => {
    const { manual, bridge } = await simSetup();
    const samples: Sample[] = [];
    bridge.subscribe('sim', 'mem:x', (s) => samples.push(s));
    expect(samples).toEqual([{ source: 'mem:x', value: null, ts: 1000, quality: 'good' }]); // sim delivers on subscribe
    await bridge.write('sim', 'mem:x', 5);
    manual.tick();
    expect(samples.at(-1)).toMatchObject({ value: 5, quality: 'good' });
    expect(Object.isFrozen(samples[0])).toBe(true);
    expect(manual.active).toBe(1);
    expect(bridge.subscriptions).toBe(1);
  });

  it('marks the value uncertain while the connection is gone and resubscribes when it returns', async () => {
    const { manual, hub, bridge } = await simSetup();
    const samples: Sample[] = [];
    bridge.subscribe('sim', 'const:42', (s) => samples.push(s));
    hub.setConnections([]);
    expect(samples.at(-1)).toEqual({ source: 'const:42', value: 42, ts: 7, quality: 'uncertain' });
    expect(manual.active).toBe(0); // the old subscription was released
    await expect(bridge.write('sim', 'mem:x', 1)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    hub.setConnections([{ id: 'sim', provider: 'holodeck.sim' }]);
    await hub.settled();
    expect(samples.at(-1)).toMatchObject({ value: 42, quality: 'good' });
    expect(manual.active).toBe(1);
  });

  it('moves to the new session when the connection config changes', async () => {
    const { manual, hub, bridge } = await simSetup();
    const cb = vi.fn();
    bridge.subscribe('sim', 'const:1', cb);
    const before = hub.session('sim');
    hub.setConnections([{ id: 'sim', provider: 'holodeck.sim', config: { v: 2 } }]);
    await hub.settled();
    expect(hub.session('sim')).not.toBe(before);
    expect(manual.active).toBe(1); // exactly one subscription, on the new session
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ value: 1, quality: 'good' }));
  });

  it('attaches once the provider gets installed', async () => {
    const manual = createManualSchedule();
    const registry = new ContributionRegistry();
    registry.registerKind({ kind: HOLODECK_KINDS.provider });
    const hub = new ProviderHub({ registry });
    hub.setConnections([{ id: 'sim', provider: 'holodeck.sim' }]);
    const bridge = track(createHubSignalBridge(hub));
    const cb = vi.fn();
    bridge.subscribe('sim', 'const:3', cb);
    expect(cb).not.toHaveBeenCalled(); // never up: nothing to report yet
    registry.install({ id: 'sim', version: '1.0.0', contributions: { [HOLODECK_KINDS.provider]: [createSimProvider({ schedule: manual.schedule })] } });
    await hub.settled();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ value: 3, quality: 'good' }));
  });

  it('rejects writes to sessions without write', async () => {
    const { provider } = controllableProvider();
    const { hub } = setup([provider]);
    hub.setConnections([{ id: 'c', provider: 'test.ctl' }]);
    await hub.settled();
    const bridge = track(createHubSignalBridge(hub));
    const error = await bridge.write('c', 'x', 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHubError);
    expect(error).toMatchObject({ code: 'NOT_WRITABLE' });
    await expect(bridge.write('c', 'x', Number.NaN)).rejects.toThrow(TypeError);
  });

  it('dispose releases everything and refuses further use', async () => {
    const { manual, bridge } = await simSetup();
    bridge.subscribe('sim', 'mem:a', () => {});
    bridge.subscribe('sim', 'mem:b', () => {});
    expect(manual.active).toBe(2);
    bridge.dispose();
    bridge.dispose();
    expect(manual.active).toBe(0);
    expect(bridge.subscriptions).toBe(0);
    expect(() => bridge.subscribe('sim', 'mem:a', () => {})).toThrow(expect.objectContaining({ code: 'DISPOSED' }));
    await expect(bridge.write('sim', 'mem:a', 1)).rejects.toMatchObject({ code: 'DISPOSED' });
  });

  it('validates arguments', async () => {
    const { bridge } = await simSetup();
    expect(() => bridge.subscribe('', 'x', () => {})).toThrow(TypeError);
    expect(() => bridge.subscribe('sim', '', () => {})).toThrow(TypeError);
    expect(() => bridge.subscribe('sim', 'x', 1 as never)).toThrow(TypeError);
  });
});

describe('createHubSignalBridge with a controllable provider', () => {
  async function ctlSetup() {
    const ctl = controllableProvider();
    const { hub } = setup([ctl.provider]);
    hub.setConnections([{ id: 'c', provider: 'test.ctl' }]);
    await hub.settled();
    return { ...ctl, hub, bridge: track(createHubSignalBridge(hub, { now: () => 5 })) };
  }

  it('reports down on a disconnected status and resubscribes on recovery', async () => {
    const { sessions, bridge } = await ctlSetup();
    const samples: Sample[] = [];
    bridge.subscribe('c', 'x', (s) => samples.push(s));
    const entry = sessions[0]!;
    entry.deliver([{ source: 'x', value: 10, ts: 1 }]);
    entry.setStatus('disconnected');
    expect(samples.at(-1)).toEqual({ source: 'x', value: 10, ts: 5, quality: 'uncertain' });
    expect(entry.subscribers.size).toBe(1); // same session: the subscription is kept while down
    const before = [...entry.subscribers][0];
    entry.setStatus('live');
    expect(entry.subscribers.size).toBe(1);
    expect([...entry.subscribers][0]).not.toBe(before); // fresh subscription after recovery
  });

  it('a late good delivery while down stays uncertain until recovery (GPT review P1)', async () => {
    const { sessions, bridge } = await ctlSetup();
    const samples: Sample[] = [];
    bridge.subscribe('c', 'x', (s) => samples.push(s));
    const entry = sessions[0]!;
    entry.deliver([{ source: 'x', value: 10, ts: 1, quality: 'good' }]);
    entry.setStatus('disconnected');
    // A queued/cached sample arrives on the old (still active) subscription.
    entry.deliver([{ source: 'x', value: 11, ts: 2, quality: 'good' }]);
    expect(samples.at(-1)).toEqual({ source: 'x', value: 11, ts: 2, quality: 'uncertain' });
    entry.deliver([{ source: 'x', value: 12, ts: 3, quality: 'bad' }]);
    expect(samples.at(-1)).toMatchObject({ value: 12, quality: 'bad' }); // never upgraded
    for (const state of ['connecting', 'error'] as const) {
      entry.setStatus(state);
      entry.deliver([{ source: 'x', value: 13, ts: 4 }]);
      expect(samples.at(-1)).toMatchObject({ value: 13, quality: 'uncertain' });
    }
    entry.setStatus('live');
    entry.deliver([{ source: 'x', value: 14, ts: 5, quality: 'good' }]);
    expect(samples.at(-1)).toMatchObject({ value: 14, quality: 'good' }); // fresh subscription, up again
    entry.setStatus('stale');
    entry.deliver([{ source: 'x', value: 15, ts: 6, quality: 'good' }]);
    expect(samples.at(-1)).toMatchObject({ value: 15, quality: 'good' }); // stale still counts as up
  });

  it('subscribing on an already-disconnected session downgrades its cached first delivery (GPT review P1)', async () => {
    const ctl = controllableProvider('test.ctl', { cached: () => [{ source: 'x', value: 7, ts: 1, quality: 'good' }] });
    const { hub } = setup([ctl.provider]);
    hub.setConnections([{ id: 'c', provider: 'test.ctl' }]);
    await hub.settled();
    ctl.sessions[0]!.setStatus('disconnected');
    const bridge = track(createHubSignalBridge(hub, { now: () => 5 }));
    const samples: Sample[] = [];
    bridge.subscribe('c', 'x', (s) => samples.push(s));
    expect(samples).toEqual([{ source: 'x', value: 7, ts: 1, quality: 'uncertain' }]);
    ctl.sessions[0]!.setStatus('live'); // recovery resubscribes: the cache is now trusted
    expect(samples.at(-1)).toEqual({ source: 'x', value: 7, ts: 1, quality: 'good' });
  });

  it('refuses writes to a session that is not up, without calling it (GPT review P1)', async () => {
    const writes: Array<{ source: string; value: unknown }> = [];
    const ctl = controllableProvider('test.ctl', { writes });
    const { hub } = setup([ctl.provider]);
    hub.setConnections([{ id: 'c', provider: 'test.ctl' }]);
    await hub.settled();
    const bridge = track(createHubSignalBridge(hub));
    const entry = ctl.sessions[0]!;
    for (const state of ['disconnected', 'connecting', 'error'] as const) {
      entry.setStatus(state);
      await expect(bridge.write('c', 'y', 1)).rejects.toMatchObject({ name: 'ProviderHubError', code: 'NOT_CONNECTED' });
    }
    expect(writes).toEqual([]);
    entry.setStatus('stale');
    await bridge.write('c', 'y', 2);
    entry.setStatus('live');
    await bridge.write('c', 'y', 3);
    expect(writes).toEqual([
      { source: 'y', value: 2 },
      { source: 'y', value: 3 },
    ]);
  });

  it('picks the last matching sample of a batch and ignores junk', async () => {
    const { sessions, bridge } = await ctlSetup();
    const samples: Sample[] = [];
    bridge.subscribe('c', 'x', (s) => samples.push(s));
    const entry = sessions[0]!;
    entry.deliver('not an array');
    entry.deliver([null, { source: 'y', value: 1 }, { source: 'x', value: Number.NaN }, { source: 'x', value: { a: 1 } }]);
    expect(samples).toEqual([]);
    entry.deliver([
      { source: 'x', value: 1, ts: 11 },
      { source: 'x', value: 2, ts: Number.NaN, quality: 'weird' },
    ]);
    expect(samples).toEqual([{ source: 'x', value: 2, ts: 5, quality: 'uncertain' }]);
  });

  it('drops deliveries from a superseded subscription', async () => {
    const { sessions, bridge, hub } = await ctlSetup();
    const samples: Sample[] = [];
    bridge.subscribe('c', 'x', (s) => samples.push(s));
    const oldCallback = [...sessions[0]!.subscribers][0]!;
    hub.setConnections([{ id: 'c', provider: 'test.ctl', config: { n: 2 } }]);
    await hub.settled();
    oldCallback([{ source: 'x', value: 99, ts: 0 }]);
    expect(samples.some((s) => s.value === 99)).toBe(false);
  });

  it('a subscriber that unsubscribes during a synchronous first delivery leaks nothing', async () => {
    const manual = createManualSchedule();
    const { hub } = setup([createSimProvider({ schedule: manual.schedule })]);
    hub.setConnections([{ id: 'sim', provider: 'holodeck.sim' }]);
    await hub.settled();
    const bridge = track(createHubSignalBridge(hub));
    let off: (() => void) | undefined;
    let calls = 0;
    off = bridge.subscribe('sim', 'const:1', () => {
      calls++;
      off?.();
    });
    expect(manual.active).toBe(1); // `off` was not assigned yet during the first delivery
    off();
    expect(manual.active).toBe(0);
    // Now the synchronous case proper: release from inside the callback once `off` exists.
    const second = bridge.subscribe('sim', 'const:2', () => {
      calls++;
    });
    second();
    expect(manual.active).toBe(0);
    expect(calls).toBe(2);
  });

  it('a bridge disposed from inside a synchronous first delivery releases that subscription', async () => {
    const manual = createManualSchedule();
    const { hub } = setup([createSimProvider({ schedule: manual.schedule })]);
    hub.setConnections([{ id: 'sim', provider: 'holodeck.sim' }]);
    await hub.settled();
    const bridge = track(createHubSignalBridge(hub));
    const cb = vi.fn(() => bridge.dispose());
    bridge.subscribe('sim', 'const:1', cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(manual.active).toBe(0); // the handle returned after the delivery was released at once
    manual.tick();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a callback that changes the hub during sync is bounded and consistent', async () => {
    const { hub, bridge, sessions } = await ctlSetup();
    let flips = 0;
    bridge.subscribe('c', 'x', (sample) => {
      if (sample.quality === 'uncertain' && flips < 3) {
        flips++;
        hub.setConnections([{ id: 'c', provider: 'test.ctl', config: { flip: flips } }]);
      }
    });
    hub.setConnections([]);
    await hub.settled();
    expect(flips).toBeGreaterThan(0);
    const live = sessions.filter((s) => !s.closed);
    expect(live).toHaveLength(1);
    expect(live[0]!.subscribers.size).toBe(1);
    expect(sessions.filter((s) => s.closed).every((s) => s.subscribers.size === 0)).toBe(true);
  });

  it('a throwing subscriber callback is logged, not thrown into the provider', async () => {
    const log = vi.fn();
    const { sessions, hub } = await ctlSetup();
    const bridge = track(createHubSignalBridge(hub, { log }));
    bridge.subscribe('c', 'x', () => {
      throw new Error('cb');
    });
    expect(() => sessions[0]!.deliver([{ source: 'x', value: 1 }])).not.toThrow();
    expect(log).toHaveBeenCalledWith('warn', expect.stringMatching(/subscriber for "x" threw/), expect.any(Error));
  });

  it('reads its options once: swapping the logger afterwards changes nothing (review P3)', async () => {
    const { sessions, hub } = await ctlSetup();
    const first = vi.fn();
    const options: { log?: (...args: unknown[]) => void } = { log: first };
    const bridge = track(createHubSignalBridge(hub, options as never));
    const second = vi.fn();
    options.log = second;
    bridge.subscribe('c', 'x', () => {
      throw new Error('cb');
    });
    sessions[0]!.deliver([{ source: 'x', value: 1 }]);
    expect(first).toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('a session whose subscribe throws reports bad quality and retries on the next session', async () => {
    const bad: HolodeckProvider = {
      id: 'test.bad',
      label: 'Bad',
      capabilities: {},
      async connect() {
        return {
          status: () => ({ state: 'live', since: 0 }),
          onStatus: () => () => {},
          subscribe: () => {
            throw new Error('no subscribe');
          },
          close: async () => {},
        };
      },
    };
    const { hub } = setup([bad]);
    hub.setConnections([{ id: 'b', provider: 'test.bad' }]);
    await hub.settled();
    const bridge = track(createHubSignalBridge(hub));
    const cb = vi.fn();
    bridge.subscribe('b', 'x', cb);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ value: null, quality: 'bad' }));
  });

  it('treats __proto__ as an ordinary connection id', async () => {
    const ctl = controllableProvider();
    const { hub } = setup([ctl.provider]);
    hub.setConnections([{ id: '__proto__', provider: 'test.ctl' }]);
    await hub.settled();
    const bridge = track(createHubSignalBridge(hub));
    const cb = vi.fn();
    bridge.subscribe('__proto__', 'x', cb);
    ctl.sessions[0]!.deliver([{ source: 'x', value: 'ok' }]);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ value: 'ok' }));
    const missing = vi.fn();
    bridge.subscribe('constructor', 'x', missing);
    expect(missing).not.toHaveBeenCalled();
  });
});

describe('end to end: host + hub + flow.local + sim', () => {
  it('a deployed flow reads one sim signal and writes another', async () => {
    const manual = createManualSchedule();
    const host = new HolodeckHost({ name: 'e2e' });
    host.registry.registerKind(FLOW_BLOCK_KIND);
    let hub!: ProviderHub;
    host.registry.install({
      id: 'e2e.providers',
      version: '1.0.0',
      contributions: {
        [HOLODECK_KINDS.provider]: [
          createSimProvider({ schedule: manual.schedule }),
          // The documented host pattern: one bridge per session, over the document's hub.
          createLocalFlowProvider({ schedule: manual.schedule, signals: () => createHubSignalBridge(hub) }),
        ],
        [FLOW_BLOCK_KIND.kind]: [...TEST_BLOCKS],
      },
    });
    hub = host.createProviderHub();
    const connections = [
      { id: 'sim', provider: 'holodeck.sim' },
      { id: 'flow', provider: 'holodeck.flow.local' },
    ];
    hub.setConnections(connections);
    await hub.settled();
    const doc = flowDoc(
      graph(
        [node('in', 'signal.in', { connection: 'sim', source: 'mem:in' }), node('n', 'test.not'), node('out', 'signal.out', { connection: 'sim', source: 'mem:out' })],
        [wire('w1', 'in.value', 'n.in'), wire('w2', 'n.out', 'out.value')],
      ),
      connections,
    );
    const result = await hub.session('flow')!.deploy!(doc);
    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sim = hub.session('sim')!;
    // The sim delivers the unset mem:in as null: no value, so nothing is written (review P1 repro).
    expect((await sim.read!(['mem:out']))[0]?.value).toBeNull();
    expect((await hub.session('flow')!.read!(['flow:n.out']))[0]).toMatchObject({ quality: 'bad' });
    await sim.write!('mem:in', true);
    manual.tick(); // sim delivers mem:in = true, the flow scans
    manual.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await sim.read!(['mem:out']))[0]?.value).toBe(false);
    // Iso-style binding to the flow's own output through the same hub.
    hub.setBindings([{ objectId: 'lamp', param: 'on', binding: { connection: 'flow', source: 'flow:n.out' } }]);
    expect(hub.getSnapshot().metrics.lamp?.on).toBe(false);
    await hub.dispose();
    expect(manual.active).toBe(0);
  });
});

describe('end to end: quality through the hub bridge (review P1)', () => {
  it('a source connection going down stops writes to another connection; recovery writes again', async () => {
    const manual = createManualSchedule();
    const src = controllableProvider('test.src');
    const writes: Array<{ source: string; value: unknown }> = [];
    const sink = controllableProvider('test.sink', { writes });
    const host = new HolodeckHost({ name: 'e2e' });
    host.registry.registerKind(FLOW_BLOCK_KIND);
    let hub!: ProviderHub;
    host.registry.install({
      id: 'e2e.providers',
      version: '1.0.0',
      contributions: {
        [HOLODECK_KINDS.provider]: [
          src.provider,
          sink.provider,
          createLocalFlowProvider({ schedule: manual.schedule, signals: () => createHubSignalBridge(hub) }),
        ],
        [FLOW_BLOCK_KIND.kind]: [...TEST_BLOCKS],
      },
    });
    hub = host.createProviderHub();
    const connections = [
      { id: 'level', provider: 'test.src' },
      { id: 'pump', provider: 'test.sink' },
      { id: 'flow', provider: 'holodeck.flow.local' },
    ];
    hub.setConnections(connections);
    await hub.settled();
    const doc = flowDoc(
      graph(
        [node('lvl', 'signal.in', { connection: 'level', source: 'HighLevel' }), node('n', 'test.not'), node('run', 'signal.out', { connection: 'pump', source: 'PumpRun' })],
        [wire('w1', 'lvl.value', 'n.in'), wire('w2', 'n.out', 'run.value')],
      ),
      connections,
    );
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const scan = async () => {
      manual.tick();
      await settle();
    };
    expect(await hub.session('flow')!.deploy!(doc)).toMatchObject({ ok: true });
    await settle();
    // Startup: the first scan ran before any sample. PumpRun = NOT(nothing) must not be written.
    await scan();
    expect(writes).toEqual([]);
    const level = src.sessions[0]!;
    level.deliver([{ source: 'HighLevel', value: false, ts: 1, quality: 'good' }]);
    await scan();
    expect(writes).toEqual([{ source: 'PumpRun', value: true }]);
    // The level connection drops: the bridge holds HighLevel = false as uncertain, the pump write stops.
    level.setStatus('disconnected');
    await scan();
    await scan();
    expect(writes).toHaveLength(1);
    expect((await hub.session('flow')!.read!(['flow:lvl.value', 'flow:n.out']))).toMatchObject([
      { value: false, quality: 'uncertain' },
      { value: true, quality: 'uncertain' },
    ]);
    // Recovery: a fresh subscription delivers the current value, and the pump is written again.
    level.setStatus('live');
    level.deliver([{ source: 'HighLevel', value: false, ts: 2, quality: 'good' }]);
    await scan();
    expect(writes).toEqual([
      { source: 'PumpRun', value: true },
      { source: 'PumpRun', value: true },
    ]);
    level.deliver([{ source: 'HighLevel', value: true, ts: 3, quality: 'good' }]);
    await scan();
    expect(writes.at(-1)).toEqual({ source: 'PumpRun', value: false });
    await hub.dispose();
  });
});

describe('end to end: disconnected connections never reopen the write gate (GPT review P1)', () => {
  async function e2e(options: { cached?: () => readonly Sample[] | undefined } = {}) {
    const manual = createManualSchedule();
    const src = controllableProvider('test.src', options);
    const writes: Array<{ source: string; value: unknown }> = [];
    const sink = controllableProvider('test.sink', { writes });
    const host = new HolodeckHost({ name: 'e2e' });
    host.registry.registerKind(FLOW_BLOCK_KIND);
    let hub!: ProviderHub;
    host.registry.install({
      id: 'e2e.providers',
      version: '1.0.0',
      contributions: {
        [HOLODECK_KINDS.provider]: [
          src.provider,
          sink.provider,
          createLocalFlowProvider({ schedule: manual.schedule, signals: () => createHubSignalBridge(hub), writeRetryMs: 0 }),
        ],
        [FLOW_BLOCK_KIND.kind]: [...TEST_BLOCKS],
      },
    });
    hub = host.createProviderHub();
    const connections = [
      { id: 'level', provider: 'test.src' },
      { id: 'pump', provider: 'test.sink' },
      { id: 'flow', provider: 'holodeck.flow.local' },
    ];
    hub.setConnections(connections);
    await hub.settled();
    const doc = flowDoc(
      graph(
        [node('lvl', 'signal.in', { connection: 'level', source: 'HighLevel' }), node('n', 'test.not'), node('run', 'signal.out', { connection: 'pump', source: 'PumpRun' })],
        [wire('w1', 'lvl.value', 'n.in'), wire('w2', 'n.out', 'run.value')],
      ),
      connections,
    );
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const scan = async () => {
      manual.tick();
      await settle();
    };
    return { hub, src, sink, writes, doc, scan, settle };
  }

  it('a late good sample after disconnect is not written through', async () => {
    const { hub, src, writes, doc, scan, settle } = await e2e();
    expect(await hub.session('flow')!.deploy!(doc)).toMatchObject({ ok: true });
    await settle();
    const level = src.sessions[0]!;
    level.deliver([{ source: 'HighLevel', value: false, ts: 1, quality: 'good' }]);
    await scan();
    expect(writes).toEqual([{ source: 'PumpRun', value: true }]);
    level.setStatus('disconnected');
    await scan();
    // The repro from the review: a late `good` sample with a new value arrives while still disconnected.
    level.deliver([{ source: 'HighLevel', value: true, ts: 2, quality: 'good' }]);
    await scan();
    await scan();
    expect(hub.getSnapshot().connections.level?.status.state).toBe('disconnected');
    expect(await hub.session('flow')!.read!(['flow:lvl.value', 'flow:n.out'])).toMatchObject([
      { value: true, quality: 'uncertain' },
      { value: false, quality: 'uncertain' },
    ]);
    expect(writes).toEqual([{ source: 'PumpRun', value: true }]); // PumpRun=false never sent
    level.setStatus('live');
    level.deliver([{ source: 'HighLevel', value: true, ts: 3, quality: 'good' }]);
    await scan();
    expect(writes.at(-1)).toEqual({ source: 'PumpRun', value: false });
    await hub.dispose();
  });

  it('deploying onto an already-disconnected source connection writes nothing, even from its cache', async () => {
    const { hub, src, writes, doc, scan, settle } = await e2e({ cached: () => [{ source: 'HighLevel', value: false, ts: 1, quality: 'good' }] });
    src.sessions[0]!.setStatus('disconnected');
    expect(await hub.session('flow')!.deploy!(doc)).toMatchObject({ ok: true });
    await settle();
    await scan();
    await scan();
    expect(writes).toEqual([]);
    expect((await hub.session('flow')!.read!(['flow:lvl.value']))[0]).toMatchObject({ value: false, quality: 'uncertain' });
    src.sessions[0]!.setStatus('live'); // recovery: the resubscription's first delivery is trusted
    await scan();
    await scan();
    expect(writes).toEqual([{ source: 'PumpRun', value: true }]);
    await hub.dispose();
  });

  it('a disconnected target connection faults signal.out instead of writing; recovery writes', async () => {
    const { hub, src, sink, writes, doc, scan, settle } = await e2e();
    sink.sessions[0]!.setStatus('disconnected');
    expect(await hub.session('flow')!.deploy!(doc)).toMatchObject({ ok: true });
    await settle();
    src.sessions[0]!.deliver([{ source: 'HighLevel', value: false, ts: 1, quality: 'good' }]);
    await scan();
    await scan();
    expect(writes).toEqual([]);
    expect((await hub.session('flow')!.read!(['flow:run.$fault']))[0]?.value).toMatch(/connection "pump" is down/);
    sink.sessions[0]!.setStatus('live');
    await scan();
    await scan();
    expect(writes).toEqual([{ source: 'PumpRun', value: true }]);
    expect((await hub.session('flow')!.read!(['flow:run.$fault']))[0]?.value).toBeNull();
    await hub.dispose();
  });
});

describe('createMemorySignalBridge', () => {
  it('delivers stored values on subscribe and on set; loops writes back', async () => {
    const bridge = createMemorySignalBridge({ now: () => 3 });
    const a = vi.fn();
    const off = bridge.subscribe('c', 's', a);
    expect(a).not.toHaveBeenCalled();
    bridge.set('c', 's', 1);
    expect(a).toHaveBeenLastCalledWith({ source: 's', value: 1, ts: 3, quality: 'good' });
    await bridge.write('c', 's', 2);
    expect(bridge.get('c', 's')).toBe(2);
    expect(a).toHaveBeenCalledTimes(2);
    const b = vi.fn();
    bridge.subscribe('c', 's', b);
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ value: 2 }));
    expect(bridge.subscriptions).toBe(2);
    off();
    off();
    expect(bridge.subscriptions).toBe(1);
    expect(bridge.writes).toEqual([{ connection: 'c', source: 's', value: 2 }]);
    expect(() => bridge.set('c', 's', {} as never)).toThrow(TypeError);
  });

  it('keeps keys with separators apart', () => {
    const bridge = createMemorySignalBridge();
    bridge.set('a\u0000b', 'c', 1);
    bridge.set('a', 'b\u0000c', 2);
    expect([bridge.get('a\u0000b', 'c'), bridge.get('a', 'b\u0000c')]).toEqual([1, 2]);
  });
});
