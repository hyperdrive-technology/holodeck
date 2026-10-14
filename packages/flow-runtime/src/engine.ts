/**
 * Pieces of the `holodeck.flow` engine descriptor that do not need React.
 *
 * The engine itself is registered by `@holodeck/editor-2d-react` (lane F2),
 * which owns the editor kinds (`nodeType`, `edgeType`, `palette`, `theme`).
 * It builds its descriptor from these:
 *
 *   const flowEngine: HolodeckEngine<FlowGraphBody> = {
 *     id: FLOW_ENGINE_ID, label: 'Holodeck flow', apiVersion: FLOW_ENGINE_API_VERSION,
 *     documentFormat: flowGraphFormat,
 *     kinds: [FLOW_BLOCK_KIND, flowNodeTypeKind, flowEdgeTypeKind, flowPaletteKind],
 *     validateBody: (body) => validateFlowBody(body),
 *     collectBindings: (body) => collectFlowBindings(body),
 *   };
 */

import type { BindingRef, RegistryReader } from '@holodeck/sdk';
import { SIGNAL_IN_BLOCK, SIGNAL_OUT_BLOCK } from './builtins';
import { analyzeFlowGraph } from './graph';
import { FLOW_LIMITS, isRecord } from './values';

export { FLOW_GRAPH_FORMAT, flowGraphFormat } from './graph';

export const FLOW_ENGINE_ID = 'holodeck.flow';
/**
 * Contribution API version of `holodeck.flow` (blocks, graph body). Adding an
 * optional field is a minor bump; removing or reinterpreting one is a major
 * bump (PACKAGING.md §2).
 */
export const FLOW_ENGINE_API_VERSION = '1.0.0';
/** Engine versions this runtime deploys (`HolodeckDocument.engineVersion`) and its package targets. */
export const FLOW_ENGINE_API_RANGE = '^1.0';

/**
 * `HolodeckEngine.validateBody` for flow bodies: every error as a message;
 * empty = valid. Never throws.
 *
 * Without `registry` it checks structure only: shapes, ids, duplicate ids,
 * wires to missing nodes, inputs with several wires, cycles without a
 * `flow.delay`, and the built-in blocks in full. Other blocks are not looked
 * up, because the descriptor is registered before packages are installed.
 * With `registry` (pass `host.registry`) every block must be installed and
 * ports, types and params are checked too. Warnings are not listed.
 */
export function validateFlowBody(body: unknown, registry?: RegistryReader): string[] {
  const { problems } = analyzeFlowGraph(body, registry ? { registry } : { structural: true });
  return problems.filter((p) => p.severity === 'error').map((p) => p.message);
}

/**
 * `HolodeckEngine.collectBindings` for flow bodies.
 *
 * Flow documents bind to other providers through blocks, not object params:
 * every `signal.in` and `signal.out` node yields one `BindingRef`:
 *
 *   { objectId: <node id>, param: 'value', binding: { connection, source } }
 *
 * (`value` is the port name on both blocks.) A host's `ProviderHub` given
 * these bindings opens and subscribes the right connections, so an editor can
 * show each signal's live value on the node, `validateBindings(doc, refs)`
 * reports connections missing from the document, and `hub.write(nodeId,
 * 'value', v)` forces a `signal.out` target by hand. The flow's own outputs
 * (`flow:<node>.<port>`) are not bindings: they belong to the deploy
 * provider's connection, which the body does not name.
 *
 * Tolerates unvalidated input: nodes without a string id, or whose
 * `connection` / `source` params are not non-empty strings, are skipped
 * (`validateFlowGraph` reports them). At most `FLOW_LIMITS.maxNodes` nodes are read.
 */
export function collectFlowBindings(body: unknown): BindingRef[] {
  const refs: BindingRef[] = [];
  try {
    if (!isRecord(body) || !Array.isArray(body.nodes)) return refs;
    const nodes: unknown[] = body.nodes;
    const count = Math.min(nodes.length, FLOW_LIMITS.maxNodes);
    for (let i = 0; i < count; i++) {
      const node = nodes[i];
      if (!isRecord(node)) continue;
      const id = node.id;
      const block = node.block;
      const params = node.params;
      if (typeof id !== 'string' || id === '' || (block !== SIGNAL_IN_BLOCK && block !== SIGNAL_OUT_BLOCK) || !isRecord(params)) continue;
      const connection = params.connection;
      const source = params.source;
      if (typeof connection !== 'string' || connection === '' || typeof source !== 'string' || source === '') continue;
      refs.push({ objectId: id, param: 'value', binding: { connection, source } });
    }
  } catch {
    // Hostile input (throwing getter / Proxy): return what was collected.
  }
  return refs;
}
