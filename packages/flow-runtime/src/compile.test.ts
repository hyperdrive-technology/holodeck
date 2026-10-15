import { describe, expect, it } from 'vitest';
import type { FlowBlockDefinition } from './block';
import { compileFlow, FlowGraphError, programOf, tryCompileFlow } from './compile';
import { createFlowRun, FlowRunError } from './run';
import { addBlock, graph, node, registryWith, wire } from './test-helpers';

const registry = registryWith();

function isDeepFrozen(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every((child) => isDeepFrozen(child, seen));
}

describe('compileFlow', () => {
  it('orders nodes topologically, ties in document order, delays last', () => {
    const body = graph(
      [node('sink', 'test.not'), node('d', 'flow.delay'), node('mid', 'test.not'), node('src', 'flow.const', { type: 'bool' }), node('other', 'flow.const')],
      [wire('w1', 'src.value', 'mid.in'), wire('w2', 'mid.out', 'sink.in'), wire('w3', 'sink.out', 'd.in')],
    );
    const plan = compileFlow(body, registry);
    expect(plan.nodes.map((n) => n.id)).toEqual(['src', 'other', 'mid', 'sink', 'd']);
    expect(plan.nodes.map((n) => n.phase)).toEqual(['main', 'main', 'main', 'main', 'delay']);
  });

  it('treats delay outputs as sources so readers of a delay may come first', () => {
    const body = graph(
      [node('add', 'test.add'), node('d', 'flow.delay', { initial: 0 }), node('one', 'flow.const', { value: 1 })],
      [wire('w1', 'd.out', 'add.a'), wire('w2', 'one.value', 'add.b'), wire('w3', 'add.sum', 'd.in')],
    );
    expect(compileFlow(body, registry).nodes.map((n) => n.id)).toEqual(['one', 'add', 'd']);
  });

  it('marks delays on a feedback loop (through other delays, or wired to themselves); feed-forward delays are not', () => {
    const body = graph(
      [
        node('n', 'test.not'),
        node('loop1', 'flow.delay', { initial: false }),
        node('loop2', 'flow.delay', { initial: false }), // n → loop1 → loop2 → n
        node('self', 'flow.delay'), // self.out → self.in
        node('after', 'flow.delay'), // reads the loop, is not on it
        node('chain1', 'flow.delay'),
        node('chain2', 'flow.delay'), // chain1 → chain2, no loop
        node('k', 'test.not'),
      ],
      [
        wire('w1', 'n.out', 'loop1.in'),
        wire('w2', 'loop1.out', 'loop2.in'),
        wire('w3', 'loop2.out', 'n.in'),
        wire('w4', 'self.out', 'self.in'),
        wire('w5', 'n.out', 'after.in'),
        wire('w6', 'k.out', 'chain1.in'),
        wire('w7', 'chain1.out', 'chain2.in'),
      ],
    );
    const program = programOf(compileFlow(body, registry))!;
    const loopOf = Object.fromEntries(program.nodes.map((n) => [n.plan.id, n.loop]));
    const [a, b] = [loopOf.n, loopOf.self];
    expect(a).not.toBe(b);
    expect(loopOf).toEqual({ n: a, k: undefined, loop1: a, loop2: a, self: b, after: undefined, chain1: undefined, chain2: undefined });
    expect(program.loops.map((l) => l.members.map((m) => m.plan.id)).sort()).toEqual([['n', 'loop1', 'loop2'], ['self']].sort());
    for (const loop of program.loops) expect(loop.members.every((m) => m.loop === loop.index)).toBe(true);
    // Readings inside a loop are marked internal; n reads loop2 (same loop).
    const n = program.byId.get('n')!;
    expect(n.inputs[0]!.slots[0]).toMatchObject({ internal: true });
    const after = program.byId.get('after')!;
    expect(after.inputs[0]!.slots[0]).toMatchObject({ internal: false });
  });

  it('orders the quality pass topologically with each loop as one unit, before everything it feeds', () => {
    // in → a → [loop: b → d → b] → c → out ; e reads the loop delay directly.
    const body = graph(
      [
        node('c', 'test.not'),
        node('e', 'test.not'),
        node('d', 'flow.delay', { initial: false }),
        node('b', 'test.and'),
        node('a', 'test.not'),
        node('in', 'signal.in', { connection: 'x', source: 'i' }),
        node('out', 'signal.out', { connection: 'x', source: 'o' }),
        node('f', 'flow.delay', { initial: false }), // outside any loop: not a quality step
      ],
      [
        wire('w1', 'in.value', 'a.in'),
        wire('w2', 'a.out', 'b.in1'),
        wire('w3', 'd.out', 'b.in2'),
        wire('w4', 'b.out', 'd.in'),
        wire('w5', 'b.out', 'c.in'),
        wire('w6', 'c.out', 'out.value'),
        wire('w7', 'd.out', 'e.in'),
        wire('w8', 'e.out', 'f.in'),
      ],
    );
    const program = programOf(compileFlow(body, registry))!;
    const steps = program.qualityOrder.map((s) => ('loop' in s ? `[${s.loop.members.map((m) => m.plan.id).join(',')}]` : s.node.plan.id));
    expect(steps).toHaveLength(6);
    expect(new Set(steps)).toEqual(new Set(['in', 'a', '[b,d]', 'c', 'e', 'out']));
    const at = (id: string) => steps.indexOf(id);
    expect(at('in')).toBeLessThan(at('a'));
    expect(at('a')).toBeLessThan(at('[b,d]'));
    expect(at('[b,d]')).toBeLessThan(at('c'));
    expect(at('[b,d]')).toBeLessThan(at('e'));
    expect(at('c')).toBeLessThan(at('out'));
  });

  it('describes ports, wiring, params and sources', () => {
    const body = graph(
      [node('a', 'flow.const', { type: 'bool', value: true }), node('and', 'test.and', undefined, { label: 'Both' })],
      [wire('w', 'a.value', 'and.in3')],
    );
    const plan = compileFlow(body, registry);
    const and = plan.nodes.find((n) => n.id === 'and')!;
    expect(and.label).toBe('Both');
    // min 2, wired up to in3 → three instances; in1/in2 unwired read the default (true).
    expect(and.inputs).toEqual([
      { port: 'in1', input: 'in', index: 1, type: 'bool', from: null, default: true },
      { port: 'in2', input: 'in', index: 2, type: 'bool', from: null, default: true },
      { port: 'in3', input: 'in', index: 3, type: 'bool', from: { node: 'a', port: 'value' }, default: true },
    ]);
    expect(and.outputs).toEqual([{ port: 'out', type: 'bool', source: 'flow:and.out' }]);
    expect(and.faultSource).toBe('flow:and.$fault');
    expect(plan.nodes[0]!.params).toEqual({ type: 'bool', value: true });
    expect(plan.sources).toEqual(['flow:a.value', 'flow:a.$fault', 'flow:and.out', 'flow:and.$fault']);
  });

  it('applies param defaults', () => {
    const plan = compileFlow(graph([node('c', 'test.counter'), node('k', 'flow.const')]), registry);
    expect(plan.nodes.map((n) => ({ ...n.params }))).toEqual([{ start: 0 }, { type: 'number', value: null }]);
  });

  it('lists signal blocks', () => {
    const plan = compileFlow(
      graph([node('i', 'signal.in', { connection: 'plc', source: 'a' }), node('o', 'signal.out', { connection: 'plc', source: 'b' })], [wire('w', 'i.value', 'o.value')]),
      registry,
    );
    expect(plan.signalsIn).toEqual([{ node: 'i', connection: 'plc', source: 'a' }]);
    expect(plan.signalsOut).toEqual([{ node: 'o', connection: 'plc', source: 'b' }]);
  });

  it('keeps warnings on the plan', () => {
    const plan = compileFlow(
      graph([node('o1', 'signal.out', { connection: 'c', source: 's' }), node('o2', 'signal.out', { connection: 'c', source: 's' })]),
      registry,
    );
    expect(plan.warnings.map((w) => w.code)).toEqual(['DUPLICATE_SIGNAL_TARGET']);
  });

  it('throws FlowGraphError with every problem', () => {
    const body = graph([node('a', 'acme.x'), node('b', 'test.not')], [wire('w', 'b.out', 'b.in')]);
    let error: unknown;
    try {
      compileFlow(body, registry);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FlowGraphError);
    expect((error as FlowGraphError).code).toBe('INVALID_GRAPH');
    expect((error as FlowGraphError).problems.map((p) => p.code)).toEqual(['UNKNOWN_BLOCK', 'CYCLE_WITHOUT_DELAY']);
    expect((error as Error).message).toMatch(/2 problems/);
  });

  it('tryCompileFlow never throws and returns problems', () => {
    expect(tryCompileFlow(null, registry)).toEqual({ plan: undefined, problems: [expect.objectContaining({ code: 'INVALID_BODY' })] });
    expect(tryCompileFlow(graph([]), registry).plan?.nodes).toEqual([]);
  });

  it('returns a deep-frozen plan', () => {
    const plan = compileFlow(graph([node('a', 'test.and'), node('b', 'test.not')], [wire('w', 'b.out', 'a.in1')]), registry);
    expect(isDeepFrozen(plan)).toBe(true);
  });

  it('keeps nothing the caller owns: editing the body or block afterwards changes nothing', () => {
    const block: FlowBlockDefinition = { ...addBlock, id: 'test.add2', outputs: [{ name: 'sum', type: 'number' }] };
    const r = registryWith([block]);
    const body = graph([node('a', 'test.add2', undefined, { label: 'A' }), node('k', 'flow.const', { value: 5 })], [wire('w', 'k.value', 'a.a')]);
    const plan = compileFlow(body, r);
    body.nodes[0]!.label = 'changed';
    body.nodes[1]!.params!.value = 6;
    body.wires[0]!.to.port = 'b';
    (block.outputs as unknown as Array<{ name: string }>)[0]!.name = 'renamed';
    expect(plan.nodes.find((n) => n.id === 'a')).toMatchObject({ label: 'A', outputs: [{ port: 'sum' }] });
    expect(plan.nodes.find((n) => n.id === 'k')!.params.value).toBe(5);
    expect(plan.nodes.find((n) => n.id === 'a')!.inputs[0]).toMatchObject({ port: 'a', from: { node: 'k', port: 'value' } });
  });

  it('hides the executable program; createFlowRun refuses look-alike plans', () => {
    const plan = compileFlow(graph([node('a', 'test.not')]), registry);
    expect(programOf(plan)).toBeDefined();
    expect(Object.keys(plan)).not.toContain('evaluate');
    const forged = JSON.parse(JSON.stringify(plan));
    expect(() => createFlowRun(forged)).toThrow(FlowRunError);
    expect(() => createFlowRun(forged)).toThrow(/compileFlow/);
    expect(() => createFlowRun({ ...plan })).toThrow(/compileFlow/);
  });
});
