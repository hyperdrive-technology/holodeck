import { ContributionRegistry } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { FLOW_BLOCK_KIND, type FlowBlockDefinition } from './block';
import { analyzeFlowGraph, cyclicComponents, FLOW_GRAPH_FORMAT, flowGraphFormat, isDeployable, stronglyConnectedComponents, validateFlowGraph, type FlowProblem } from './graph';
import { graph, node, registryWith, wire } from './test-helpers';
import { FLOW_LIMITS } from './values';

const registry = registryWith();
const codes = (problems: readonly FlowProblem[]) => problems.map((p) => p.code);
const errors = (body: unknown) => validateFlowGraph(body, registry).filter((p) => p.severity === 'error');

describe('format', () => {
  it('is holodeck.flow.graph.v1', () => {
    expect(FLOW_GRAPH_FORMAT).toBe('holodeck.flow.graph.v1');
    expect(flowGraphFormat).toBe(FLOW_GRAPH_FORMAT);
  });
});

describe('validateFlowGraph: valid graphs', () => {
  it('accepts an empty graph', () => {
    expect(validateFlowGraph(graph([]), registry)).toEqual([]);
  });

  it('accepts a small logic graph', () => {
    const body = graph(
      [node('c1', 'flow.const', { type: 'bool', value: true }), node('c2', 'flow.const', { type: 'bool', value: false }), node('and', 'test.and'), node('not', 'test.not')],
      [wire('w1', 'c1.value', 'and.in1'), wire('w2', 'c2.value', 'and.in2'), wire('w3', 'and.out', 'not.in')],
    );
    expect(validateFlowGraph(body, registry)).toEqual([]);
  });

  it('accepts a feedback loop through flow.delay', () => {
    const body = graph(
      [node('add', 'test.add'), node('one', 'flow.const', { value: 1 }), node('d', 'flow.delay', { initial: 0 })],
      [wire('w1', 'one.value', 'add.a'), wire('w2', 'd.out', 'add.b'), wire('w3', 'add.sum', 'd.in')],
    );
    expect(validateFlowGraph(body, registry)).toEqual([]);
  });

  it('accepts a delay feeding itself (holds its initial value)', () => {
    expect(validateFlowGraph(graph([node('d', 'flow.delay')], [wire('w', 'd.out', 'd.in')]), registry)).toEqual([]);
  });

  it('ignores unknown fields on the body, nodes and wires (editor UI data)', () => {
    const body = { ...graph([node('c', 'flow.const', undefined, { ui: { color: 'red' } } as never)]), viewport: { zoom: 1 } };
    expect(validateFlowGraph(body, registry)).toEqual([]);
  });

  it('resolves built-in blocks without a registry', () => {
    expect(validateFlowGraph(graph([node('c', 'flow.const'), node('d', 'flow.delay')], [wire('w', 'c.value', 'd.in')]))).toEqual([]);
  });
});

describe('validateFlowGraph: problems', () => {
  it.each([
    ['not an object', null, 'INVALID_BODY'],
    ['array body', [], 'INVALID_BODY'],
    ['nodes missing', { wires: [] }, 'INVALID_BODY'],
    ['wires missing', { nodes: [] }, 'INVALID_BODY'],
    ['node not object', { nodes: [1], wires: [] }, 'INVALID_NODE'],
    ['node id missing', { nodes: [{ block: 'flow.const', position: { x: 0, y: 0 } }], wires: [] }, 'INVALID_NODE'],
    ['node id empty', graph([node('', 'flow.const')]), 'INVALID_NODE'],
    ['NUL in node id', graph([node('a\u0000b', 'flow.const')]), 'INVALID_NODE'],
    ['newline in node id', graph([node('a\nb', 'flow.const')]), 'INVALID_NODE'],
    ['overlong node id', graph([node('x'.repeat(129), 'flow.const')]), 'INVALID_NODE'],
    ['block not string', graph([node('a', 7 as never)]), 'INVALID_NODE'],
    ['position missing', { nodes: [{ id: 'a', block: 'flow.const' }], wires: [] }, 'INVALID_NODE'],
    ['position NaN', graph([node('a', 'flow.const', undefined, { position: { x: Number.NaN, y: 0 } })]), 'INVALID_NODE'],
    ['position Infinity', graph([node('a', 'flow.const', undefined, { position: { x: 0, y: Infinity } })]), 'INVALID_NODE'],
    ['label not string', graph([node('a', 'flow.const', undefined, { label: 5 as never })]), 'INVALID_NODE'],
    ['params not object', graph([node('a', 'flow.const', [] as never)]), 'INVALID_NODE'],
    ['param value object', graph([node('a', 'flow.const', { value: {} as never })]), 'INVALID_PARAM'],
    ['param value NaN', graph([node('a', 'flow.const', { value: Number.NaN })]), 'INVALID_PARAM'],
    ['wire not object', { nodes: [], wires: ['w'] }, 'INVALID_WIRE'],
    ['wire id missing', { nodes: [], wires: [{ from: { node: 'a', port: 'b' }, to: { node: 'a', port: 'b' } }] }, 'INVALID_WIRE'],
    ['wire end malformed', { nodes: [], wires: [{ id: 'w', from: 'a.out', to: { node: 'b', port: 'in' } }] }, 'INVALID_WIRE'],
    ['NUL in wire port', { nodes: [], wires: [{ id: 'w', from: { node: 'a', port: 'o\u0000' }, to: { node: 'b', port: 'in' } }] }, 'INVALID_WIRE'],
    ['unknown block', graph([node('a', 'acme.pump')]), 'UNKNOWN_BLOCK'],
    ['unknown param', graph([node('a', 'flow.const', { valu: 1 })]), 'UNKNOWN_PARAM'],
    ['missing required param', graph([node('s', 'signal.in', { source: 'x' })]), 'MISSING_PARAM'],
    ['param of wrong type', graph([node('c', 'test.counter', { start: 'one' })]), 'INVALID_PARAM'],
    ['param below min', graph([node('c', 'test.counter', { start: -1 })]), 'INVALID_PARAM'],
    ['param not integer', graph([node('c', 'test.counter', { start: 1.5 })]), 'INVALID_PARAM'],
    ['param not in options', graph([node('c', 'flow.const', { type: 'date' })]), 'INVALID_PARAM'],
    ['checkParams problem', graph([node('c', 'flow.const', { type: 'bool', value: 3 })]), 'INVALID_PARAM'],
    ['empty signal connection', graph([node('s', 'signal.in', { connection: '', source: 'x' })]), 'INVALID_PARAM'],
    ['wire from unknown node', graph([node('n', 'test.not')], [wire('w', 'ghost.out', 'n.in')]), 'UNKNOWN_NODE'],
    ['wire to unknown node', graph([node('n', 'test.not')], [wire('w', 'n.out', 'ghost.in')]), 'UNKNOWN_NODE'],
    ['unknown output', graph([node('a', 'test.not'), node('b', 'test.not')], [wire('w', 'a.nope', 'b.in')]), 'UNKNOWN_PORT'],
    ['unknown input', graph([node('a', 'test.not'), node('b', 'test.not')], [wire('w', 'a.out', 'b.nope')]), 'UNKNOWN_PORT'],
    ['input used as output', graph([node('a', 'test.not'), node('b', 'test.not')], [wire('w', 'a.in', 'b.in')]), 'UNKNOWN_PORT'],
    ['variadic instance 0', graph([node('a', 'test.not'), node('b', 'test.and')], [wire('w', 'a.out', 'b.in0')]), 'UNKNOWN_PORT'],
    ['variadic beyond max', graph([node('a', 'test.not'), node('b', 'test.and')], [wire('w', 'a.out', 'b.in9')]), 'UNKNOWN_PORT'],
    ['variadic base name', graph([node('a', 'test.not'), node('b', 'test.and')], [wire('w', 'a.out', 'b.in')]), 'UNKNOWN_PORT'],
    ['type mismatch', graph([node('a', 'test.add'), node('b', 'test.not')], [wire('w', 'a.sum', 'b.in')]), 'TYPE_MISMATCH'],
  ])('%s → %s', (_name, body, code) => {
    const problems = validateFlowGraph(body, registry);
    expect(codes(problems)).toContain(code);
    expect(isDeployable(problems)).toBe(false);
  });

  it('accepts any → typed and typed → any', () => {
    const body = graph(
      [node('c', 'flow.const', { value: 1 }), node('n', 'test.not'), node('d', 'flow.delay')],
      [wire('w1', 'c.value', 'n.in'), wire('w2', 'n.out', 'd.in')],
    );
    expect(validateFlowGraph(body, registry)).toEqual([]);
  });

  it('reports duplicate node and wire ids, pointing at both positions', () => {
    const body = graph(
      [node('a', 'test.not'), node('b', 'test.not'), node('a', 'test.not')],
      [wire('w', 'a.out', 'b.in'), wire('w', 'b.out', 'a.in')],
    );
    const problems = validateFlowGraph(body, registry);
    expect(problems).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_ID', node: 'a', message: expect.stringMatching(/nodes\[0\] and nodes\[2\]/) }));
    expect(problems).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_ID', wire: 'w', message: expect.stringMatching(/wires\[0\] and wires\[1\]/) }));
  });

  it('reports an input driven by more than one wire', () => {
    const body = graph(
      [node('a', 'test.not'), node('b', 'test.not'), node('c', 'test.not')],
      [wire('w1', 'a.out', 'c.in'), wire('w2', 'b.out', 'c.in')],
    );
    expect(validateFlowGraph(body, registry)).toContainEqual(
      expect.objectContaining({ code: 'MULTIPLE_DRIVERS', wire: 'w2', node: 'c', message: expect.stringContaining('"w1"') }),
    );
  });

  it('allows fan-out from one output to many inputs', () => {
    const body = graph(
      [node('a', 'test.not'), node('b', 'test.not'), node('c', 'test.not')],
      [wire('w1', 'a.out', 'b.in'), wire('w2', 'a.out', 'c.in')],
    );
    expect(validateFlowGraph(body, registry)).toEqual([]);
  });

  it('lists every problem in one pass', () => {
    const body = graph(
      [node('a', 'acme.pump'), node('b', 'flow.const', { nope: 1 }), node('b', 'test.not'), node('c', 'test.add')],
      [wire('w1', 'c.sum', 'x.in'), wire('w2', 'c.sum', 'b.zzz')],
    );
    expect(new Set(codes(validateFlowGraph(body, registry)))).toEqual(
      new Set(['UNKNOWN_BLOCK', 'UNKNOWN_PARAM', 'DUPLICATE_ID', 'UNKNOWN_NODE', 'UNKNOWN_PORT']),
    );
  });

  it('hints at a missing engine when no flow blocks are installed at all', () => {
    const empty = new ContributionRegistry();
    const [problem] = validateFlowGraph(graph([node('a', 'logic.and')]), empty);
    expect(problem?.message).toMatch(/no flow blocks are installed/);
    const [other] = validateFlowGraph(graph([node('a', 'logic.and')]), registry);
    expect(other?.message).not.toMatch(/no flow blocks/);
  });

  it('reports an installed but invalid block definition', () => {
    // A registry that never validated its items (kind registered without a validator).
    const loose = new ContributionRegistry();
    loose.registerKind({ kind: FLOW_BLOCK_KIND.kind });
    loose.install({ id: 'x', version: '1.0.0', contributions: { [FLOW_BLOCK_KIND.kind]: [{ id: 'bad.block', label: 'Bad' } as never] } });
    expect(codes(validateFlowGraph(graph([node('a', 'bad.block')]), loose))).toEqual(['INVALID_BLOCK']);
  });

  it('reports checkParams that throw or return junk', () => {
    const throws: FlowBlockDefinition = { id: 't.throws', label: 'T', category: 'T', inputs: [], outputs: [], checkParams: () => { throw new Error('nope'); }, evaluate: () => ({ outputs: {} }) };
    const junk: FlowBlockDefinition = { id: 't.junk', label: 'J', category: 'T', inputs: [], outputs: [], checkParams: () => 'bad' as never, evaluate: () => ({ outputs: {} }) };
    const problems = validateFlowGraph(graph([node('a', 't.throws'), node('b', 't.junk')]), registryWith([throws, junk]));
    expect(problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/checkParams threw: nope/),
      expect.stringMatching(/checkParams must return an array/),
    ]);
  });

  it('warns (but allows) two signal.out nodes writing the same signal', () => {
    const body = graph([
      node('o1', 'signal.out', { connection: 'plc', source: 'x' }),
      node('o2', 'signal.out', { connection: 'plc', source: 'x' }),
      node('o3', 'signal.out', { connection: 'plc', source: 'y' }),
    ]);
    const problems = validateFlowGraph(body, registry);
    expect(problems).toEqual([expect.objectContaining({ severity: 'warning', code: 'DUPLICATE_SIGNAL_TARGET', node: 'o2' })]);
    expect(isDeployable(problems)).toBe(true);
  });

  it('returns frozen problems', () => {
    const problems = validateFlowGraph(graph([node('a', 'acme.pump')]), registry);
    expect(Object.isFrozen(problems)).toBe(true);
    expect(Object.isFrozen(problems[0])).toBe(true);
  });
});

describe('cycles', () => {
  it('reports a cycle without a delay with its path', () => {
    const body = graph(
      [node('a', 'test.not'), node('b', 'test.not'), node('c', 'test.not')],
      [wire('w1', 'a.out', 'b.in'), wire('w2', 'b.out', 'c.in'), wire('w3', 'c.out', 'a.in')],
    );
    const [problem] = errors(body);
    expect(problem).toMatchObject({ code: 'CYCLE_WITHOUT_DELAY', node: 'a', path: ['a', 'b', 'c', 'a'] });
    expect(problem!.message).toBe('cycle without a flow.delay block: "a" → "b" → "c" → "a"');
  });

  it('reports a self-loop', () => {
    expect(errors(graph([node('a', 'test.not')], [wire('w', 'a.out', 'a.in')]))).toEqual([
      expect.objectContaining({ code: 'CYCLE_WITHOUT_DELAY', path: ['a', 'a'] }),
    ]);
  });

  it('reports each independent loop once, in document order', () => {
    const body = graph(
      [node('x', 'test.not'), node('y', 'test.not'), node('a', 'test.not'), node('b', 'test.not')],
      [wire('w1', 'b.out', 'a.in'), wire('w2', 'a.out', 'b.in'), wire('w3', 'x.out', 'y.in'), wire('w4', 'y.out', 'x.in')],
    );
    expect(errors(body).map((p) => p.path)).toEqual([
      ['x', 'y', 'x'],
      ['a', 'b', 'a'],
    ]);
  });

  it('reports the shortest cycle through the first node of a tangled component', () => {
    // a→b→c→d→a and a→d→a: shortest through a is a→d→a.
    const body = graph(
      [node('a', 'test.add'), node('b', 'test.add'), node('c', 'test.add'), node('d', 'test.add')],
      [wire('w1', 'a.sum', 'b.a'), wire('w2', 'b.sum', 'c.a'), wire('w3', 'c.sum', 'd.a'), wire('w4', 'd.sum', 'a.a'), wire('w5', 'a.sum', 'd.b')],
    );
    const problems = errors(body);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.path).toEqual(['a', 'd', 'a']);
  });

  it('accepts a loop that passes through a delay anywhere', () => {
    const body = graph(
      [node('a', 'test.not'), node('b', 'test.not'), node('d', 'flow.delay')],
      [wire('w1', 'a.out', 'b.in'), wire('w2', 'b.out', 'd.in'), wire('w3', 'd.out', 'a.in')],
    );
    expect(errors(body)).toEqual([]);
  });

  it('still reports an inner loop that bypasses the delay of an outer one', () => {
    const body = graph(
      [node('a', 'test.add'), node('b', 'test.not'), node('n', 'test.not'), node('d', 'flow.delay')],
      [wire('w1', 'a.sum', 'd.in'), wire('w2', 'd.out', 'a.a'), wire('w3', 'b.out', 'n.in'), wire('w4', 'n.out', 'b.in')],
    );
    expect(errors(body).map((p) => p.path)).toEqual([['b', 'n', 'b']]);
  });

  it('handles a 10 000-node chain and a 10 000-node ring without recursion', () => {
    const n = FLOW_LIMITS.maxNodes;
    const nodes = Array.from({ length: n }, (_, i) => node(`n${i}`, 'test.not'));
    const chain = Array.from({ length: n - 1 }, (_, i) => wire(`w${i}`, `n${i}.out`, `n${i + 1}.in`));
    expect(errors(graph(nodes, chain))).toEqual([]);
    const ring = [...chain, wire('back', `n${n - 1}.out`, 'n0.in')];
    const [problem] = errors(graph(nodes, ring));
    expect(problem!.code).toBe('CYCLE_WITHOUT_DELAY');
    expect(problem!.path).toHaveLength(n + 1);
    expect(problem!.message.length).toBeLessThan(400);
    expect(problem!.message).toMatch(/… \(9991 more\) …/); // 10 001 ids, 10 shown
  });
});

describe('hostile input', () => {
  it('treats __proto__ / constructor ids and params as plain data (JSON-parsed)', () => {
    const body = JSON.parse(`{
      "nodes": [
        { "id": "__proto__", "block": "test.not", "position": { "x": 0, "y": 0 } },
        { "id": "constructor", "block": "flow.const", "params": { "__proto__": 1, "value": true, "type": "bool" }, "position": { "x": 0, "y": 0 } }
      ],
      "wires": [{ "id": "__proto__", "from": { "node": "constructor", "port": "value" }, "to": { "node": "__proto__", "port": "in" } }]
    }`);
    const problems = validateFlowGraph(body, registry);
    expect(problems).toEqual([expect.objectContaining({ code: 'UNKNOWN_PARAM', node: 'constructor', message: expect.stringContaining('"__proto__"') })]);
    expect(({} as Record<string, unknown>).value).toBeUndefined();
  });

  it('keeps ids that differ only after a NUL or a dot apart (no composite-key forgery)', () => {
    // Without JSON-encoded keys, ("a.b", "c") and ("a", "b.c") or NUL-joined keys could collide.
    const body = graph(
      [node('a', 'test.not'), node('a.b', 'test.and'), node('b', 'test.not')],
      [wire('w1', 'a.out', 'a.b.in1'), wire('w2', 'b.out', 'a.b.in2')],
    );
    expect(validateFlowGraph(body, registry)).toEqual([]);
  });

  it('refuses oversized graphs before reading them', () => {
    const sparse = { nodes: new Array(FLOW_LIMITS.maxNodes + 1), wires: [] };
    expect(codes(validateFlowGraph(sparse, registry))).toEqual(['TOO_LARGE']);
    const wires = { nodes: [], wires: { length: 1e9 } };
    expect(codes(validateFlowGraph(wires, registry))).toEqual(['INVALID_BODY']);
    const manyWires = { nodes: [], wires: new Array(FLOW_LIMITS.maxWires + 1) };
    expect(codes(validateFlowGraph(manyWires, registry))).toEqual(['TOO_LARGE']);
  });

  it('caps the problem list and counts the rest', () => {
    const nodes = Array.from({ length: 1500 }, (_, i) => node(`n${i}`, 'acme.missing'));
    const problems = validateFlowGraph(graph(nodes), registry);
    expect(problems).toHaveLength(FLOW_LIMITS.maxProblems + 1);
    expect(problems.at(-1)).toMatchObject({ code: 'TOO_MANY_PROBLEMS', message: expect.stringMatching(/^500 more/) });
  });

  it('an overflow of warnings only is a warning, so the graph stays deployable (review P3)', () => {
    const nodes = Array.from({ length: 1002 }, (_, i) => node(`o${i}`, 'signal.out', { connection: 'plc', source: 'x' }));
    const problems = validateFlowGraph(graph(nodes), registry);
    expect(problems).toHaveLength(FLOW_LIMITS.maxProblems + 1);
    expect(problems.at(-1)).toMatchObject({ severity: 'warning', code: 'TOO_MANY_PROBLEMS', message: expect.stringMatching(/^1 more .*0 error\(s\), 1 warning\(s\)/) });
    expect(isDeployable(problems)).toBe(true);
    // A listed error still blocks; the overflow only stands for what it hides (warnings here).
    const mixed = validateFlowGraph(graph([...nodes, node('bad', 'acme.missing')]), registry);
    expect(mixed[0]).toMatchObject({ severity: 'error', code: 'UNKNOWN_BLOCK' });
    expect(mixed.at(-1)).toMatchObject({ severity: 'warning', code: 'TOO_MANY_PROBLEMS' });
    expect(isDeployable(mixed)).toBe(false);
    // An overflow that hides errors is an error.
    const errors = validateFlowGraph(graph(Array.from({ length: 1001 }, (_, i) => node(`n${i}`, 'acme.missing'))), registry);
    expect(errors.at(-1)).toMatchObject({ severity: 'error', code: 'TOO_MANY_PROBLEMS' });
  });

  it('never throws on Proxies and throwing getters', () => {
    const trap = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
      },
    );
    expect(codes(validateFlowGraph(trap, registry))).toEqual(['INVALID_BODY']);
    const body = graph([node('a', 'test.not')]);
    Object.defineProperty(body.nodes[0], 'params', {
      enumerable: true,
      get() {
        throw new Error('getter');
      },
    });
    expect(validateFlowGraph(body, registry)).toEqual([expect.objectContaining({ code: 'INVALID_BODY', message: expect.stringMatching(/getter/) })]);
  });

  it('reads the body once: a getter cannot show validation and compilation different graphs', () => {
    let reads = 0;
    const body = {
      get nodes() {
        reads++;
        return reads === 1 ? [node('a', 'test.not')] : [node('a', 'acme.evil')];
      },
      wires: [],
    };
    const { problems, graph: analyzed } = analyzeFlowGraph(body, { registry });
    expect(problems).toEqual([]);
    expect(analyzed!.nodes.map((n) => n.snap.block)).toEqual(['test.not']);
    expect(reads).toBe(1);
  });

  it('reads every node field once: a flipping getter cannot pass validation with one value and run another', () => {
    let blockReads = 0;
    let valueReads = 0;
    const params = {};
    Object.defineProperty(params, 'value', { enumerable: true, get: () => (valueReads++ === 0 ? true : ({} as never)) });
    Object.defineProperty(params, 'type', { enumerable: true, value: 'bool' });
    const raw = { id: 'a', position: { x: 0, y: 0 }, params };
    Object.defineProperty(raw, 'block', { enumerable: true, get: () => (blockReads++ === 0 ? 'flow.const' : 'acme.evil') });
    const { problems, graph: analyzed } = analyzeFlowGraph({ nodes: [raw], wires: [] }, { registry });
    expect(problems).toEqual([]);
    expect(analyzed!.nodes[0]!.snap.block).toBe('flow.const');
    expect(analyzed!.nodes[0]!.params!.value).toBe(true);
    expect([blockReads, valueReads]).toEqual([1, 1]);
  });

  it('stops at the node limit even if a Proxy array grows while being read', () => {
    let lengthReads = 0;
    const nodes = new Proxy([] as unknown[], {
      get(target, key) {
        if (key === 'length') return lengthReads++ === 0 ? 1 : 1e9;
        if (typeof key === 'string' && /^[0-9]+$/.test(key)) return node(`n${key}`, 'flow.const');
        return Reflect.get(target, key);
      },
    });
    const { graph: analyzed } = analyzeFlowGraph({ nodes, wires: [] }, { registry });
    expect(analyzed!.nodes.length).toBeLessThanOrEqual(FLOW_LIMITS.maxNodes);
  });

  it('survives a registry whose lookups throw', () => {
    const hostile = { get: () => { throw new Error('registry down'); }, list: () => [] };
    expect(validateFlowGraph(graph([node('a', 'acme.thing')]), hostile)).toEqual([
      expect.objectContaining({ code: 'INVALID_BLOCK', message: expect.stringMatching(/registry down/) }),
    ]);
  });

  it('does not let a registry entry replace a built-in block', () => {
    const fake: FlowBlockDefinition = { id: 'flow.delay', label: 'Not a delay', category: 'X', inputs: [], outputs: [], evaluate: () => ({ outputs: {} }) };
    const r = registryWith([fake]);
    // The built-in delay (input `in`, output `out`) is used, so this wiring is valid.
    expect(validateFlowGraph(graph([node('d', 'flow.delay')], [wire('w', 'd.out', 'd.in')]), r)).toEqual([]);
  });
});

describe('structural mode', () => {
  it('skips unknown blocks but still checks structure, wires and cycles', () => {
    const body = graph(
      [node('a', 'acme.x'), node('b', 'acme.y'), node('a', 'acme.z')],
      [wire('w1', 'a.out', 'b.in'), wire('w2', 'b.out', 'a.in'), wire('w3', 'a.q', 'b.in'), wire('w4', 'a.out', 'ghost.in')],
    );
    const { problems } = analyzeFlowGraph(body, { structural: true });
    expect(new Set(codes(problems))).toEqual(new Set(['DUPLICATE_ID', 'MULTIPLE_DRIVERS', 'UNKNOWN_NODE', 'CYCLE_WITHOUT_DELAY']));
  });

  it('still checks built-in blocks fully', () => {
    const { problems } = analyzeFlowGraph(graph([node('s', 'signal.in', { connection: 'c' })]), { structural: true });
    expect(codes(problems)).toEqual(['MISSING_PARAM']);
  });
});

describe('stronglyConnectedComponents', () => {
  it('returns every component, singletons included, in reverse topological order', () => {
    // 0 → 1 ⇄ 2 → 3 → 3 (self), 4 → 1, 5 alone
    const adj = [[1], [2], [1, 3], [3], [1], []];
    const sccs = stronglyConnectedComponents(adj).map((c) => [...c].sort());
    expect(sccs.flat().sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const at = (i: number) => sccs.findIndex((c) => c.includes(i));
    // A component comes after every component it has an edge to.
    for (let u = 0; u < adj.length; u++) for (const w of adj[u]!) if (at(u) !== at(w)) expect(at(u)).toBeGreaterThan(at(w));
    expect(cyclicComponents(adj).map((c) => [...c].sort())).toEqual(expect.arrayContaining([[1, 2], [3]]));
    expect(cyclicComponents(adj)).toHaveLength(2);
  });

  it('handles a 10 000-node chain without recursion, and skips nodes', () => {
    const n = 10_000;
    const adj = Array.from({ length: n }, (_, i) => (i + 1 < n ? [i + 1] : [0]));
    expect(stronglyConnectedComponents(adj)).toHaveLength(1);
    const skip = Array.from({ length: n }, (_, i) => i === n - 1);
    adj[n - 2] = [];
    expect(stronglyConnectedComponents(adj, skip)).toHaveLength(n - 1);
  });
});
