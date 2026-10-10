import type { FlowComponentContribution } from '@holodeck/sdk';

/**
 * Merge order: built-ins < registry < explicit props. A key present in BOTH the
 * registry and the explicit props is ambiguous (who wins?), so it throws rather
 * than silently picking one. Registry-over-built-in is allowed on purpose.
 */
export function mergeFlowComponents<C>(
  label: 'nodeTypes' | 'edgeTypes',
  builtins: Record<string, C>,
  contributions: readonly FlowComponentContribution[],
  explicit: Record<string, C> | undefined,
): Record<string, C> {
  const fromRegistry: Record<string, C> = {};
  for (const c of contributions) fromRegistry[c.id] = c.component as unknown as C;
  const conflicts = Object.keys(explicit ?? {}).filter((k) => k in fromRegistry);
  if (conflicts.length) {
    throw new Error(
      `HolodeckEditor2D: ${label} key(s) ${conflicts.map((k) => `"${k}"`).join(', ')} are provided both via props and the registry; remove one`,
    );
  }
  return { ...builtins, ...fromRegistry, ...explicit };
}
