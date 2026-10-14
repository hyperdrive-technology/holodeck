import {
  createManualSchedule,
  createProviderContext,
  runProviderConformance,
  type HolodeckDocument,
  type HolodeckProvider,
  type ProviderContext,
  type ProviderSession,
  type Sample,
} from '@holodeck/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemorySignalBridge, type SignalBridge } from './bridge';
import { createLocalFlowProvider, LOCAL_FLOW_PROVIDER_ID, type LocalFlowProviderOptions } from './provider';
import { clock, flowDoc, graph, node, registryWith, wire } from './test-helpers';
import type { FlowValue } from './values';

const registry = registryWith();
const plc = { id: 'plc', provider: 'acme.plc' };

/** const(1) + delay loop: `flow:add.sum` counts 1, 2, 3 … one per scan. */
const counterBody = () =>
  graph(
    [node('one', 'flow.const', { value: 1 }), node('add', 'test.add'), node('d', 'flow.delay', { initial: 0 })],
    [wire('w1', 'one.value', 'add.a'), wire('w2', 'd.out', 'add.b'), wire('w3', 'add.sum', 'd.in')],
  );

/** signal.in plc:a → NOT → signal.out plc:b */
const signalBody = () =>
  graph(
    [node('in', 'signal.in', { connection: 'plc', source: 'a' }), node('n', 'test.not'), node('out', 'signal.out', { connection: 'plc', source: 'b' })],
    [wire('w1', 'in.value', 'n.in'), wire('w2', 'n.out', 'out.value')],
  );

interface Harness {
  manual: ReturnType<typeof createManualSchedule>;
  time: ReturnType<typeof clock>;
  provider: HolodeckProvider;
  session: ProviderSession;
  controller: AbortController;
  logs: Array<[string, string]>;
}

async function connect(options: LocalFlowProviderOptions = {}, config: Record<string, unknown> = {}, context: Partial<ProviderContext> = {}): Promise<Harness> {
  const manual = createManualSchedule();
  const time = clock();
  const controller = new AbortController();
  const logs: Array<[string, string]> = [];
  const provider = createLocalFlowProvider({ schedule: manual.schedule, now: time.now, ...options });
  const session = await provider.connect(
    config,
    createProviderContext({ registry, signal: controller.signal, now: time.now, log: (level, message) => logs.push([level, message]), ...context }),
  );
  return { manual, time, provider, session, controller, logs };
}

let unhandled: ReturnType<typeof vi.fn>;
beforeEach(() => {
  unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
});
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
});

describe('descriptor', () => {
  it('declares deploy, read and browse', () => {
    const provider = createLocalFlowProvider();
    expect(provider).toMatchObject({ id: LOCAL_FLOW_PROVIDER_ID, capabilities: { deploy: true, read: true, browse: true } });
    expect(provider.id).toBe('holodeck.flow.local');
    expect(provider.sourceSyntax).toMatch(/flow:<nodeId>\.<port>/);
    expect(provider.configSchema).toMatchObject({ properties: { scanMs: { type: 'integer' } }, additionalProperties: false });
    expect(Object.isFrozen(provider) && Object.isFrozen(provider.capabilities) && Object.isFrozen(provider.configSchema)).toBe(true);
  });

  it('validates its options eagerly and reads them once', () => {
    expect(() => createLocalFlowProvider({ scanMs: 1 })).toThrow(RangeError);
    expect(() => createLocalFlowProvider({ writeRetryMs: -1 })).toThrow(RangeError);
    expect(() => createLocalFlowProvider({ writeTimeoutMs: 0 })).toThrow(RangeError);
    expect(() => createLocalFlowProvider({ writeTimeoutMs: Number.NaN })).toThrow(RangeError);
    expect(() => createLocalFlowProvider({ schedule: 3 as never })).toThrow(TypeError);
    expect(() => createLocalFlowProvider({ signals: 'x' as never })).toThrow(TypeError);
    expect(() => createLocalFlowProvider(null as never)).toThrow(TypeError);
  });
});

describe('runProviderConformance', () => {
  it('passes without a deployment (every source reads null/bad)', async () => {
    const manual = createManualSchedule();
    const failures: string[] = [];
    await runProviderConformance(
      () => createLocalFlowProvider({ schedule: manual.schedule }),
      { sources: ['flow:a.out', 'flow:b.value'], flush: () => manual.tick(), wait: async () => {} },
      (ok, message) => {
        if (!ok) failures.push(message);
      },
    );
    expect(failures).toEqual([]);
  });

  it('passes with a deployed flow whose values change every scan', async () => {
    const manual = createManualSchedule();
    const failures: string[] = [];
    let sessions = 0;
    const makeProvider = (): HolodeckProvider => {
      const inner = createLocalFlowProvider({ schedule: manual.schedule });
      return {
        ...inner,
        async connect(config, ctx) {
          const session = await inner.connect(config, ctx);
          const result = await session.deploy!(flowDoc(counterBody()));
          if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
          sessions++;
          return session;
        },
      };
    };
    await runProviderConformance(
      makeProvider,
      { sources: ['flow:add.sum', 'flow:d.out', 'flow:add.$fault'], context: { registry }, flush: () => manual.tick(), wait: async () => {} },
      (ok, message) => {
        if (!ok) failures.push(message);
      },
    );
    expect(failures).toEqual([]);
    expect(sessions).toBe(1);
    expect(manual.active).toBe(0); // close() stopped the run
  });
});

describe('deploy', () => {
  it('runs the flow and returns its sources', async () => {
    const { session, manual } = await connect();
    const result = await session.deploy!(flowDoc(counterBody()));
    expect(result).toEqual({
      ok: true,
      diagnostics: [],
      sources: ['flow:one.value', 'flow:one.$fault', 'flow:add.sum', 'flow:add.$fault', 'flow:d.out', 'flow:d.$fault'],
    });
    expect((await session.read!(['flow:add.sum']))[0]).toMatchObject({ value: 1, quality: 'good' }); // first scan ran
    manual.tick();
    manual.tick();
    expect((await session.read!(['flow:add.sum']))[0]?.value).toBe(3);
    expect(session.status()).toMatchObject({ state: 'live', message: 'running "Test flow"' });
  });

  it('uses the scan period from the connection config', async () => {
    const schedule = vi.fn(() => () => {});
    const { session } = await connect({ schedule }, { scanMs: 250 });
    await session.deploy!(flowDoc(counterBody()));
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 250);
  });

  it('rejects malformed config at connect', async () => {
    await expect(connect({}, { scanMs: 5 })).rejects.toThrow(RangeError);
    await expect(connect({}, { speed: 1 })).rejects.toThrow(/unknown field "speed"/);
    await expect(connect({}, [] as never)).rejects.toThrow(TypeError);
  });

  it('lists every problem with typed codes and keeps the previous flow running', async () => {
    const { session, manual } = await connect();
    expect((await session.deploy!(flowDoc(counterBody()))).ok).toBe(true);
    const bad = flowDoc(
      graph(
        [node('x', 'acme.pump'), node('s', 'signal.in', { connection: 'ghost', source: 'a' }), node('n', 'test.not')],
        [wire('w', 'n.out', 'n.in')],
      ),
      [],
      { engine: 'holodeck.iso', engineVersion: '2.0.0' },
    );
    const result = await session.deploy!(bad);
    expect(result.ok).toBe(false);
    expect(result.sources).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toEqual(['WRONG_ENGINE', 'UNSUPPORTED_ENGINE_VERSION', 'UNKNOWN_BLOCK', 'CYCLE_WITHOUT_DELAY']);
    expect(result.diagnostics.find((d) => d.code === 'UNKNOWN_BLOCK')).toMatchObject({ severity: 'error', objectId: 'x' });
    manual.tick();
    expect((await session.read!(['flow:add.sum']))[0]?.value).toBe(2); // old flow still scanning
    expect(manual.active).toBe(1);
  });

  it('reports signal blocks naming connections the document does not have', async () => {
    const { session } = await connect({ signals: createMemorySignalBridge() });
    const result = await session.deploy!(flowDoc(signalBody(), []));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_CONNECTION', objectId: 'in' }),
      expect.objectContaining({ code: 'UNKNOWN_CONNECTION', objectId: 'out' }),
    ]);
  });

  it('reports an invalid envelope', async () => {
    const { session } = await connect();
    const result = await session.deploy!({ format: 'nope', body: graph([]) } as never);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.every((d) => d.code === 'INVALID_DOCUMENT' || d.code === 'WRONG_ENGINE')).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(2);
  });

  it('accepts documents without engineVersion and with any 1.x', async () => {
    const { session } = await connect();
    const doc = flowDoc(graph([]));
    delete doc.engineVersion;
    expect((await session.deploy!(doc)).ok).toBe(true);
    expect((await session.deploy!(flowDoc(graph([]), [], { engineVersion: '1.7.2' }))).ok).toBe(true);
  });

  it('looks blocks up in ctx.registry', async () => {
    const { session } = await connect({}, {}, { registry: registryWith([]) });
    const result = await session.deploy!(flowDoc(graph([node('a', 'test.not')])));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_BLOCK' })]);
  });

  it('returns frozen results', async () => {
    const { session } = await connect();
    const result = await session.deploy!(flowDoc(counterBody()));
    expect(Object.isFrozen(result) && Object.isFrozen(result.diagnostics) && Object.isFrozen(result.sources)).toBe(true);
  });

  it('a redeploy stops the old run; scans and state start fresh', async () => {
    const { session, manual } = await connect();
    await session.deploy!(flowDoc(counterBody()));
    manual.tick();
    await session.deploy!(flowDoc(counterBody()));
    expect(manual.active).toBe(1);
    expect((await session.read!(['flow:add.sum']))[0]?.value).toBe(1);
  });
});

describe('subscribe, read, browse', () => {
  it('delivers current values on subscribe, then changes after each scan', async () => {
    const { session, manual } = await connect();
    await session.deploy!(flowDoc(counterBody()));
    const batches: Sample[][] = [];
    session.subscribe(['flow:add.sum', 'flow:one.value'], (samples) => batches.push([...samples]));
    expect(batches).toEqual([[expect.objectContaining({ source: 'flow:add.sum', value: 1 }), expect.objectContaining({ source: 'flow:one.value', value: 1 })]]);
    manual.tick();
    expect(batches[1]).toEqual([{ source: 'flow:add.sum', value: 2, ts: expect.any(Number), quality: 'good' }]); // const did not change
  });

  it('reads null/bad for sources the running flow does not publish, then real values after deploy', async () => {
    const { session } = await connect();
    const batches: Sample[][] = [];
    session.subscribe(['flow:add.sum'], (samples) => batches.push([...samples]));
    expect(batches[0]).toEqual([expect.objectContaining({ value: null, quality: 'bad' })]);
    await session.deploy!(flowDoc(counterBody()));
    expect(batches[1]).toEqual([expect.objectContaining({ value: 1, quality: 'good' })]);
    await session.deploy!(flowDoc(graph([node('k', 'flow.const')])));
    expect(batches[2]).toEqual([expect.objectContaining({ value: null, quality: 'bad' })]); // source went away
  });

  it('read returns one sample per requested source', async () => {
    const { session } = await connect();
    await session.deploy!(flowDoc(counterBody()));
    expect(await session.read!(['flow:add.sum', 'flow:nope.x', 'flow:add.$fault'])).toEqual([
      expect.objectContaining({ source: 'flow:add.sum', value: 1 }),
      expect.objectContaining({ source: 'flow:nope.x', value: null, quality: 'bad' }),
      expect.objectContaining({ source: 'flow:add.$fault', value: null, quality: 'good' }),
    ]);
  });

  it('browse lists nodes, then each node’s outputs and fault', async () => {
    const { session } = await connect();
    expect(await session.browse!()).toEqual([]);
    await session.deploy!(flowDoc(graph([node('k', 'flow.const', { type: 'bool' }, { label: 'Enable' }), node('n', 'test.not')], [wire('w', 'k.value', 'n.in')])));
    expect(await session.browse!()).toEqual([
      { path: 'k', label: 'Enable', hasChildren: true, description: 'flow.const' },
      { path: 'n', label: 'n', hasChildren: true, description: 'test.not' },
    ]);
    expect(await session.browse!('n')).toEqual([
      { path: 'flow:n.out', label: 'out', source: 'flow:n.out', type: 'boolean', writable: false },
      expect.objectContaining({ path: 'flow:n.$fault', source: 'flow:n.$fault', label: '$fault', type: 'string' }),
    ]);
    expect((await session.browse!('k'))[0]).not.toHaveProperty('type'); // `any` output
    expect(await session.browse!('ghost')).toEqual([]);
    expect(await session.browse!('__proto__')).toEqual([]);
    expect(await session.browse!(42 as never)).toEqual([]);
  });

  it('rejects malformed source lists', async () => {
    const { session } = await connect();
    expect(() => session.subscribe('flow:a.b' as never, () => {})).toThrow(TypeError);
    expect(() => session.subscribe([1] as never, () => {})).toThrow(TypeError);
    expect(() => session.subscribe([], 'x' as never)).toThrow(TypeError);
    await expect(session.read!(null as never)).rejects.toThrow(TypeError);
  });

  it('a throwing subscriber does not break deliveries to others', async () => {
    const { session, manual, logs } = await connect();
    await session.deploy!(flowDoc(counterBody()));
    session.subscribe(['flow:add.sum'], () => {
      throw new Error('bad subscriber');
    });
    const good = vi.fn();
    session.subscribe(['flow:add.sum'], good);
    manual.tick();
    expect(good).toHaveBeenCalledTimes(2);
    expect(logs).toContainEqual(['warn', 'holodeck.flow.local: subscriber threw']);
  });
});

describe('signals', () => {
  it('feeds signal.in from the bridge and writes signal.out through it', async () => {
    const bridge = createMemorySignalBridge();
    bridge.set('plc', 'a', true);
    const { session, manual } = await connect({ signals: bridge });
    const result = await session.deploy!(flowDoc(signalBody(), [plc]));
    expect(result).toMatchObject({ ok: true, diagnostics: [] });
    expect(bridge.subscriptions).toBe(1);
    // The bridge delivered `true` while subscribing, before the first scan.
    expect((await session.read!(['flow:in.value']))[0]).toMatchObject({ value: true, quality: 'good' });
    await Promise.resolve();
    expect(bridge.get('plc', 'b')).toBe(false);
    bridge.set('plc', 'a', false, 'uncertain');
    manual.tick();
    expect((await session.read!(['flow:in.value']))[0]).toMatchObject({ value: false, quality: 'uncertain' });
    await Promise.resolve();
    expect(bridge.get('plc', 'b')).toBe(true);
    expect(bridge.writes.map((w) => w.value)).toEqual([false, true]);
  });

  it('shares one bridge subscription between signal.in nodes reading the same signal', async () => {
    const bridge = createMemorySignalBridge();
    const { session } = await connect({ signals: bridge });
    const body = graph([
      node('a', 'signal.in', { connection: 'plc', source: 'x' }),
      node('b', 'signal.in', { connection: 'plc', source: 'x' }),
      node('c', 'signal.in', { connection: 'plc', source: 'y' }),
    ]);
    await session.deploy!(flowDoc(body, [plc]));
    expect(bridge.subscriptions).toBe(2);
  });

  it('drops a value that is not a JSON scalar (null/bad)', async () => {
    let deliver: (sample: Sample) => void = () => {};
    const bridge: SignalBridge = {
      subscribe: (_c, _s, cb) => {
        deliver = cb;
        return () => {};
      },
      write: async () => {},
    };
    const { session, manual } = await connect({ signals: bridge });
    await session.deploy!(flowDoc(signalBody(), [plc]));
    deliver({ source: 'a', value: { nested: 1 } as never, ts: 0 });
    manual.tick();
    expect((await session.read!(['flow:in.value']))[0]).toMatchObject({ value: null, quality: 'bad' });
    deliver('junk' as never);
    manual.tick();
    expect((await session.read!(['flow:in.value']))[0]).toMatchObject({ value: null, quality: 'bad' });
  });

  it('without a bridge: signal.in reads null/bad, signal.out is faulted, deploy warns', async () => {
    const { session } = await connect();
    const result = await session.deploy!(flowDoc(signalBody(), [plc]));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'NO_SIGNAL_BRIDGE', objectId: 'in' }),
      expect.objectContaining({ severity: 'warning', code: 'NO_SIGNAL_BRIDGE', objectId: 'out' }),
    ]);
    expect(await session.read!(['flow:in.value', 'flow:out.$fault'])).toEqual([
      expect.objectContaining({ value: null, quality: 'bad' }),
      expect.objectContaining({ value: 'no signal bridge: writes are dropped' }),
    ]);
  });

  it('a bridge whose subscribe throws: warning, node faulted, deploy still ok', async () => {
    const bridge: SignalBridge = {
      subscribe: () => {
        throw new Error('offline');
      },
      write: async () => {},
    };
    const { session } = await connect({ signals: bridge });
    const result = await session.deploy!(flowDoc(signalBody(), [plc]));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'SIGNAL_SUBSCRIBE_FAILED', objectId: 'in' })]);
    expect((await session.read!(['flow:in.$fault']))[0]?.value).toMatch(/offline/);
  });

  it('the bridge factory runs per session and its bridge is disposed on close', async () => {
    const dispose = vi.fn();
    const factory = vi.fn((ctx: ProviderContext) => ({ ...createMemorySignalBridge(), dispose, ctxId: ctx.connectionId }));
    const { session } = await connect({ signals: factory });
    expect(factory).toHaveBeenCalledTimes(1);
    await session.close();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('a shared bridge instance is not disposed by a session', async () => {
    const dispose = vi.fn();
    const { session } = await connect({ signals: { ...createMemorySignalBridge(), dispose } as SignalBridge });
    await session.close();
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe('writes', () => {
  function deferredBridge() {
    const pending: Array<{ value: FlowValue; resolve: () => void; reject: (e: unknown) => void }> = [];
    const bridge = createMemorySignalBridge({
      write: (_c, _s, value) => new Promise<void>((resolve, reject) => pending.push({ value, resolve, reject })),
    });
    return { bridge, pending };
  }

  it('keeps one write in flight and sends only the newest value next', async () => {
    const { bridge, pending } = deferredBridge();
    const { session, manual } = await connect({ signals: bridge });
    await session.deploy!(flowDoc(signalBody(), [plc]));
    expect(pending.map((p) => p.value)).toEqual([true]); // NOT(null → false)
    for (const v of [true, false, true]) {
      bridge.set('plc', 'a', v);
      manual.tick();
    }
    expect(pending).toHaveLength(1);
    pending[0]!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // The newest value (NOT true = false) is sent; the intermediate ones are skipped.
    expect(pending.map((p) => p.value)).toEqual([true, false]);
  });

  it('does not resend a value equal to the last successful write', async () => {
    const { bridge, pending } = deferredBridge();
    const { session, manual } = await connect({ signals: bridge });
    await session.deploy!(flowDoc(signalBody(), [plc]));
    bridge.set('plc', 'a', true); // → false
    manual.tick();
    bridge.set('plc', 'a', false); // → true again, while the first write is in flight
    manual.tick();
    pending[0]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending.map((p) => p.value)).toEqual([true]);
  });

  it('faults the node on failure and retries no sooner than writeRetryMs', async () => {
    let fail = true;
    const attempts: FlowValue[] = [];
    const bridge = createMemorySignalBridge({
      write: async (_c, _s, value) => {
        attempts.push(value);
        if (fail) throw new Error('PLC offline');
      },
    });
    const { session, manual, time, logs } = await connect({ signals: bridge, writeRetryMs: 1000 });
    await session.deploy!(flowDoc(signalBody(), [plc]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    manual.tick();
    expect((await session.read!(['flow:out.$fault']))[0]?.value).toMatch(/write to "b" on "plc" failed: PLC offline/);
    expect(logs).toContainEqual(['warn', 'signal.out "out": write failed']);
    time.advance(500);
    manual.tick();
    expect(attempts).toHaveLength(1);
    time.advance(600);
    fail = false;
    manual.tick();
    expect(attempts).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    manual.tick();
    expect((await session.read!(['flow:out.$fault']))[0]?.value).toBeNull();
  });

  it('clears the fault when the value returns to the last good write (review P2)', async () => {
    const bridge = createMemorySignalBridge({
      write: (_c, _s, value) => {
        if (value === 2) throw new Error('rejected 2');
      },
    });
    const { session, manual } = await connect({ signals: bridge, writeRetryMs: 0 });
    const doc = flowDoc(
      graph([node('i', 'signal.in', { connection: 'plc', source: 'a' }), node('o', 'signal.out', { connection: 'plc', source: 'b' })], [wire('w', 'i.value', 'o.value')]),
      [plc],
    );
    bridge.set('plc', 'a', 1);
    await session.deploy!(doc);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    for (const v of [2, 1]) {
      bridge.set('plc', 'a', v);
      manual.tick();
      await settle();
      manual.tick();
      await settle();
    }
    for (let i = 0; i < 3; i++) {
      manual.tick();
      await settle();
    }
    expect((await session.read!(['flow:o.$fault']))[0]?.value).toBeNull();
    const values = bridge.writes.map((w) => w.value);
    expect(values[0]).toBe(1);
    expect(values.slice(1).every((v) => v === 2)).toBe(true); // 1 is never re-sent: the target still holds it
  });

  it('a write with no answer times out, faults the node, retries, and ignores the late answer', async () => {
    const pending: Array<{ value: FlowValue; resolve: () => void }> = [];
    const bridge = createMemorySignalBridge({ write: (_c, _s, value) => new Promise<void>((resolve) => pending.push({ value, resolve })) });
    const { session, manual, time } = await connect({ signals: bridge, writeTimeoutMs: 5000, writeRetryMs: 1000 });
    await session.deploy!(flowDoc(signalBody(), [plc]));
    expect(pending).toHaveLength(1);
    time.advance(4999);
    manual.tick();
    expect((await session.read!(['flow:out.$fault']))[0]?.value).toBeNull();
    time.advance(1);
    manual.tick(); // timed out: faulted, retry waits writeRetryMs
    expect(pending).toHaveLength(1);
    manual.tick();
    expect((await session.read!(['flow:out.$fault']))[0]?.value).toMatch(/no answer within 5000 ms/);
    time.advance(1000);
    manual.tick(); // retry
    expect(pending).toHaveLength(2);
    pending[0]!.resolve(); // the timed-out write answers late: ignored
    await new Promise((resolve) => setTimeout(resolve, 0));
    manual.tick();
    expect((await session.read!(['flow:out.$fault']))[0]?.value).toMatch(/no answer/);
    pending[1]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    manual.tick();
    manual.tick();
    expect((await session.read!(['flow:out.$fault']))[0]?.value).toBeNull();
  });

  it('a write that throws synchronously is a failure, not an exception', async () => {
    const bridge: SignalBridge = {
      subscribe: () => () => {},
      write: () => {
        throw new Error('sync boom');
      },
    };
    const { session, manual } = await connect({ signals: bridge });
    expect((await session.deploy!(flowDoc(signalBody(), [plc]))).ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    manual.tick();
    expect((await session.read!(['flow:out.$fault']))[0]?.value).toMatch(/sync boom/);
  });

  it('a write finishing after a redeploy or close touches nothing', async () => {
    const { bridge, pending } = deferredBridge();
    const { session, manual } = await connect({ signals: bridge });
    await session.deploy!(flowDoc(signalBody(), [plc]));
    await session.deploy!(flowDoc(counterBody()));
    pending[0]!.reject(new Error('late failure'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    manual.tick();
    expect((await session.read!(['flow:add.$fault']))[0]?.value).toBeNull();
    await session.deploy!(flowDoc(signalBody(), [plc]));
    await session.close();
    pending[1]!.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending).toHaveLength(2);
  });
});

describe('close', () => {
  it('stops the run and every bridge subscription; idempotent', async () => {
    const bridge = createMemorySignalBridge();
    const { session, manual } = await connect({ signals: bridge });
    const statuses: string[] = [];
    session.onStatus((s) => statuses.push(s.state));
    await session.deploy!(flowDoc(signalBody(), [plc]));
    expect(manual.active).toBe(1);
    expect(bridge.subscriptions).toBe(1);
    await session.close();
    await session.close();
    expect(manual.active).toBe(0);
    expect(bridge.subscriptions).toBe(0);
    expect(session.status().state).toBe('disconnected');
    expect(statuses).toEqual(['live', 'disconnected']);
  });

  it('after close: deploy fails with SESSION_CLOSED, subscribe is inert, reads are null/bad', async () => {
    const { session } = await connect();
    await session.deploy!(flowDoc(counterBody()));
    await session.close();
    expect(await session.deploy!(flowDoc(counterBody()))).toEqual({ ok: false, diagnostics: [expect.objectContaining({ code: 'SESSION_CLOSED' })] });
    const cb = vi.fn();
    session.subscribe(['flow:add.sum'], cb)();
    expect(cb).not.toHaveBeenCalled();
    expect((await session.read!(['flow:add.sum']))[0]).toMatchObject({ value: null, quality: 'bad' });
  });

  it('closes when the context signal aborts (also if already aborted at connect)', async () => {
    const { session, controller, manual } = await connect();
    await session.deploy!(flowDoc(counterBody()));
    controller.abort();
    expect(session.status().state).toBe('disconnected');
    expect(manual.active).toBe(0);
    const aborted = new AbortController();
    aborted.abort();
    const late = await connect({}, {}, { signal: aborted.signal });
    expect(late.session.status().state).toBe('disconnected');
  });
});

describe('hazards', () => {
  describe('(a) caller state is snapshotted', () => {
    it('editing the deployed document afterwards changes nothing', async () => {
      const { session, manual } = await connect();
      const doc = flowDoc(counterBody());
      await session.deploy!(doc);
      const body = doc.body as ReturnType<typeof counterBody>;
      body.nodes[0]!.params!.value = 100;
      body.wires.length = 0;
      doc.name = 'renamed';
      manual.tick();
      expect((await session.read!(['flow:add.sum']))[0]?.value).toBe(2);
      expect(session.status().message).toBe('running "Test flow"');
    });

    it('editing a subscribed source array afterwards changes nothing', async () => {
      const { session, manual } = await connect();
      await session.deploy!(flowDoc(counterBody()));
      const sources = ['flow:add.sum'];
      const seen: string[] = [];
      session.subscribe(sources, (samples) => samples.forEach((s) => seen.push(s.source)));
      sources.push('flow:one.value');
      sources[0] = 'flow:d.out';
      manual.tick();
      expect(new Set(seen)).toEqual(new Set(['flow:add.sum']));
    });

    it('subscribe validates and uses one copy of the sources (no iterator or getter tricks)', async () => {
      const { session } = await connect();
      await session.deploy!(flowDoc(counterBody()));
      const tricky = ['flow:add.sum'];
      Object.defineProperty(tricky, Symbol.iterator, {
        value: function* () {
          yield 42;
        },
      });
      const seen: unknown[] = [];
      session.subscribe(tricky, (samples) => samples.forEach((sample) => seen.push(sample.source)));
      let reads = 0;
      const flipping: string[] = [];
      Object.defineProperty(flipping, 0, { enumerable: true, get: () => (reads++ === 0 ? 'flow:d.out' : (42 as never)) });
      session.subscribe(flipping, (samples) => samples.forEach((sample) => seen.push(sample.source)));
      expect(seen).toEqual(['flow:add.sum', 'flow:d.out']);
      expect(reads).toBe(1);
    });

    it('editing the provider options afterwards changes nothing', async () => {
      const manual = createManualSchedule();
      const options: LocalFlowProviderOptions = { schedule: manual.schedule, scanMs: 100 };
      const provider = createLocalFlowProvider(options);
      options.scanMs = 5;
      options.schedule = () => {
        throw new Error('swapped');
      };
      const session = await provider.connect({}, createProviderContext({ registry }));
      expect((await session.deploy!(flowDoc(counterBody()))).ok).toBe(true);
    });

    it('hands out frozen samples and statuses', async () => {
      const { session } = await connect();
      await session.deploy!(flowDoc(counterBody()));
      let batch: readonly Sample[] = [];
      session.subscribe(['flow:add.sum'], (samples) => (batch = samples));
      expect(Object.isFrozen(batch) && Object.isFrozen(batch[0])).toBe(true);
      expect(Object.isFrozen(session.status())).toBe(true);
      expect(Object.isFrozen((await session.read!(['flow:add.sum']))[0])).toBe(true);
    });
  });

  describe('(b) synchronous callbacks re-entering', () => {
    it('a subscriber closing the session during its first delivery', async () => {
      const { session, manual } = await connect();
      await session.deploy!(flowDoc(counterBody()));
      const cb = vi.fn(() => void session.close());
      const off = session.subscribe(['flow:add.sum'], cb);
      expect(session.status().state).toBe('disconnected');
      expect(manual.active).toBe(0);
      manual.tick();
      off();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('a subscriber redeploying during a scan delivery: no stale deliveries after it', async () => {
      const { session, manual } = await connect();
      await session.deploy!(flowDoc(counterBody()));
      const first: unknown[] = [];
      const second: unknown[] = [];
      let redeployed = false;
      session.subscribe(['flow:add.sum'], (samples) => {
        first.push(samples[0]?.value);
        if (!redeployed && samples[0]?.value === 2) {
          redeployed = true;
          void session.deploy!(flowDoc(graph([node('add', 'flow.const', { value: 42 })]))); // different flow, same id
        }
      });
      session.subscribe(['flow:add.sum'], (samples) => second.push(samples[0]?.value));
      manual.tick(); // sum = 2 → first subscriber redeploys mid-delivery
      expect(first).toEqual([1, 2, null]);
      // The second subscriber got the redeploy's full delivery (null: no add.sum any more) and never the stale 2.
      expect(second).toEqual([1, null]);
      expect(manual.active).toBe(1);
    });

    it('a status listener closing the session during deploy → SUPERSEDED, nothing left running', async () => {
      const bridge = createMemorySignalBridge();
      const { session, manual } = await connect({ signals: bridge });
      session.onStatus((status) => {
        if (status.message?.startsWith('running')) void session.close();
      });
      const result = await session.deploy!(flowDoc(signalBody(), [plc]));
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SUPERSEDED' })]);
      expect(manual.active).toBe(0);
      expect(bridge.subscriptions).toBe(0);
    });

    it('a status listener deploying again during deploy → the inner deploy wins', async () => {
      const { session, manual } = await connect();
      let inner: Promise<unknown> | undefined;
      session.onStatus((status) => {
        if (status.message === 'running "first"') inner = session.deploy!(flowDoc(graph([node('k', 'flow.const', { value: 9 })]), [], { name: 'second' }));
      });
      const outer = await session.deploy!(flowDoc(counterBody(), [], { name: 'first' }));
      expect(outer.diagnostics).toEqual([expect.objectContaining({ code: 'SUPERSEDED' })]);
      expect(await inner).toMatchObject({ ok: true });
      expect(session.status().message).toBe('running "second"');
      expect(manual.active).toBe(1);
      expect((await session.read!(['flow:k.value']))[0]?.value).toBe(9);
    });

    it('a status listener whose re-entrant deploy fails does not supersede the outer deploy', async () => {
      const { session, manual } = await connect();
      let inner: Promise<{ ok: boolean }> | undefined;
      session.onStatus((status) => {
        if (status.message === 'running "first"' && !inner) inner = session.deploy!(flowDoc(graph([node('x', 'acme.missing')])));
      });
      const outer = await session.deploy!(flowDoc(counterBody(), [], { name: 'first' }));
      expect(outer).toMatchObject({ ok: true, diagnostics: [] });
      expect(await inner).toMatchObject({ ok: false });
      expect(session.status().message).toBe('running "first"');
      manual.tick();
      expect((await session.read!(['flow:add.sum']))[0]?.value).toBe(2);
    });

    it('a bridge write that deploys an invalid flow during the first scan does not supersede the deploy (review P1)', async () => {
      let session!: ProviderSession;
      let inner: Promise<{ ok: boolean }> | undefined;
      const bridge = createMemorySignalBridge({
        write: () => {
          inner ??= session.deploy!(flowDoc({ nodes: 'x' }));
        },
      });
      const harness = await connect({ signals: bridge });
      session = harness.session;
      const body = graph(
        [node('k', 'flow.const', { value: 5 }), node('o', 'signal.out', { connection: 'plc', source: 'x' }), node('c', 'test.counter')],
        [wire('w', 'k.value', 'o.value')],
      );
      const outer = await session.deploy!(flowDoc(body, [plc]));
      expect(outer).toMatchObject({ ok: true, diagnostics: [] });
      expect(await inner).toMatchObject({ ok: false });
      for (let i = 0; i < 5; i++) harness.manual.tick();
      expect((await session.read!(['flow:c.count']))[0]?.value).toBe(6);
      expect(session.status().message).toBe('running "Test flow"');
    });

    it('SCHEDULE_FAILED never tears down a deployment that replaced it meanwhile (review P1)', async () => {
      const manual = createManualSchedule();
      let session!: ProviderSession;
      let calls = 0;
      // First run: ticks at once (its scan's subscriber redeploys), then throws. Later runs: normal.
      const schedule = (tick: () => void, ms: number) => {
        if (++calls > 1) return manual.schedule(tick, ms);
        tick();
        throw new Error('no timers for the first run');
      };
      const harness = await connect({ schedule });
      session = harness.session;
      let redeployed = false;
      session.subscribe(['flow:add.sum'], (samples) => {
        if (!redeployed && samples[0]?.value === 2) {
          redeployed = true;
          void session.deploy!(flowDoc(graph([node('k', 'flow.const', { value: 9 })]), [], { name: 'second' }));
        }
      });
      const outer = await session.deploy!(flowDoc(counterBody(), [], { name: 'first' }));
      expect(outer.diagnostics.map((d) => d.code)).toEqual(['SCHEDULE_FAILED']);
      expect(session.status()).toMatchObject({ state: 'live', message: 'running "second"' });
      expect(manual.active).toBe(1);
      expect((await session.read!(['flow:k.value']))[0]?.value).toBe(9);
    });

    it('a bridge that closes the session while subscribing → SUPERSEDED, its subscription released', async () => {
      const unsubscribe = vi.fn();
      let session!: ProviderSession;
      const bridge: SignalBridge = {
        subscribe: () => {
          void session.close();
          return unsubscribe;
        },
        write: async () => {},
      };
      const harness = await connect({ signals: bridge });
      session = harness.session;
      const result = await session.deploy!(flowDoc(signalBody(), [plc]));
      expect(result.diagnostics.map((d) => d.code)).toContain('SUPERSEDED');
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(harness.manual.active).toBe(0);
    });

    it('a bridge delivering synchronously during subscribe feeds the first scan', async () => {
      const bridge = createMemorySignalBridge();
      bridge.set('plc', 'a', false);
      const { session } = await connect({ signals: bridge });
      await session.deploy!(flowDoc(signalBody(), [plc]));
      expect((await session.read!(['flow:n.out']))[0]?.value).toBe(true);
    });

    it('a schedule that ticks inside start(), whose scan closes the session → SUPERSEDED, status stays disconnected', async () => {
      let session!: ProviderSession;
      const eager = (tick: () => void) => {
        tick(); // e.g. a scheduler that runs the first tick immediately
        return () => {};
      };
      const harness = await connect({ schedule: eager });
      session = harness.session;
      session.subscribe(['flow:add.sum'], (samples) => {
        if (samples[0]?.value === 2) void session.close();
      });
      const result = await session.deploy!(flowDoc(counterBody()));
      expect(result.diagnostics.map((d) => d.code)).toEqual(['SUPERSEDED']);
      expect(session.status().state).toBe('disconnected');
    });

    it('a schedule that throws → SCHEDULE_FAILED, nothing left running, status error', async () => {
      const bridge = createMemorySignalBridge();
      const { session } = await connect({
        signals: bridge,
        schedule: () => {
          throw new Error('no timers here');
        },
      });
      const result = await session.deploy!(flowDoc(signalBody(), [plc]));
      expect(result).toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'SCHEDULE_FAILED', message: expect.stringMatching(/no timers here/) })] });
      expect(bridge.subscriptions).toBe(0);
      expect(session.status()).toMatchObject({ state: 'error' });
      expect((await session.read!(['flow:in.value']))[0]).toMatchObject({ value: null, quality: 'bad' });
    });

    it('a subscriber unsubscribing another during delivery skips it', async () => {
      const { session, manual } = await connect();
      await session.deploy!(flowDoc(counterBody()));
      let off2: () => void = () => {};
      session.subscribe(['flow:add.sum'], () => off2());
      const second = vi.fn();
      off2 = session.subscribe(['flow:add.sum'], second);
      second.mockClear();
      manual.tick();
      expect(second).not.toHaveBeenCalled();
    });
  });

  describe('(d) a throwing host logger (review P2)', () => {
    it('never breaks writes, deploy or close', async () => {
      const failing = createMemorySignalBridge({
        write: () => {
          throw new Error('backend down');
        },
      });
      const dispose = vi.fn();
      const throwingLog = () => {
        throw new Error('logger exploded');
      };
      const { session, manual } = await connect({ signals: () => ({ ...failing, dispose }) }, {}, { log: throwingLog });
      const listener = vi.fn(() => {
        throw new Error('listener');
      });
      session.onStatus(listener);
      session.subscribe(['flow:out.value'], () => {
        throw new Error('subscriber');
      });
      const result = await session.deploy!(flowDoc(signalBody(), [plc]));
      expect(result.ok).toBe(true); // resolved, not rejected, although listener + logger threw
      await new Promise((resolve) => setTimeout(resolve, 0)); // the failed write's handler ran
      manual.tick();
      expect((await session.read!(['flow:out.$fault']))[0]?.value).toMatch(/backend down/);
      await expect(session.close()).resolves.toBeUndefined();
      expect(dispose).toHaveBeenCalledTimes(1); // close ran to the end
      listener.mockClear();
      expect(session.status().state).toBe('disconnected');
      // afterEach asserts that no promise rejection went unhandled.
    });
  });

  describe('(c) async races', () => {
    it('concurrent deploys: both resolve, the last one runs, one schedule', async () => {
      const { session, manual } = await connect();
      const [a, b] = await Promise.all([
        session.deploy!(flowDoc(counterBody(), [], { name: 'a' })),
        session.deploy!(flowDoc(graph([node('k', 'flow.const')]), [], { name: 'b' })),
      ]);
      expect([a.ok, b.ok]).toEqual([true, true]);
      expect(session.status().message).toBe('running "b"');
      expect(manual.active).toBe(1);
    });

    it('close while a deploy is pending: nothing keeps running', async () => {
      const { session, manual } = await connect();
      const deploying = session.deploy!(flowDoc(counterBody()));
      const closing = session.close();
      await Promise.all([deploying, closing]);
      expect(manual.active).toBe(0);
      expect(session.status().state).toBe('disconnected');
      expect((await session.deploy!(flowDoc(counterBody()))).ok).toBe(false);
    });

    it('a close requested from a scan listener mid-scan', async () => {
      const { session, manual } = await connect();
      await session.deploy!(flowDoc(counterBody()));
      session.subscribe(['flow:add.sum'], (samples) => {
        if (samples[0]?.value === 3) void session.close();
      });
      manual.tick();
      manual.tick();
      manual.tick();
      expect(manual.active).toBe(0);
    });
  });

  describe('(e) hostile documents', () => {
    it('__proto__ / constructor ids are plain data', async () => {
      const { session, manual } = await connect();
      const doc = JSON.parse(
        JSON.stringify(flowDoc(graph([node('__proto__', 'flow.const', { value: 1 }), node('constructor', 'test.not')], [wire('w', '__proto__.value', 'constructor.in')]))),
      );
      const result = await session.deploy!(doc);
      expect(result.ok).toBe(true);
      expect(result.sources).toContain('flow:__proto__.value');
      manual.tick();
      expect((await session.read!(['flow:constructor.out']))[0]?.value).toBe(false);
      expect(await session.browse!('__proto__')).toHaveLength(2);
      expect(({} as Record<string, unknown>).value).toBeUndefined();
    });

    it('NUL and control characters in ids are refused', async () => {
      const { session } = await connect();
      const result = await session.deploy!(flowDoc(graph([node('a\u0000b', 'flow.const')])));
      expect(result.diagnostics.map((d) => d.code)).toEqual(['INVALID_NODE']);
    });

    it('a Proxy document or throwing getter is an INVALID_DOCUMENT, not an exception', async () => {
      const { session } = await connect();
      const trap = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('trap');
          },
        },
      );
      expect(await session.deploy!(trap as HolodeckDocument)).toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code: 'INVALID_DOCUMENT', message: expect.stringMatching(/trap/) })],
      });
    });

    it('deeply nested or huge documents are refused before validation', async () => {
      const { session } = await connect();
      let deep: unknown = {};
      for (let i = 0; i < 100; i++) deep = { deep };
      const nested = await session.deploy!(flowDoc(graph([]), [], { metadata: deep as never }));
      expect(nested.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_DOCUMENT', message: expect.stringMatching(/nested deeper/) })]);
      const huge = await session.deploy!(flowDoc({ nodes: new Array(2_000_000).fill(0), wires: [] }));
      expect(huge.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_DOCUMENT', message: expect.stringMatching(/more than/) })]);
    });

    it('non-finite numbers and oversized graphs are listed problems', async () => {
      const { session } = await connect();
      const bad = await session.deploy!(flowDoc(graph([node('a', 'flow.const', { value: Infinity }, { position: { x: Number.NaN, y: 0 } })])));
      expect(bad.diagnostics.map((d) => d.code).sort()).toEqual(['INVALID_NODE', 'INVALID_PARAM']);
      const big = await session.deploy!(flowDoc({ nodes: Array.from({ length: 10_001 }, (_, i) => node(`n${i}`, 'flow.const')), wires: [] }));
      expect(big.diagnostics.map((d) => d.code)).toEqual(['TOO_LARGE']);
    });
  });
});
