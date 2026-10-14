/**
 * Flow graph body (`holodeck.flow.graph.v1`) and its validation.
 *
 *   {
 *     "nodes": [{ "id": "a", "block": "logic.and", "params": {}, "position": { "x": 0, "y": 0 }, "label": "Both" }],
 *     "wires": [{ "id": "w1", "from": { "node": "s", "port": "value" }, "to": { "node": "a", "port": "in1" } }]
 *   }
 *
 * `validateFlowGraph` lists every problem (up to `FLOW_LIMITS.maxProblems`)
 * and never throws, whatever the input: documents are untrusted. It reads the
 * body exactly once into a private snapshot, so a Proxy or getter cannot
 * show validation one graph and the compiler another. Unknown fields on the
 * body, nodes and wires are ignored (editors may keep their own UI data there).
 */

import type { RegistryReader } from '@holodeck/sdk';
import {
  findOutput,
  FLOW_BLOCK_KIND_NAME,
  paramValueProblems,
  readBlockDefinition,
  resolveInputPort,
  resolveParams,
  type BlockInfo,
  type FlowParams,
  type InputInfo,
  type OutputInfo,
} from './block';
import { BUILTIN_FLOW_BLOCKS, FLOW_DELAY_BLOCK, SIGNAL_OUT_BLOCK } from './builtins';
import {
  dict,
  errorMessage,
  FLOW_LIMITS,
  hasOwn,
  isFiniteNumber,
  isFlowValue,
  isRecord,
  isSafeId,
  pairKey,
  quote,
  typesCompatible,
  type FlowValue,
} from './values';

/** Format id of a flow document body (`HolodeckEngine.documentFormat` of `holodeck.flow`). */
export const FLOW_GRAPH_FORMAT = 'holodeck.flow.graph.v1';
/** Same value, under the name the engine descriptor uses (`documentFormat`). */
export const flowGraphFormat = FLOW_GRAPH_FORMAT;

export interface FlowGraphPosition {
  x: number;
  y: number;
}

export interface FlowGraphNode {
  /** Unique within the body. 1–128 characters, no control characters. */
  id: string;
  /** `holodeck.flow.block` id. */
  block: string;
  /** Param values (JSON scalars) by name; unset params take their defaults. */
  params?: Record<string, FlowValue>;
  /** Canvas position; the runtime ignores it. */
  position: FlowGraphPosition;
  label?: string;
}

export interface FlowWireEnd {
  node: string;
  /** Output port on `from`; input port (or variadic instance such as `in2`) on `to`. */
  port: string;
}

export interface FlowGraphWire {
  /** Unique among wires. */
  id: string;
  from: FlowWireEnd;
  to: FlowWireEnd;
}

export interface FlowGraphBody {
  nodes: FlowGraphNode[];
  wires: FlowGraphWire[];
}

export type FlowProblemCode =
  | 'INVALID_BODY'
  | 'TOO_LARGE'
  | 'INVALID_NODE'
  | 'INVALID_WIRE'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_BLOCK'
  | 'INVALID_BLOCK'
  | 'UNKNOWN_NODE'
  | 'UNKNOWN_PORT'
  | 'TYPE_MISMATCH'
  | 'MULTIPLE_DRIVERS'
  | 'UNKNOWN_PARAM'
  | 'MISSING_PARAM'
  | 'INVALID_PARAM'
  | 'CYCLE_WITHOUT_DELAY'
  | 'DUPLICATE_SIGNAL_TARGET'
  | 'TOO_MANY_PROBLEMS';

export interface FlowProblem {
  readonly severity: 'error' | 'warning';
  readonly code: FlowProblemCode;
  readonly message: string;
  /** Node the problem is about. */
  readonly node?: string;
  /** Wire the problem is about. */
  readonly wire?: string;
  /** `CYCLE_WITHOUT_DELAY`: node ids around the cycle, the first repeated at the end. */
  readonly path?: readonly string[];
}

// -----------------------------------------------------------------------------
// Internal analysed graph (shared with the compiler)
// -----------------------------------------------------------------------------

interface SnapNode {
  readonly index: number;
  readonly id: string;
  /** `undefined` when the field was not a usable block id string (already reported). */
  readonly block: string | undefined;
  /** Valid param values only (null prototype). */
  readonly params: Readonly<Record<string, FlowValue>>;
  /** Params whose values were malformed (already reported). */
  readonly badParams: ReadonlySet<string>;
  readonly label: string | undefined;
}

interface SnapWire {
  readonly index: number;
  readonly id: string;
  readonly from: FlowWireEnd;
  readonly to: FlowWireEnd;
}

export interface GraphNode {
  /** Position among the graph's unique nodes (document order). */
  readonly order: number;
  readonly snap: SnapNode;
  /** `undefined` when the block is unknown/invalid, or not checked (structural mode). */
  readonly info: BlockInfo | undefined;
  /** Resolved params; `undefined` when unresolved or its params have problems. */
  params: FlowParams | undefined;
  /** Variadic input name → highest wired instance index. */
  readonly variadic: Map<string, number>;
}

export interface GraphWire {
  readonly snap: SnapWire;
  readonly from: GraphNode;
  readonly to: GraphNode;
  /** Set when `from` is resolved and the port exists. */
  readonly output: OutputInfo | undefined;
  /** Set when `to` is resolved and the port exists. */
  readonly input: { input: InputInfo; index: number | undefined } | undefined;
}

export interface AnalyzedGraph {
  /** Unique nodes in document order (later duplicates are dropped). */
  readonly nodes: readonly GraphNode[];
  readonly byId: ReadonlyMap<string, GraphNode>;
  /** Wires whose two nodes exist (ports may still be unknown in structural mode). */
  readonly wires: readonly GraphWire[];
}

class Problems {
  readonly items: FlowProblem[] = [];
  private dropped = 0;
  errors = 0;

  add(severity: FlowProblem['severity'], code: FlowProblemCode, message: string, extra: Partial<Pick<FlowProblem, 'node' | 'wire' | 'path'>> = {}): void {
    if (severity === 'error') this.errors++;
    if (this.items.length >= FLOW_LIMITS.maxProblems) {
      this.dropped++;
      return;
    }
    const problem: { -readonly [K in keyof FlowProblem]: FlowProblem[K] } = { severity, code, message };
    if (extra.node !== undefined) problem.node = extra.node;
    if (extra.wire !== undefined) problem.wire = extra.wire;
    if (extra.path !== undefined) problem.path = Object.freeze([...extra.path]);
    this.items.push(Object.freeze(problem));
  }

  error(code: FlowProblemCode, message: string, extra?: Partial<Pick<FlowProblem, 'node' | 'wire' | 'path'>>): void {
    this.add('error', code, message, extra);
  }

  finish(): readonly FlowProblem[] {
    if (this.dropped) {
      this.items.push(
        Object.freeze({
          severity: 'error' as const,
          code: 'TOO_MANY_PROBLEMS' as const,
          message: `${this.dropped} more problem(s) not listed (limit ${FLOW_LIMITS.maxProblems})`,
        }),
      );
    }
    return Object.freeze(this.items);
  }
}

// -----------------------------------------------------------------------------
// Reading the body
// -----------------------------------------------------------------------------

function readEnd(raw: unknown): FlowWireEnd | undefined {
  if (!isRecord(raw)) return undefined;
  const { node, port } = { ...raw };
  if (!isSafeId(node) || !isSafeId(port)) return undefined;
  return Object.freeze({ node, port });
}

function readBody(raw: unknown, problems: Problems): { nodes: SnapNode[]; wires: SnapWire[] } | undefined {
  if (!isRecord(raw)) {
    problems.error('INVALID_BODY', 'body: must be an object { nodes, wires }');
    return undefined;
  }
  const rawNodes = raw.nodes;
  const rawWires = raw.wires;
  let ok = true;
  if (!Array.isArray(rawNodes)) {
    problems.error('INVALID_BODY', 'body.nodes: must be an array');
    ok = false;
  } else if (rawNodes.length > FLOW_LIMITS.maxNodes) {
    problems.error('TOO_LARGE', `body.nodes: ${rawNodes.length} nodes; at most ${FLOW_LIMITS.maxNodes} are allowed`);
    ok = false;
  }
  if (!Array.isArray(rawWires)) {
    problems.error('INVALID_BODY', 'body.wires: must be an array');
    ok = false;
  } else if (rawWires.length > FLOW_LIMITS.maxWires) {
    problems.error('TOO_LARGE', `body.wires: ${rawWires.length} wires; at most ${FLOW_LIMITS.maxWires} are allowed`);
    ok = false;
  }
  if (!ok) return undefined;
  // Copy each list once (bounded above): a Proxy cannot grow it while we read,
  // and every element is read exactly once.
  const nodeList: unknown[] = Array.prototype.slice.call(rawNodes, 0, FLOW_LIMITS.maxNodes);
  const wireList: unknown[] = Array.prototype.slice.call(rawWires, 0, FLOW_LIMITS.maxWires);

  const nodes: SnapNode[] = [];
  for (let i = 0; i < nodeList.length; i++) {
    const at = `nodes[${i}]`;
    const raw = nodeList[i];
    if (!isRecord(raw)) {
      problems.error('INVALID_NODE', `${at}: must be an object`);
      continue;
    }
    // Read every field once (spread defines own data properties, so a
    // `__proto__` key stays data), then validate and keep the same values.
    const node = { ...raw };
    const id = node.id;
    if (!isSafeId(id)) {
      problems.error('INVALID_NODE', `${at}.id: must be a string of 1–${FLOW_LIMITS.maxIdLength} characters without control characters`);
      continue;
    }
    const where = `node ${quote(id)}`;
    let block: string | undefined;
    const rawBlock = node.block;
    if (!isSafeId(rawBlock)) {
      problems.error('INVALID_NODE', `${where}: block must be a block id string`, { node: id });
    } else block = rawBlock;
    const position = isRecord(node.position) ? { ...node.position } : undefined;
    if (!position || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
      problems.error('INVALID_NODE', `${where}: position must be { x, y } with finite numbers`, { node: id });
    }
    let label: string | undefined;
    const rawLabel = node.label;
    if (rawLabel !== undefined) {
      if (typeof rawLabel !== 'string' || rawLabel.length > FLOW_LIMITS.maxLabelLength) {
        problems.error('INVALID_NODE', `${where}: label must be a string of at most ${FLOW_LIMITS.maxLabelLength} characters`, { node: id });
      } else label = rawLabel;
    }
    const params = dict<FlowValue>();
    const badParams = new Set<string>();
    const rawParams = node.params;
    if (rawParams !== undefined) {
      if (!isRecord(rawParams)) {
        problems.error('INVALID_NODE', `${where}: params must be an object`, { node: id });
      } else {
        const given = { ...rawParams };
        const names = Object.keys(given);
        if (names.length > FLOW_LIMITS.maxParamsPerNode) {
          problems.error('INVALID_NODE', `${where}: at most ${FLOW_LIMITS.maxParamsPerNode} params`, { node: id });
        } else {
          for (const name of names) {
            const value = given[name];
            if (!isFlowValue(value) || (typeof value === 'string' && value.length > FLOW_LIMITS.maxStringLength)) {
              problems.error(
                'INVALID_PARAM',
                `${where}: param ${quote(name)} must be a JSON scalar (strings at most ${FLOW_LIMITS.maxStringLength} characters)`,
                { node: id },
              );
              badParams.add(name);
            } else params[name] = value;
          }
        }
      }
    }
    nodes.push(Object.freeze({ index: i, id, block, params: Object.freeze(params), badParams, label }));
  }

  const wires: SnapWire[] = [];
  for (let i = 0; i < wireList.length; i++) {
    const at = `wires[${i}]`;
    const rawWire = wireList[i];
    if (!isRecord(rawWire)) {
      problems.error('INVALID_WIRE', `${at}: must be an object`);
      continue;
    }
    const wire = { ...rawWire };
    const id = wire.id;
    if (!isSafeId(id)) {
      problems.error('INVALID_WIRE', `${at}.id: must be a string of 1–${FLOW_LIMITS.maxIdLength} characters without control characters`);
      continue;
    }
    const from = readEnd(wire.from);
    const to = readEnd(wire.to);
    if (!from || !to) {
      problems.error('INVALID_WIRE', `wire ${quote(id)}: from and to must be { node, port } with id strings`, { wire: id });
      continue;
    }
    wires.push(Object.freeze({ index: i, id, from, to }));
  }
  return { nodes, wires };
}

// -----------------------------------------------------------------------------
// Blocks
// -----------------------------------------------------------------------------

/** Built-in structural blocks, read once. They always win over a registry entry with the same id. */
const BUILTIN_INFOS: ReadonlyMap<string, BlockInfo> = new Map(
  BUILTIN_FLOW_BLOCKS.map((block) => {
    const { info, problems } = readBlockDefinition(block);
    if (!info) throw new Error(`built-in block ${block.id} is invalid: ${problems.join('; ')}`);
    return [block.id, info];
  }),
);

export function builtinBlockInfo(id: string): BlockInfo | undefined {
  return BUILTIN_INFOS.get(id);
}

type Resolved = { info: BlockInfo } | { missing: string } | { invalid: string } | { unchecked: true };

function makeResolver(registry: RegistryReader | undefined, structural: boolean): (id: string) => Resolved {
  const cache = new Map<string, Resolved>();
  const lookup = (id: string): Resolved => {
    const builtin = BUILTIN_INFOS.get(id);
    if (builtin) return { info: builtin };
    if (structural) return { unchecked: true };
    let def: unknown;
    try {
      def = registry?.get(FLOW_BLOCK_KIND_NAME, id);
    } catch (error) {
      return { invalid: `registry lookup failed: ${errorMessage(error)}` };
    }
    if (def === undefined) {
      // A registry without any flow block usually means the holodeck.flow
      // engine (which registers the kind) is missing: say so.
      let none = true;
      try {
        none = !registry || registry.list(FLOW_BLOCK_KIND_NAME).length === 0;
      } catch {
        // keep the generic hint
      }
      return { missing: none ? ' (no flow blocks are installed: is the holodeck.flow engine registered?)' : '' };
    }
    const read = readBlockDefinition(def);
    return read.info ? { info: read.info } : { invalid: read.problems.slice(0, 3).join('; ') };
  };
  return (id) => {
    let resolved = cache.get(id);
    if (!resolved) cache.set(id, (resolved = lookup(id)));
    return resolved;
  };
}

// -----------------------------------------------------------------------------
// Analysis
// -----------------------------------------------------------------------------

export interface AnalyzeOptions {
  /** Where non-built-in blocks are looked up (`holodeck.flow.block`). */
  registry?: RegistryReader;
  /**
   * Structure only: blocks other than the built-ins are not looked up, and
   * ports, types and params of those nodes are not checked. Used by the
   * engine's `validateBody`, which runs without a registry.
   */
  structural?: boolean;
}

/** Validate a body and build the graph the compiler uses. Never throws. */
export function analyzeFlowGraph(body: unknown, options: AnalyzeOptions = {}): { problems: readonly FlowProblem[]; graph: AnalyzedGraph | undefined } {
  const problems = new Problems();
  try {
    const graph = analyze(body, options, problems);
    return { problems: problems.finish(), graph };
  } catch (error) {
    // Only reachable through hostile input (a throwing getter or Proxy in the body).
    problems.error('INVALID_BODY', `body could not be read: ${errorMessage(error)}`);
    return { problems: problems.finish(), graph: undefined };
  }
}

/**
 * Every problem with a flow body (`holodeck.flow.graph.v1`): structure,
 * duplicate ids, unknown blocks, ports and params, type mismatches, inputs
 * with several wires, and cycles that do not pass through a `flow.delay`
 * block (with the cycle's path). Blocks are looked up in `registry`
 * (`holodeck.flow.block`); the built-in structural blocks are always known.
 * Never throws; problems are frozen. Warnings (`severity: 'warning'`) do not
 * stop a deployment.
 */
export function validateFlowGraph(body: unknown, registry?: RegistryReader): readonly FlowProblem[] {
  return analyzeFlowGraph(body, { registry }).problems;
}

/** True when `problems` contains no error (warnings allowed). */
export function isDeployable(problems: readonly FlowProblem[]): boolean {
  return problems.every((p) => p.severity !== 'error');
}

function analyze(body: unknown, options: AnalyzeOptions, problems: Problems): AnalyzedGraph | undefined {
  const read = readBody(body, problems);
  if (!read) return undefined;
  const resolve = makeResolver(options.registry, options.structural === true);

  // Nodes: first occurrence of an id wins; later ones are reported and dropped.
  const byId = new Map<string, GraphNode>();
  const nodes: GraphNode[] = [];
  for (const snap of read.nodes) {
    const first = byId.get(snap.id);
    if (first) {
      problems.error('DUPLICATE_ID', `node id ${quote(snap.id)} is used by nodes[${first.snap.index}] and nodes[${snap.index}]`, { node: snap.id });
      continue;
    }
    let info: BlockInfo | undefined;
    if (snap.block !== undefined) {
      const resolved = resolve(snap.block);
      if ('info' in resolved) info = resolved.info;
      else if ('missing' in resolved) {
        problems.error('UNKNOWN_BLOCK', `node ${quote(snap.id)}: block ${quote(snap.block)} is not installed${resolved.missing}`, {
          node: snap.id,
        });
      } else if ('invalid' in resolved) {
        problems.error('INVALID_BLOCK', `node ${quote(snap.id)}: block ${quote(snap.block)} has an invalid definition: ${resolved.invalid}`, {
          node: snap.id,
        });
      }
    }
    const node: GraphNode = { order: nodes.length, snap, info, params: undefined, variadic: new Map() };
    byId.set(snap.id, node);
    nodes.push(node);
  }

  for (const node of nodes) checkParams(node, problems);

  // Wires.
  const wireIds = new Map<string, SnapWire>();
  const drivers = new Map<string, SnapWire>();
  const wires: GraphWire[] = [];
  for (const snap of read.wires) {
    const where = `wire ${quote(snap.id)}`;
    const firstWithId = wireIds.get(snap.id);
    if (firstWithId) {
      problems.error('DUPLICATE_ID', `wire id ${quote(snap.id)} is used by wires[${firstWithId.index}] and wires[${snap.index}]`, { wire: snap.id });
    } else wireIds.set(snap.id, snap);
    const from = byId.get(snap.from.node);
    const to = byId.get(snap.to.node);
    if (!from) problems.error('UNKNOWN_NODE', `${where}: from node ${quote(snap.from.node)} does not exist`, { wire: snap.id });
    if (!to) problems.error('UNKNOWN_NODE', `${where}: to node ${quote(snap.to.node)} does not exist`, { wire: snap.id });
    let output: OutputInfo | undefined;
    if (from?.info) {
      output = findOutput(from.info, snap.from.port);
      if (!output) {
        problems.error('UNKNOWN_PORT', `${where}: node ${quote(from.snap.id)} (${from.info.id}) has no output ${quote(snap.from.port)}`, {
          wire: snap.id,
          node: from.snap.id,
        });
      }
    }
    let input: GraphWire['input'];
    if (to?.info) {
      input = resolveInputPort(to.info, snap.to.port);
      if (!input) {
        problems.error('UNKNOWN_PORT', `${where}: node ${quote(to.snap.id)} (${to.info.id}) has no input ${quote(snap.to.port)}`, {
          wire: snap.id,
          node: to.snap.id,
        });
      }
    }
    if (output && input && !typesCompatible(output.type, input.input.type)) {
      problems.error(
        'TYPE_MISMATCH',
        `${where}: output ${quote(snap.from.port)} is ${output.type} but input ${quote(snap.to.port)} is ${input.input.type}`,
        { wire: snap.id },
      );
    }
    if (to) {
      const key = pairKey(to.snap.id, snap.to.port);
      const driver = drivers.get(key);
      if (driver) {
        problems.error(
          'MULTIPLE_DRIVERS',
          `${where}: input ${quote(snap.to.port)} of node ${quote(to.snap.id)} is already driven by wire ${quote(driver.id)}`,
          { wire: snap.id, node: to.snap.id },
        );
      } else drivers.set(key, snap);
    }
    if (from && to) {
      wires.push({ snap, from, to, output, input });
      if (input && input.index !== undefined) {
        const highest = to.variadic.get(input.input.name) ?? 0;
        if (input.index > highest) to.variadic.set(input.input.name, input.index);
      }
    }
  }

  findAlgebraicLoops(nodes, wires, problems);
  checkSignalTargets(nodes, problems);
  return { nodes, byId, wires };
}

function checkParams(node: GraphNode, problems: Problems): void {
  const info = node.info;
  if (!info) return;
  const where = `node ${quote(node.snap.id)}`;
  const extra = { node: node.snap.id };
  const before = problems.errors;
  for (const name of Object.keys(node.snap.params)) {
    if (!info.params.has(name)) problems.error('UNKNOWN_PARAM', `${where}: ${info.id} has no param ${quote(name)}`, extra);
  }
  for (const name of node.snap.badParams) {
    if (!info.params.has(name)) problems.error('UNKNOWN_PARAM', `${where}: ${info.id} has no param ${quote(name)}`, extra);
  }
  for (const [name, spec] of info.params) {
    if (node.snap.badParams.has(name)) continue;
    if (hasOwn(node.snap.params, name)) {
      for (const message of paramValueProblems(spec, node.snap.params[name], `${where}: param ${quote(name)}`)) {
        problems.error('INVALID_PARAM', message, extra);
      }
    } else if (spec.required) {
      problems.error('MISSING_PARAM', `${where}: ${info.id} needs param ${quote(name)}`, extra);
    }
  }
  if (problems.errors !== before || node.snap.badParams.size) return;
  const params = resolveParams(info, node.snap.params);
  if (info.checkParams) {
    let result: unknown;
    try {
      result = info.checkParams(params);
    } catch (error) {
      problems.error('INVALID_PARAM', `${where}: ${info.id}.checkParams threw: ${errorMessage(error)}`, extra);
      return;
    }
    if (!Array.isArray(result) || result.length > 64 || !result.every((m) => typeof m === 'string')) {
      problems.error('INVALID_PARAM', `${where}: ${info.id}.checkParams must return an array of at most 64 strings`, extra);
      return;
    }
    if (result.length) {
      for (const message of result as string[]) problems.error('INVALID_PARAM', `${where}: ${message.slice(0, 1000)}`, extra);
      return;
    }
  }
  node.params = params;
}

/**
 * Cycles that do not pass through a `flow.delay` node ("algebraic loops").
 * Delay nodes are removed; every strongly connected component left with more
 * than one node, or with a self-wire, is one problem, reported with a
 * shortest cycle through its first node (document order). Iterative Tarjan,
 * so a 10 000-node chain cannot overflow the call stack.
 */
function findAlgebraicLoops(nodes: readonly GraphNode[], wires: readonly GraphWire[], problems: Problems): void {
  const n = nodes.length;
  const isDelay = nodes.map((node) => node.snap.block === FLOW_DELAY_BLOCK);
  const adj: number[][] = nodes.map(() => []);
  for (const wire of wires) {
    if (isDelay[wire.from.order] || isDelay[wire.to.order]) continue;
    adj[wire.from.order]!.push(wire.to.order);
  }
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const work: Array<[node: number, edge: number]> = [];
  const components: number[][] = [];
  let counter = 0;
  for (let root = 0; root < n; root++) {
    if (isDelay[root] || index[root] !== -1) continue;
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    work.push([root, 0]);
    while (work.length) {
      const frame = work[work.length - 1]!;
      const u = frame[0];
      const edges = adj[u]!;
      if (frame[1] < edges.length) {
        const w = edges[frame[1]++]!;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[u] = Math.min(low[u]!, index[w]!);
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]![0];
        low[parent] = Math.min(low[parent]!, low[u]!);
      }
      if (low[u] === index[u]) {
        const component: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          component.push(w);
        } while (w !== u);
        if (component.length > 1 || edges.includes(u)) components.push(component);
      }
    }
  }
  // Report in document order of each loop's first node.
  const first = (component: readonly number[]) => component.reduce((m, i) => (i < m ? i : m), Number.POSITIVE_INFINITY);
  components.sort((a, b) => first(a) - first(b));
  for (const component of components) {
    const path = cycleThrough(component, adj).map((i) => nodes[i]!.snap.id);
    problems.error('CYCLE_WITHOUT_DELAY', `cycle without a ${FLOW_DELAY_BLOCK} block: ${describePath(path)}`, {
      node: path[0],
      path,
    });
  }
}

/** Shortest cycle through the component's first node (BFS inside the component). */
function cycleThrough(component: readonly number[], adj: readonly number[][]): number[] {
  const members = new Set(component);
  let root = component[0]!;
  for (const i of component) if (i < root) root = i;
  const parent = new Map<number, number>([[root, -1]]);
  const queue = [root];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    for (const w of adj[u]!) {
      if (!members.has(w)) continue;
      if (w === root) {
        const back: number[] = [];
        for (let x = u; x !== root; x = parent.get(x)!) back.push(x);
        return [root, ...back.reverse(), root];
      }
      if (!parent.has(w)) {
        parent.set(w, u);
        queue.push(w);
      }
    }
  }
  return [root, root]; // unreachable for a strongly connected component
}

function describePath(path: readonly string[]): string {
  const shown = path.length > 12 ? [...path.slice(0, 5), `… (${path.length - 10} more) …`, ...path.slice(-5)] : path;
  return shown.map((id, i) => (i === 5 && path.length > 12 ? id : quote(id))).join(' → ');
}

/** Two `signal.out` nodes writing the same signal fight each other: a warning, not an error. */
function checkSignalTargets(nodes: readonly GraphNode[], problems: Problems): void {
  const targets = new Map<string, string>();
  for (const node of nodes) {
    if (node.snap.block !== SIGNAL_OUT_BLOCK || !node.params) continue;
    const key = pairKey(String(node.params.connection), String(node.params.source));
    const first = targets.get(key);
    if (first !== undefined) {
      problems.add(
        'warning',
        'DUPLICATE_SIGNAL_TARGET',
        `node ${quote(node.snap.id)}: writes the same signal as node ${quote(first)}; the last change wins`,
        { node: node.snap.id },
      );
    } else targets.set(key, node.snap.id);
  }
}
