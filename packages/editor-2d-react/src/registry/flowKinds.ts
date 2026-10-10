/**
 * Flow-editor contribution kinds (`holodeck.flow.*`).
 *
 * The editor registers these on a `ContributionRegistry`; any extension that
 * carries `holodeck.flow.nodeType` / `edgeType` / `palette` items then shows up
 * in a mounted `HolodeckEditor2D`. Domain-neutral: no IEC knowledge here.
 */
import {
  ContributionRegistry,
  HOLODECK_KINDS,
  type ContributionKind,
  type FlowComponentContribution,
  type ScenePaletteItem,
} from '@holodeck/sdk';

export type FlowPaletteContribution = ScenePaletteItem & { id: string };

// React components are functions, or objects for memo()/forwardRef() results.
function isComponent(value: unknown): boolean {
  return typeof value === 'function' || (typeof value === 'object' && value !== null);
}

function isFlowComponent(item: unknown): item is FlowComponentContribution {
  if (!item || typeof item !== 'object') return false;
  const c = item as Partial<FlowComponentContribution>;
  return typeof c.id === 'string' && c.id.length > 0 && isComponent(c.component);
}

function isPaletteItem(item: unknown): item is FlowPaletteContribution {
  if (!item || typeof item !== 'object') return false;
  const p = item as Partial<ScenePaletteItem>;
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.nodeType === 'string' &&
    p.nodeType.length > 0 &&
    typeof p.label === 'string' &&
    (p.category === undefined || typeof p.category === 'string')
  );
}

export const flowNodeTypeKind: ContributionKind<FlowComponentContribution> = {
  kind: HOLODECK_KINDS.flowNodeType,
  validate: isFlowComponent,
};

export const flowEdgeTypeKind: ContributionKind<FlowComponentContribution> = {
  kind: HOLODECK_KINDS.flowEdgeType,
  validate: isFlowComponent,
};

export const flowPaletteKind: ContributionKind<FlowPaletteContribution> = {
  kind: HOLODECK_KINDS.flowPalette,
  validate: isPaletteItem,
};

/**
 * Register the three flow kinds. Returns one function that unregisters all.
 * Throws (DUPLICATE_KIND) if called twice on the same registry; a second editor
 * sharing a registry should call `ensureFlowKinds` instead.
 */
export function registerFlowKinds(registry: ContributionRegistry): () => void {
  const offs = [
    registry.registerKind(flowNodeTypeKind),
    registry.registerKind(flowEdgeTypeKind),
    registry.registerKind(flowPaletteKind),
  ];
  return () => offs.forEach((off) => off());
}

/** Idempotent variant: registers only the flow kinds that are still missing. */
export function ensureFlowKinds(registry: ContributionRegistry): void {
  if (!registry.hasKind(flowNodeTypeKind.kind)) registry.registerKind(flowNodeTypeKind);
  if (!registry.hasKind(flowEdgeTypeKind.kind)) registry.registerKind(flowEdgeTypeKind);
  if (!registry.hasKind(flowPaletteKind.kind)) registry.registerKind(flowPaletteKind);
}

export function createFlowRegistry(): ContributionRegistry {
  const registry = new ContributionRegistry();
  registerFlowKinds(registry);
  return registry;
}
