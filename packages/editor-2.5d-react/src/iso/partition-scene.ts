import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPartDefinition } from '../registry/types';
import { getDefaultIsoRegistry } from '../registry/default';
import type { IsoPlacement } from './scene';

/** One InstancedMesh per pool. Extra objects wrap into another pool. */
export const INSTANCE_LIMIT = 1024;

/**
 * Split placements into pooled batches (one per `instanced` part id, in
 * scene order) and unique meshes. A part can opt single placements out with
 * `instancedWhen` (e.g. a pipe with no far end). Unknown parts stay unique;
 * `SceneObjectView` then renders nothing for them.
 */
export function partitionByPart(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry = getDefaultIsoRegistry(),
): { pools: Map<string, IsoPlacement[]>; unique: IsoPlacement[] } {
  const pools = new Map<string, IsoPlacement[]>();
  const unique: IsoPlacement[] = [];
  for (const object of objects) {
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, object.object);
    if (def?.instanced && def.instancedRenderer && (def.instancedWhen?.(object) ?? true)) {
      const pool = pools.get(def.id);
      if (pool) pool.push(object);
      else pools.set(def.id, [object]);
    } else {
      unique.push(object);
    }
  }
  return { pools, unique };
}

/** Built-in-shaped view of `partitionByPart` (kept for existing callers and tests). */
export function partitionScene(
  objects: readonly IsoPlacement[],
  registry?: ContributionRegistry,
): {
  pipes: IsoPlacement[];
  elbows: IsoPlacement[];
  valves: IsoPlacement[];
  caps: IsoPlacement[];
  unique: IsoPlacement[];
} {
  const { pools, unique } = partitionByPart(objects, registry);
  return {
    pipes: pools.get('pipe') ?? [],
    elbows: pools.get('elbow') ?? [],
    valves: pools.get('valve') ?? [],
    caps: pools.get('end-cap') ?? [],
    unique,
  };
}

export function poolCount(n: number, limit = INSTANCE_LIMIT): number {
  if (n <= 0) {
    return 0;
  }
  return Math.ceil(n / limit);
}

export function slices<T>(items: readonly T[], limit = INSTANCE_LIMIT): T[][] {
  if (items.length === 0) {
    return [];
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(items.slice(i, i + limit) as T[]);
  }
  return out;
}
