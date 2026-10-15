/**
 * Compile a validated flow body into an immutable plan.
 *
 * Evaluation order: every non-delay node in topological order (Kahn's
 * algorithm, ties in document order, so the order is deterministic), then
 * every `flow.delay` node. Delay outputs are therefore sources for the main
 * phase: readers see the value from the previous scan, which is what makes a
 * feedback loop through a delay well defined.
 *
 * The public `FlowPlan` is frozen plain data (ids, ports, params, sources).
 * The executable side (bound `evaluate` functions, slot indexes) stays in a
 * private WeakMap keyed by the plan, so `createFlowRun` only accepts plans
 * this module produced and nobody can swap a function inside one.
 */

import type { RegistryReader } from '@holodeck/sdk';
import type { BlockInfo, FlowParams } from './block';
import { FLOW_DELAY_BLOCK, SIGNAL_IN_BLOCK, SIGNAL_OUT_BLOCK } from './builtins';
import {
  analyzeFlowGraph,
  stronglyConnectedComponents,
  FLOW_GRAPH_FORMAT,
  isDeployable,
  type AnalyzedGraph,
  type FlowProblem,
  type FlowWireEnd,
  type GraphNode,
} from './graph';
import { FAULT_PORT, flowSource, type FlowPortType, type FlowValue } from './values';

export interface FlowPlanInput {
  /** Port name wires use: `a`, or a variadic instance such as `in2`. */
  readonly port: string;
  /** Input spec name (`in` for `in2`). */
  readonly input: string;
  /** 1-based instance of a variadic input; `undefined` otherwise. */
  readonly index: number | undefined;
  readonly type: FlowPortType;
  /** Driving output, or `null` when unconnected. */
  readonly from: FlowWireEnd | null;
  /** Value while unconnected. */
  readonly default: FlowValue;
}

export interface FlowPlanOutput {
  readonly port: string;
  readonly type: FlowPortType;
  /** `flow:<nodeId>.<port>`. */
  readonly source: string;
}

export interface FlowPlanNode {
  readonly id: string;
  readonly block: string;
  readonly label: string | undefined;
  /** `delay` nodes run after every `main` node and commit together. */
  readonly phase: 'main' | 'delay';
  readonly params: FlowParams;
  readonly inputs: readonly FlowPlanInput[];
  readonly outputs: readonly FlowPlanOutput[];
  /** `flow:<nodeId>.$fault`: `null`, or the message while the node is faulted. */
  readonly faultSource: string;
}

/** A `signal.in` / `signal.out` node and the provider signal it reads or writes. */
export interface FlowSignalRef {
  readonly node: string;
  readonly connection: string;
  readonly source: string;
}

export interface FlowPlan {
  readonly format: typeof FLOW_GRAPH_FORMAT;
  /** In evaluation order. */
  readonly nodes: readonly FlowPlanNode[];
  /** Every published source: per node (evaluation order) its outputs, then its `$fault`. */
  readonly sources: readonly string[];
  readonly signalsIn: readonly FlowSignalRef[];
  readonly signalsOut: readonly FlowSignalRef[];
  /** Warnings from validation (errors prevent compilation). */
  readonly warnings: readonly FlowProblem[];
}

export class FlowGraphError extends Error {
  readonly code = 'INVALID_GRAPH' as const;
  constructor(readonly problems: readonly FlowProblem[]) {
    const errors = problems.filter((p) => p.severity === 'error');
    super(
      `invalid flow graph (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n- ${errors
        .slice(0, 20)
        .map((p) => p.message)
        .join('\n- ')}${errors.length > 20 ? '\n- …' : ''}`,
    );
    this.name = 'FlowGraphError';
  }
}

// -----------------------------------------------------------------------------
// Program (private executable form)
// -----------------------------------------------------------------------------

/**
 * Where an input instance gets its value: an output slot (converted to
 * `convert`), or a constant. `internal`: the reader and the output's node are
 * on the same feedback loop (see `ProgramLoop`).
 */
export type ProgramSlot =
  | { readonly slot: number; readonly convert: FlowPortType | undefined; readonly internal: boolean }
  | { readonly value: FlowValue };

export interface ProgramInput {
  readonly name: string;
  readonly variadic: boolean;
  readonly slots: readonly ProgramSlot[];
}

export type ProgramRole = 'block' | 'delay' | 'signal-in' | 'signal-out';

export interface ProgramNode {
  /** Position in evaluation order. */
  readonly index: number;
  readonly plan: FlowPlanNode;
  readonly info: BlockInfo;
  readonly role: ProgramRole;
  /** Index into `Program.loops` of the feedback loop this node is on, or `undefined`. */
  readonly loop: number | undefined;
  readonly inputs: readonly ProgramInput[];
  /** Output port → value slot. */
  readonly outputSlots: ReadonlyMap<string, number>;
  readonly outputs: ReadonlyArray<{ readonly port: string; readonly type: FlowPortType; readonly slot: number; readonly source: string }>;
}

export interface Program {
  readonly nodes: readonly ProgramNode[];
  readonly byId: ReadonlyMap<string, ProgramNode>;
  /** Total output slots. */
  readonly slotCount: number;
  /** source → output slot, or the node whose `$fault` it is. */
  readonly bySource: ReadonlyMap<string, { readonly slot: number } | { readonly fault: ProgramNode }>;
  /** Index of the first delay node in `nodes` (`nodes.length` when there is none). */
  readonly delayStart: number;
  /** Feedback loops, in topological order of the loops (upstream loops first). */
  readonly loops: readonly ProgramLoop[];
  /**
   * Order of the quality pass (run.ts): every non-delay node outside a loop,
   * and every loop as one unit, in topological order of the full wire graph
   * with each loop collapsed to one vertex. A loop therefore comes after every
   * node that feeds it from outside and before every node it feeds.
   */
  readonly qualityOrder: readonly QualityStep[];
}

/**
 * A feedback loop: a strongly connected component of the *full* wire graph
 * (delays included) that contains a cycle. Validation rejects every cycle
 * without a delay, so each loop holds at least one `flow.delay`. A block's
 * own state is not a loop here (it is handled per node; README "Quality").
 *
 * Everything on a loop shares one quality per scan, its *health* (run.ts),
 * which is what lets loop state survive a non-good scan without either
 * latching bad forever or laundering bad readings into good output.
 */
export interface ProgramLoop {
  readonly index: number;
  /** Every node on the loop, delays included, in evaluation order. */
  readonly members: readonly ProgramNode[];
}

export type QualityStep = { readonly node: ProgramNode } | { readonly loop: ProgramLoop };

const programs = new WeakMap<FlowPlan, Program>();

/** The executable form of a plan made by `compileFlow`; `undefined` for anything else. */
export function programOf(plan: unknown): Program | undefined {
  return typeof plan === 'object' && plan !== null ? programs.get(plan as FlowPlan) : undefined;
}

function roleOf(block: string): ProgramRole {
  if (block === FLOW_DELAY_BLOCK) return 'delay';
  if (block === SIGNAL_IN_BLOCK) return 'signal-in';
  if (block === SIGNAL_OUT_BLOCK) return 'signal-out';
  return 'block';
}

// -----------------------------------------------------------------------------
// Compilation
// -----------------------------------------------------------------------------

/**
 * Validate and compile in one pass over a single snapshot of `body`.
 * `plan` is set when there are no errors; `problems` lists everything
 * (including warnings, which are also on `plan.warnings`). Never throws.
 */
export function tryCompileFlow(body: unknown, registry?: RegistryReader): { plan: FlowPlan | undefined; problems: readonly FlowProblem[] } {
  const { problems, graph } = analyzeFlowGraph(body, { registry });
  if (!graph || !isDeployable(problems)) return { plan: undefined, problems };
  return { plan: build(graph, problems), problems };
}

/**
 * Compile a flow body (`holodeck.flow.graph.v1`) against the blocks in
 * `registry` (the built-in structural blocks are always available). Throws
 * `FlowGraphError` listing every error.
 */
export function compileFlow(body: unknown, registry?: RegistryReader): FlowPlan {
  const { plan, problems } = tryCompileFlow(body, registry);
  if (!plan) throw new FlowGraphError(problems);
  return plan;
}

function evaluationOrder(graph: AnalyzedGraph): GraphNode[] {
  const isDelay = (node: GraphNode) => node.snap.block === FLOW_DELAY_BLOCK;
  const indegree = new Int32Array(graph.nodes.length);
  const next: number[][] = graph.nodes.map(() => []);
  for (const wire of graph.wires) {
    if (isDelay(wire.from) || isDelay(wire.to)) continue;
    next[wire.from.order]!.push(wire.to.order);
    indegree[wire.to.order]!++;
  }
  const queue: number[] = [];
  for (const node of graph.nodes) if (!isDelay(node) && indegree[node.order] === 0) queue.push(node.order);
  const order: GraphNode[] = [];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]!;
    order.push(graph.nodes[u]!);
    for (const w of next[u]!) if (--indegree[w]! === 0) queue.push(w);
  }
  const mainCount = graph.nodes.filter((node) => !isDelay(node)).length;
  // Validation reports every such cycle, so this only guards against a bug.
  if (order.length !== mainCount) throw new Error('flow compiler: cycle survived validation');
  for (const node of graph.nodes) if (isDelay(node)) order.push(node);
  return order;
}

/**
 * Strongly connected components of the full wire graph (delays included), in
 * topological order, and the loop index of every node on a cyclic one.
 */
function components(graph: AnalyzedGraph): { sccs: number[][]; loopOf: Map<GraphNode, number> } {
  const adj: number[][] = graph.nodes.map(() => []);
  for (const wire of graph.wires) adj[wire.from.order]!.push(wire.to.order);
  const sccs = stronglyConnectedComponents(adj).reverse();
  const loopOf = new Map<GraphNode, number>();
  let loops = 0;
  for (const scc of sccs) {
    if (scc.length === 1 && !adj[scc[0]!]!.includes(scc[0]!)) continue;
    const index = loops++;
    for (const i of scc) loopOf.set(graph.nodes[i]!, index);
  }
  return { sccs, loopOf };
}

function build(graph: AnalyzedGraph, problems: readonly FlowProblem[]): FlowPlan {
  const order = evaluationOrder(graph);
  const { sccs, loopOf } = components(graph);

  // Output slots in evaluation order.
  const slotOf = new Map<GraphNode, Map<string, number>>();
  let slotCount = 0;
  for (const node of order) {
    const slots = new Map<string, number>();
    for (const output of node.info!.outputs) slots.set(output.name, slotCount++);
    slotOf.set(node, slots);
  }
  // Wire into (node, port).
  const driverOf = new Map<GraphNode, Map<string, { from: GraphNode; port: string; type: FlowPortType }>>();
  for (const wire of graph.wires) {
    let inputs = driverOf.get(wire.to);
    if (!inputs) driverOf.set(wire.to, (inputs = new Map()));
    inputs.set(wire.snap.to.port, { from: wire.from, port: wire.snap.from.port, type: wire.output!.type });
  }

  const planNodes: FlowPlanNode[] = [];
  const programNodes: ProgramNode[] = [];
  const bySource = new Map<string, { slot: number } | { fault: ProgramNode }>();
  const sources: string[] = [];
  const signalsIn: FlowSignalRef[] = [];
  const signalsOut: FlowSignalRef[] = [];

  order.forEach((node, index) => {
    const info = node.info!;
    const id = node.snap.id;
    const drivers = driverOf.get(node);
    const planInputs: FlowPlanInput[] = [];
    const programInputs: ProgramInput[] = [];
    for (const input of info.inputs) {
      const count = input.variadic ? Math.max(input.min, node.variadic.get(input.name) ?? 0) : 1;
      const slots: ProgramSlot[] = [];
      for (let i = 1; i <= count; i++) {
        const port = input.variadic ? `${input.name}${i}` : input.name;
        const driver = drivers?.get(port);
        const from = driver ? Object.freeze({ node: driver.from.snap.id, port: driver.port }) : null;
        planInputs.push(
          Object.freeze({ port, input: input.name, index: input.variadic ? i : undefined, type: input.type, from, default: input.default }),
        );
        if (driver) {
          // Typed outputs are type-checked when produced; only `any` → typed needs converting.
          const convert = input.type !== 'any' && driver.type === 'any' ? input.type : undefined;
          const loop = loopOf.get(node);
          const internal = loop !== undefined && loopOf.get(driver.from) === loop;
          slots.push(Object.freeze({ slot: slotOf.get(driver.from)!.get(driver.port)!, convert, internal }));
        } else slots.push(Object.freeze({ value: input.default }));
      }
      programInputs.push(Object.freeze({ name: input.name, variadic: input.variadic, slots: Object.freeze(slots) }));
    }
    const nodeSlots = slotOf.get(node)!;
    const outputs = info.outputs.map((output) =>
      Object.freeze({ port: output.name, type: output.type, slot: nodeSlots.get(output.name)!, source: flowSource(id, output.name) }),
    );
    const planNode: FlowPlanNode = Object.freeze({
      id,
      block: info.id,
      label: node.snap.label,
      phase: info.id === FLOW_DELAY_BLOCK ? 'delay' : 'main',
      params: node.params!,
      inputs: Object.freeze(planInputs),
      outputs: Object.freeze(outputs.map(({ port, type, source }) => Object.freeze({ port, type, source }))),
      faultSource: flowSource(id, FAULT_PORT),
    });
    const programNode: ProgramNode = Object.freeze({
      index,
      plan: planNode,
      info,
      role: roleOf(info.id),
      loop: loopOf.get(node),
      inputs: Object.freeze(programInputs),
      outputSlots: nodeSlots,
      outputs: Object.freeze(outputs),
    });
    planNodes.push(planNode);
    programNodes.push(programNode);
    for (const output of outputs) {
      bySource.set(output.source, { slot: output.slot });
      sources.push(output.source);
    }
    bySource.set(planNode.faultSource, { fault: programNode });
    sources.push(planNode.faultSource);
    if (programNode.role === 'signal-in' || programNode.role === 'signal-out') {
      const ref = Object.freeze({ node: id, connection: String(planNode.params.connection), source: String(planNode.params.source) });
      (programNode.role === 'signal-in' ? signalsIn : signalsOut).push(ref);
    }
  });

  const plan: FlowPlan = Object.freeze({
    format: FLOW_GRAPH_FORMAT,
    nodes: Object.freeze(planNodes),
    sources: Object.freeze(sources),
    signalsIn: Object.freeze(signalsIn),
    signalsOut: Object.freeze(signalsOut),
    warnings: Object.freeze(problems.filter((p) => p.severity === 'warning')),
  });
  const delayStart = programNodes.findIndex((n) => n.role === 'delay');
  const programOfNode = new Map(order.map((node, i) => [node, programNodes[i]!]));
  const loops: ProgramLoop[] = [];
  const qualityOrder: QualityStep[] = [];
  for (const scc of sccs) {
    const first = programOfNode.get(graph.nodes[scc[0]!]!)!;
    if (first.loop !== undefined) {
      const members = scc.map((i) => programOfNode.get(graph.nodes[i]!)!).sort((a, b) => a.index - b.index);
      const loop: ProgramLoop = Object.freeze({ index: first.loop, members: Object.freeze(members) });
      loops.push(loop);
      qualityOrder.push(Object.freeze({ loop }));
    } else if (first.role !== 'delay') qualityOrder.push(Object.freeze({ node: first }));
  }
  programs.set(
    plan,
    Object.freeze({
      nodes: Object.freeze(programNodes),
      byId: new Map(programNodes.map((n) => [n.plan.id, n])),
      slotCount,
      bySource,
      delayStart: delayStart === -1 ? programNodes.length : delayStart,
      loops: Object.freeze(loops),
      qualityOrder: Object.freeze(qualityOrder),
    }),
  );
  return plan;
}
