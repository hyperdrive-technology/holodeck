import { createManualSchedule } from '@holodeck/sdk';
import { describe, expect, it, vi } from 'vitest';
import type { FlowBlockDefinition, FlowState } from './block';
import { compileFlow } from './compile';
import { createFlowRun, FlowRunError, snapshotState, type FlowRun, type FlowScan } from './run';
import { clock, graph, node, registryWith, TEST_BLOCKS, wire } from './test-helpers';
import { FLOW_LIMITS, type FlowValue } from './values';

const registry = registryWith();

function runOf(body: unknown, extraBlocks: FlowBlockDefinition[] = [], options: Parameters<typeof createFlowRun>[1] = {}): FlowRun {
  const r = extraBlocks.length ? registryWith([...TEST_BLOCKS, ...extraBlocks]) : registry;
  return createFlowRun(compileFlow(body, r), { now: clock().now, ...options });
}

const value = (run: FlowRun, source: string) => run.read(source)?.value;

describe('scans', () => {
  it('evaluates every node in order and publishes outputs', () => {
    const run = runOf(
      graph(
        [node('a', 'flow.const', { type: 'bool', value: true }), node('b', 'flow.const', { type: 'bool', value: true }), node('and', 'test.and'), node('not', 'test.not')],
        [wire('w1', 'a.value', 'and.in1'), wire('w2', 'b.value', 'and.in2'), wire('w3', 'and.out', 'not.in')],
      ),
    );
    expect(run.read('flow:and.out')).toEqual({ value: false, quality: 'uncertain' }); // before the first scan
    const scan = run.step();
    expect(scan.scan).toBe(1);
    expect(value(run, 'flow:and.out')).toBe(true);
    expect(value(run, 'flow:not.out')).toBe(false);
    expect(run.read('flow:not.out')?.quality).toBe('good');
    expect(run.scans).toBe(1);
  });

  it('gives unconnected inputs their defaults (type default, or the port default)', () => {
    const run = runOf(graph([node('p', 'test.probe'), node('and', 'test.and')]));
    run.step();
    expect([value(run, 'flow:p.b'), value(run, 'flow:p.n'), value(run, 'flow:p.s'), value(run, 'flow:p.x')]).toEqual([false, 0, '', null]);
    expect(value(run, 'flow:and.out')).toBe(true); // both instances read default true
  });

  it('passes variadic inputs as a frozen array, sized max(min, highest wired)', () => {
    const seen: unknown[] = [];
    const spy: FlowBlockDefinition = {
      id: 'test.spy',
      label: 'Spy',
      category: 'Test',
      inputs: [{ name: 'in', type: 'number', variadic: true, min: 2, max: 6 }],
      outputs: [],
      evaluate: ({ inputs }) => {
        seen.push(inputs.in);
        return { outputs: {} };
      },
    };
    const run = runOf(graph([node('k', 'flow.const', { value: 7 }), node('s', 'test.spy')], [wire('w', 'k.value', 's.in4')]), [spy]);
    run.step();
    expect(seen[0]).toEqual([0, 0, 0, 7]);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });

  it('converts values from `any` outputs into typed inputs', () => {
    const cases: Array<[FlowValue, [boolean, number, string]]> = [
      [true, [true, 1, 'true']],
      [false, [false, 0, 'false']],
      [0, [false, 0, '0']],
      [2.5, [true, 2.5, '2.5']],
      ['true', [true, 0, 'true']],
      [' FALSE ', [false, 0, ' FALSE ']],
      ['42', [true, 42, '42']],
      ['0', [false, 0, '0']],
      ['', [false, 0, '']],
      ['abc', [false, 0, 'abc']],
      [null, [false, 0, '']],
    ];
    for (const [input, [b, n, s]] of cases) {
      const run = runOf(
        graph(
          [node('k', 'flow.const', { type: typeof input === 'boolean' ? 'bool' : typeof input === 'number' ? 'number' : 'string', value: input }), node('p', 'test.probe')],
          [wire('w1', 'k.value', 'p.b'), wire('w2', 'k.value', 'p.n'), wire('w3', 'k.value', 'p.s'), wire('w4', 'k.value', 'p.x')],
        ),
      );
      run.step();
      const constValue = value(run, 'flow:k.value');
      expect([value(run, 'flow:p.b'), value(run, 'flow:p.n'), value(run, 'flow:p.s')], JSON.stringify(input)).toEqual(
        input === null ? [false, 0, ''] : [b, n, s],
      );
      expect(value(run, 'flow:p.x')).toBe(constValue);
    }
  });

  it('holds an output the block leaves out (or sets to undefined)', () => {
    let emit: Record<string, FlowValue | undefined> = { a: 1, b: 2 };
    const block: FlowBlockDefinition = {
      id: 'test.partial',
      label: 'P',
      category: 'T',
      inputs: [],
      outputs: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      evaluate: () => ({ outputs: emit as Record<string, FlowValue> }),
    };
    const run = runOf(graph([node('p', 'test.partial')]), [block]);
    run.step();
    emit = { b: 3, a: undefined };
    const scan = run.step();
    expect([value(run, 'flow:p.a'), value(run, 'flow:p.b')]).toEqual([1, 3]);
    expect(scan.changes.map((c) => c.port)).toEqual(['b']);
  });

  it('lists only changed outputs after the first scan', () => {
    const run = runOf(graph([node('c', 'test.counter'), node('k', 'flow.const', { value: 1 })]));
    const first = run.step();
    expect(first.changes.map((c) => c.source)).toEqual(['flow:c.count', 'flow:k.value']);
    const second = run.step();
    expect(second.changes).toEqual([{ node: 'c', port: 'count', source: 'flow:c.count', value: 2, quality: 'good' }]);
  });

  it('passes dtMs and nowMs from the clock (0 on the first scan, never negative)', () => {
    const c = clock(5000);
    const seen: Array<[number, number]> = [];
    const block: FlowBlockDefinition = {
      id: 'test.time',
      label: 'T',
      category: 'T',
      inputs: [],
      outputs: [],
      evaluate: ({ dtMs, nowMs }) => {
        seen.push([dtMs, nowMs]);
        return { outputs: {} };
      },
    };
    const run = runOf(graph([node('t', 'test.time')]), [block], { now: c.now });
    run.step();
    c.advance(100);
    run.step();
    c.set(4000); // clock went backwards
    run.step();
    c.set(Number.NaN); // broken clock: previous reading repeats
    run.step();
    expect(seen).toEqual([
      [0, 5000],
      [100, 5100],
      [0, 4000],
      [0, 4000],
    ]);
    expect(run.nowMs).toBe(4000);
  });

  it('reports a throwing clock through onError and keeps scanning', () => {
    const onError = vi.fn();
    const run = runOf(graph([node('c', 'test.counter')]), [], {
      now: () => {
        throw new Error('clock');
      },
      onError,
    });
    expect(run.step().nowMs).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'clock' }));
  });
});

describe('state', () => {
  it('starts from initialState(params) and persists what evaluate returns', () => {
    const run = runOf(graph([node('c', 'test.counter', { start: 10 })]));
    run.step();
    run.step();
    expect(value(run, 'flow:c.count')).toBe(12);
  });

  it('freezes state handed to evaluate: in-place mutation faults the node instead of leaking', () => {
    const block: FlowBlockDefinition<{ n: number }> = {
      id: 'test.mutate',
      label: 'M',
      category: 'T',
      inputs: [],
      outputs: [{ name: 'n', type: 'number' }],
      initialState: () => ({ n: 0 }),
      evaluate: ({ state }) => {
        (state as { n: number }).n++;
        return { outputs: { n: state.n } };
      },
    };
    const run = runOf(graph([node('m', 'test.mutate')]), [block as FlowBlockDefinition]);
    const scan = run.step();
    expect(scan.faults).toEqual([{ node: 'm', message: expect.stringMatching(/read.only|Cannot assign/) }]);
  });

  it('copies returned state: the block keeping and mutating its object later changes nothing', () => {
    const kept: Array<{ list: number[] }> = [];
    const seen: unknown[] = [];
    const block: FlowBlockDefinition = {
      id: 'test.keep',
      label: 'K',
      category: 'T',
      inputs: [],
      outputs: [],
      evaluate: ({ state }) => {
        seen.push(state);
        const next = { list: [1, 2] };
        kept.push(next);
        return { outputs: {}, state: next };
      },
    };
    const run = runOf(graph([node('k', 'test.keep')]), [block]);
    run.step();
    kept[0]!.list.push(99);
    run.step();
    expect(seen[1]).toEqual({ list: [1, 2] });
    expect(Object.isFrozen(seen[1])).toBe(true);
    expect(Object.isFrozen((seen[1] as { list: number[] }).list)).toBe(true);
  });

  it('keeps state when evaluate returns none, clears it with null', () => {
    let mode: 'keep' | 'clear' = 'keep';
    const seen: unknown[] = [];
    const block: FlowBlockDefinition = {
      id: 'test.st',
      label: 'S',
      category: 'T',
      inputs: [],
      outputs: [],
      initialState: () => 5,
      evaluate: ({ state }) => {
        seen.push(state);
        return mode === 'keep' ? { outputs: {} } : { outputs: {}, state: null };
      },
    };
    const run = runOf(graph([node('s', 'test.st')]), [block]);
    run.step();
    mode = 'clear';
    run.step();
    run.step();
    expect(seen).toEqual([5, 5, null]);
  });

  it('faults a node whose state is not JSON-like data', () => {
    for (const bad of [() => 1, new Date(), new Map(), Number.POSITIVE_INFINITY, [undefined], 10n]) {
      const block: FlowBlockDefinition = { id: 'test.badstate', label: 'B', category: 'T', inputs: [], outputs: [], evaluate: () => ({ outputs: {}, state: bad as unknown as FlowState }) };
      const run = runOf(graph([node('b', 'test.badstate')]), [block]);
      expect(run.step().faults, String(bad)).toHaveLength(1);
    }
  });

  it('a node whose initialState throws is faulted from the first scan and never evaluated (review P2)', () => {
    const evaluate = vi.fn(({ state }: { state: unknown }) => ({ outputs: { out: state === null ? -1 : 1 } }));
    const block: FlowBlockDefinition = {
      id: 'test.init',
      label: 'I',
      category: 'T',
      inputs: [],
      outputs: [{ name: 'out', type: 'number' }],
      initialState: () => {
        throw new Error('init boom');
      },
      evaluate,
    };
    const run = runOf(graph([node('i', 'test.init'), node('c', 'test.counter')]), [block]);
    for (let i = 0; i < 3; i++) {
      const scan = run.step();
      expect(scan.faults).toEqual([{ node: 'i', message: 'initialState failed: init boom' }]);
    }
    expect(evaluate).not.toHaveBeenCalled();
    expect(run.read('flow:i.out')).toEqual({ value: 0, quality: 'bad' }); // never -1: no run with a null state
    expect(run.read('flow:i.$fault')?.value).toBe('initialState failed: init boom');
    expect(value(run, 'flow:c.count')).toBe(3); // the rest kept running
  });

  it('snapshotState copies __proto__ keys as data and bounds size and depth', () => {
    const state = snapshotState(JSON.parse('{"__proto__": {"polluted": true}, "a": [1, {"b": null}]}')) as Record<string, unknown>;
    expect(Object.keys(state)).toEqual(['__proto__', 'a']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    let deep: unknown = 1;
    for (let i = 0; i < FLOW_LIMITS.maxStateDepth + 1; i++) deep = [deep];
    expect(() => snapshotState(deep)).toThrow(RangeError);
    expect(() => snapshotState(new Array(FLOW_LIMITS.maxStateValues).fill(0))).toThrow(RangeError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => snapshotState(cyclic)).toThrow();
  });
});

describe('README example', () => {
  /** The on-delay timer from README.md, verbatim. */
  const ton: FlowBlockDefinition<{ elapsed: number }> = {
    id: 'logic.ton',
    label: 'TON',
    category: 'Timers',
    inputs: [{ name: 'in', type: 'bool' }],
    outputs: [{ name: 'q', type: 'bool' }, { name: 'et', type: 'number' }],
    params: { preset: { type: 'number', default: 1000, min: 0, unit: 'ms' } },
    initialState: () => ({ elapsed: 0 }),
    evaluate: ({ inputs, params, state, dtMs }) => {
      const elapsed = inputs.in ? Math.min(state.elapsed + dtMs, params.preset as number) : 0;
      return { outputs: { q: elapsed >= (params.preset as number) && inputs.in === true, et: elapsed }, state: { elapsed } };
    },
  };

  it('a TON timer driven by dtMs turns on after its preset', () => {
    const c = clock();
    const run = runOf(
      graph([node('in', 'signal.in', { connection: 'c', source: 's' }), node('t', 'logic.ton', { preset: 300 })], [wire('w', 'in.value', 't.in')]),
      [ton as FlowBlockDefinition],
      { now: c.now },
    );
    run.setSignal('in', true);
    const q: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      run.step();
      q.push([value(run, 'flow:t.q'), value(run, 'flow:t.et')]);
      c.advance(100);
    }
    expect(q).toEqual([
      [false, 0],
      [false, 100],
      [false, 200],
      [true, 300],
      [true, 300],
    ]);
    run.setSignal('in', false);
    run.step();
    expect([value(run, 'flow:t.q'), value(run, 'flow:t.et')]).toEqual([false, 0]);
  });
});

describe('faults', () => {
  const faultGraph = (mode: string) =>
    graph(
      [node('t', 'flow.const', { type: 'bool', value: true }), node('m', 'test.misbehave', { mode }), node('c', 'test.counter')],
      [wire('w', 't.value', 'm.trigger')],
    );

  it.each([
    ['throw', /boom/],
    ['nan', /output "out" must be number, got NaN/],
    ['string', /output "out" must be number/],
    ['unknown', /unknown output "other"/],
    ['promise', /must be synchronous/],
    ['none', /must return \{ outputs, state\? \}/],
  ])('mode %s faults only that node', (mode, pattern) => {
    const run = runOf(faultGraph(mode));
    const scan = run.step();
    expect(scan.faults).toEqual([{ node: 'm', message: expect.stringMatching(pattern) }]);
    expect(run.read('flow:m.out')).toEqual({ value: 0, quality: 'bad' }); // held (initial) value, bad quality
    expect(run.read('flow:m.$fault')).toEqual({ value: expect.stringMatching(pattern), quality: 'good' });
    expect(value(run, 'flow:c.count')).toBe(1); // the rest kept running
    expect(scan.changes).toContainEqual(expect.objectContaining({ source: 'flow:m.$fault', value: expect.stringMatching(pattern) }));
  });

  it('does not leave unhandled rejections from a block returning a rejected promise', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      runOf(faultGraph('promise')).step();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('faults a string output longer than maxValueLength', () => {
    const block: FlowBlockDefinition = {
      id: 'test.long',
      label: 'L',
      category: 'T',
      inputs: [],
      outputs: [{ name: 's', type: 'string' }],
      evaluate: () => ({ outputs: { s: 'x'.repeat(FLOW_LIMITS.maxValueLength + 1) } }),
    };
    expect(runOf(graph([node('l', 'test.long')]), [block]).step().faults[0]?.message).toMatch(/longer than/);
  });

  it('keeps a faulted node atomic (no partial outputs) and recovers on the next good scan', () => {
    let mode = 'bad';
    const block: FlowBlockDefinition = {
      id: 'test.atomic',
      label: 'A',
      category: 'T',
      inputs: [],
      outputs: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      evaluate: () => (mode === 'bad' ? { outputs: { a: 5, b: Number.NaN } } : { outputs: { a: 6, b: 7 } }),
    };
    const run = runOf(graph([node('x', 'test.atomic')]), [block]);
    run.step();
    expect([value(run, 'flow:x.a'), value(run, 'flow:x.b')]).toEqual([0, 0]);
    mode = 'good';
    const scan = run.step();
    expect([value(run, 'flow:x.a'), value(run, 'flow:x.b')]).toEqual([6, 7]);
    expect(scan.faults).toEqual([]);
    expect(run.read('flow:x.$fault')?.value).toBeNull();
    expect(scan.changes).toContainEqual(expect.objectContaining({ source: 'flow:x.$fault', value: null }));
    expect(run.read('flow:x.a')?.quality).toBe('good');
  });

  it('reportFault shows an external fault until cleared; evaluate faults win', () => {
    const run = runOf(graph([node('c', 'test.counter')]));
    run.reportFault('c', 'write failed');
    expect(run.step().faults).toEqual([{ node: 'c', message: 'write failed' }]);
    run.reportFault('c', null);
    expect(run.step().faults).toEqual([]);
    expect(() => run.reportFault('ghost', 'x')).toThrow(expect.objectContaining({ code: 'UNKNOWN_NODE' }));
  });

  it('snapshot lists faults and every source, frozen and cached per scan', () => {
    const run = runOf(faultGraph('throw'));
    run.step();
    const snap = run.snapshot();
    expect(snap.faults).toEqual({ m: 'boom' });
    expect(Object.keys(snap.values)).toEqual(run.plan.sources);
    expect(Object.isFrozen(snap) && Object.isFrozen(snap.values) && Object.isFrozen(snap.values['flow:m.out'])).toBe(true);
    expect(run.snapshot()).toBe(snap);
    run.step();
    expect(run.snapshot()).not.toBe(snap);
  });
});

describe('delays and feedback', () => {
  it('a counter loop through a delay increments once per scan', () => {
    const run = runOf(
      graph(
        [node('add', 'test.add'), node('one', 'flow.const', { value: 1 }), node('d', 'flow.delay', { initial: 0 })],
        [wire('w1', 'one.value', 'add.a'), wire('w2', 'd.out', 'add.b'), wire('w3', 'add.sum', 'd.in')],
      ),
    );
    const sums: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      run.step();
      sums.push(value(run, 'flow:add.sum'));
    }
    expect(sums).toEqual([1, 2, 3, 4]);
    expect(value(run, 'flow:d.out')).toBe(4);
  });

  it('outputs the initial value before the first scan and null without one', () => {
    const run = runOf(graph([node('d', 'flow.delay', { initial: 'start' }), node('e', 'flow.delay')]));
    expect([value(run, 'flow:d.out'), value(run, 'flow:e.out')]).toEqual(['start', null]);
  });

  it('readers placed before or after the delay both see the previous scan', () => {
    const run = runOf(
      graph(
        [node('before', 'test.probe'), node('c', 'test.counter'), node('d', 'flow.delay', { initial: -1 }), node('after', 'test.probe')],
        [wire('w1', 'c.count', 'd.in'), wire('w2', 'd.out', 'before.x'), wire('w3', 'd.out', 'after.x')],
      ),
    );
    run.step();
    expect([value(run, 'flow:before.x'), value(run, 'flow:after.x')]).toEqual([-1, -1]);
    run.step();
    expect([value(run, 'flow:before.x'), value(run, 'flow:after.x')]).toEqual([1, 1]);
  });

  it('a chain of delays shifts by one scan per delay', () => {
    const run = runOf(
      graph(
        [node('c', 'test.counter'), node('d1', 'flow.delay', { initial: 0 }), node('d2', 'flow.delay', { initial: 0 })],
        [wire('w1', 'c.count', 'd1.in'), wire('w2', 'd1.out', 'd2.in')],
      ),
    );
    const rows: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      run.step();
      rows.push([value(run, 'flow:c.count'), value(run, 'flow:d1.out'), value(run, 'flow:d2.out')]);
    }
    expect(rows).toEqual([
      [1, 1, 0],
      [2, 2, 1],
      [3, 3, 2],
    ]);
  });

  it('an SR-style latch built from logic and a delay holds its state', () => {
    // q = (set OR q_prev) AND NOT reset, with OR built as NOT(AND(NOT a, NOT b)).
    const bodies = graph(
      [
        node('set', 'signal.in', { connection: 'io', source: 'set' }),
        node('reset', 'signal.in', { connection: 'io', source: 'reset' }),
        node('nset', 'test.not'),
        node('nprev', 'test.not'),
        node('nor', 'test.and'),
        node('or', 'test.not'),
        node('nreset', 'test.not'),
        node('q', 'test.and'),
        node('prev', 'flow.delay', { initial: false }),
      ],
      [
        wire('w1', 'set.value', 'nset.in'),
        wire('w2', 'prev.out', 'nprev.in'),
        wire('w3', 'nset.out', 'nor.in1'),
        wire('w4', 'nprev.out', 'nor.in2'),
        wire('w5', 'nor.out', 'or.in'),
        wire('w6', 'reset.value', 'nreset.in'),
        wire('w7', 'or.out', 'q.in1'),
        wire('w8', 'nreset.out', 'q.in2'),
        wire('w9', 'q.out', 'prev.in'),
      ],
    );
    const run = runOf(bodies);
    const q = () => value(run, 'flow:q.out');
    run.setSignal('set', false);
    run.setSignal('reset', false);
    run.step();
    expect(q()).toBe(false);
    run.setSignal('set', true);
    run.step();
    expect(q()).toBe(true);
    run.setSignal('set', false);
    run.step();
    run.step();
    expect(q()).toBe(true); // latched
    run.setSignal('reset', true);
    run.step();
    expect(q()).toBe(false);
  });
});

describe('signals', () => {
  const signalGraph = () =>
    graph(
      [node('in', 'signal.in', { connection: 'plc', source: 'a' }), node('n', 'test.not'), node('out', 'signal.out', { connection: 'plc', source: 'b' })],
      [wire('w1', 'in.value', 'n.in'), wire('w2', 'n.out', 'out.value')],
    );

  it('signal.in publishes the latest external value and its quality, from the next scan', () => {
    const run = runOf(signalGraph());
    run.step();
    expect(run.read('flow:in.value')).toEqual({ value: null, quality: 'uncertain' });
    run.setSignal('in', true, 'good');
    expect(value(run, 'flow:in.value')).toBeNull();
    run.step();
    expect(run.read('flow:in.value')).toEqual({ value: true, quality: 'good' });
    expect(value(run, 'flow:n.out')).toBe(false);
    run.setSignal('in', true, 'uncertain');
    const scan = run.step();
    expect(scan.changes).toEqual([{ node: 'in', port: 'value', source: 'flow:in.value', value: true, quality: 'uncertain' }]);
  });

  it('signal.out reports writes when its input changes, never null, never when unwired', () => {
    const run = runOf(
      graph(
        [
          node('in', 'signal.in', { connection: 'plc', source: 'a' }),
          node('fwd', 'signal.out', { connection: 'plc', source: 'copy' }),
          node('idle', 'signal.out', { connection: 'plc', source: 'nothing' }),
        ],
        [wire('w', 'in.value', 'fwd.value')],
      ),
    );
    expect(run.step().writes).toEqual([]); // null is not written
    run.setSignal('in', 5);
    expect(run.step().writes).toEqual([{ node: 'fwd', connection: 'plc', source: 'copy', value: 5 }]);
    expect(run.step().writes).toEqual([]); // unchanged
    run.setSignal('in', null);
    expect(run.step().writes).toEqual([]);
    run.setSignal('in', 5);
    expect(run.step().writes).toEqual([{ node: 'fwd', connection: 'plc', source: 'copy', value: 5 }]);
  });

  it('writes a computed value on the first scan', () => {
    const run = runOf(signalGraph());
    expect(run.step().writes).toEqual([{ node: 'out', connection: 'plc', source: 'b', value: true }]);
  });

  it('rejects setSignal on other nodes and invalid values', () => {
    const run = runOf(signalGraph());
    expect(() => run.setSignal('n', true)).toThrow(expect.objectContaining({ code: 'NOT_A_SIGNAL' }));
    expect(() => run.setSignal('ghost', true)).toThrow(FlowRunError);
    expect(() => run.setSignal('in', { a: 1 } as never)).toThrow(TypeError);
    expect(() => run.setSignal('in', Number.NaN)).toThrow(TypeError);
    expect(() => run.setSignal('in', 'x'.repeat(FLOW_LIMITS.maxValueLength + 1))).toThrow(TypeError);
    expect(() => run.setSignal('in', 1, 'great' as never)).toThrow(TypeError);
  });
});

describe('scheduling', () => {
  it('start() scans every tick; stop() pauses; start() resumes', () => {
    const manual = createManualSchedule();
    const run = runOf(graph([node('c', 'test.counter')]), [], { schedule: manual.schedule, scanMs: 50 });
    expect(run.state).toBe('idle');
    run.start();
    run.start(); // idempotent
    expect(manual.active).toBe(1);
    expect(run.state).toBe('running');
    manual.tick();
    manual.tick();
    expect(run.scans).toBe(2);
    run.stop();
    expect(manual.active).toBe(0);
    manual.tick();
    expect(run.scans).toBe(2);
    run.start();
    manual.tick();
    expect(run.scans).toBe(3);
  });

  it('passes scanMs to the schedule and validates it', () => {
    const schedule = vi.fn(() => () => {});
    runOf(graph([]), [], { schedule, scanMs: 250 }).start();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 250);
    for (const scanMs of [0, 9, 1.5, Number.NaN, 3_600_001, '100']) {
      expect(() => runOf(graph([]), [], { scanMs: scanMs as number })).toThrow(RangeError);
    }
  });

  it('ignores ticks from a cancelled schedule (a timer that fires late)', () => {
    let tick: () => void = () => {};
    const run = runOf(graph([node('c', 'test.counter')]), [], {
      schedule: (t) => {
        tick = t;
        return () => {}; // cancel that does not actually stop the timer
      },
    });
    run.start();
    const stale = tick;
    run.stop();
    stale();
    expect(run.scans).toBe(0);
    run.start();
    stale();
    expect(run.scans).toBe(0);
    tick();
    expect(run.scans).toBe(1);
  });

  it('rolls back start() when the schedule throws or returns no cancel function', () => {
    const throwing = runOf(graph([]), [], {
      schedule: () => {
        throw new Error('no timers');
      },
    });
    expect(() => throwing.start()).toThrow('no timers');
    expect(throwing.state).toBe('idle');
    const bad = runOf(graph([]), [], { schedule: () => undefined as never });
    expect(() => bad.start()).toThrow(/cancel function/);
    expect(bad.state).toBe('idle');
  });

  it('a tick registered by a schedule that then throws or returns no cancel function stays inert (review P3)', () => {
    for (const ending of ['throw', 'no-cancel'] as const) {
      let tick: () => void = () => {};
      const run = runOf(graph([node('c', 'test.counter')]), [], {
        schedule: (t) => {
          tick = t;
          if (ending === 'throw') throw new Error('half-registered');
          return 42 as never;
        },
      });
      expect(() => run.start()).toThrow();
      tick();
      tick();
      expect(run.scans, ending).toBe(0);
      expect(run.state).toBe('idle');
    }
  });

  it('runs scans with the real setInterval by default', async () => {
    const run = createFlowRun(compileFlow(graph([node('c', 'test.counter')]), registry), { scanMs: 10 });
    run.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    run.dispose();
    expect(run.scans).toBeGreaterThanOrEqual(2);
  });

  it('reports errors from scheduled scans instead of throwing into the timer', () => {
    const manual = createManualSchedule();
    const onError = vi.fn();
    const run = runOf(graph([node('c', 'test.counter')]), [], { schedule: manual.schedule, onError });
    run.subscribe(() => {
      throw new Error('listener');
    });
    run.start();
    expect(() => manual.tick()).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener' }));
  });
});

describe('listeners and re-entrancy', () => {
  it('delivers each scan to every listener; a throwing listener does not stop the others', () => {
    const onError = vi.fn();
    const run = runOf(graph([node('c', 'test.counter')]), [], { onError });
    const seen: number[] = [];
    run.subscribe(() => {
      throw new Error('first');
    });
    run.subscribe((scan) => seen.push(scan.scan));
    run.step();
    expect(seen).toEqual([1]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('refuses a nested step() from a listener (BUSY) so scans are never delivered out of order', () => {
    const run = runOf(graph([node('c', 'test.counter')]));
    const errors: unknown[] = [];
    const order: number[] = [];
    run.subscribe((scan) => {
      order.push(scan.scan);
      try {
        run.step();
      } catch (error) {
        errors.push(error);
      }
    });
    run.subscribe((scan) => order.push(scan.scan));
    run.step();
    expect(order).toEqual([1, 1]);
    expect(errors).toEqual([expect.objectContaining({ code: 'BUSY' })]);
    expect(run.scans).toBe(1);
  });

  it('a listener disposing the run stops delivery to the rest', () => {
    const manual = createManualSchedule();
    const run = runOf(graph([node('c', 'test.counter')]), [], { schedule: manual.schedule });
    const later = vi.fn();
    run.subscribe(() => run.dispose());
    run.subscribe(later);
    run.start();
    manual.tick();
    expect(later).not.toHaveBeenCalled();
    expect(run.state).toBe('disposed');
    expect(manual.active).toBe(0);
    expect(() => run.step()).toThrow(expect.objectContaining({ code: 'DISPOSED' }));
    expect(() => run.start()).toThrow(expect.objectContaining({ code: 'DISPOSED' }));
  });

  it('a listener unsubscribing another one mid-scan skips it', () => {
    const run = runOf(graph([node('c', 'test.counter')]));
    const second = vi.fn();
    let off: () => void = () => {};
    run.subscribe(() => off());
    off = run.subscribe(second);
    run.step();
    expect(second).not.toHaveBeenCalled();
  });

  it('a stop() from inside the schedule call is honoured', () => {
    let run!: FlowRun;
    const cancel = vi.fn();
    run = runOf(graph([]), [], {
      schedule: () => {
        run.stop();
        return cancel;
      },
    });
    run.start();
    expect(run.state).toBe('idle');
    expect(cancel).toHaveBeenCalled();
  });

  it('after dispose, setSignal / reportFault are ignored and subscribe is inert', () => {
    const run = runOf(graph([node('in', 'signal.in', { connection: 'c', source: 's' })]));
    run.dispose();
    run.dispose();
    expect(() => run.setSignal('in', 1)).not.toThrow();
    expect(() => run.reportFault('in', 'x')).not.toThrow();
    const off = run.subscribe(() => {});
    expect(off).toBeTypeOf('function');
  });

  it('scans are frozen and hold copies', () => {
    const run = runOf(graph([node('c', 'test.counter')]));
    const scan: FlowScan = run.step();
    expect(Object.isFrozen(scan) && Object.isFrozen(scan.changes) && Object.isFrozen(scan.changes[0])).toBe(true);
    expect(Object.isFrozen(run.read('flow:c.count'))).toBe(true);
    expect(run.read('flow:nope.x')).toBeUndefined();
  });

  it('reads options once: editing the options object later changes nothing', () => {
    const manual = createManualSchedule();
    const options = { scanMs: 100, schedule: manual.schedule, now: clock().now };
    const run = createFlowRun(compileFlow(graph([]), registry), options);
    options.scanMs = 5;
    options.schedule = () => {
      throw new Error('swapped');
    };
    expect(run.scanMs).toBe(100);
    expect(() => run.start()).not.toThrow();
  });
});

describe('performance bounds', () => {
  it('scans a 10 000-node graph', () => {
    const n = FLOW_LIMITS.maxNodes;
    const nodes = Array.from({ length: n }, (_, i) => node(`n${i}`, 'test.not'));
    const wires = Array.from({ length: n - 1 }, (_, i) => wire(`w${i}`, `n${i}.out`, `n${i + 1}.in`));
    const run = runOf(graph(nodes, wires));
    const started = performance.now();
    run.step();
    run.step();
    expect(performance.now() - started).toBeLessThan(2000);
    expect(value(run, `flow:n${n - 1}.out`)).toBe(false); // 10 000 NOTs of false
  });
});
