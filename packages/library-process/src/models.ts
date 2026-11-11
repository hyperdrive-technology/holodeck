import contract from './models.json';

/**
 * Where a process GLB's origin sits (docs/assets/process-catalog.md,
 * "Authoring rules"): `inline` on the pipe axis at the body centre (placed at
 * `pipeWorldY()`), `floor` on the floor at the footprint centre, `mounted` at
 * the bottom of its process connection.
 */
export type ProcessModelKind = 'inline' | 'floor' | 'mounted';

/** `[x, y, z]` in the model's own three.js frame (Y up, 1 unit = 1 grid cell). */
export type ModelPoint = readonly [number, number, number];

/**
 * The node and placement contract of one GLB, mirrored from the final
 * `c.check(...)` call of its Blender script (blender/parts/process/<slug>.py),
 * which is the source of truth. `process-glb.test.ts` checks every shipped GLB
 * against this, and `parts.test.ts` checks every definition in parts.json
 * against it, so a new part needs: script + GLB + one entry here + one
 * definition in parts.json.
 */
export interface ProcessModelContract {
  kind: ProcessModelKind;
  /** Placement envelope `[X, Z]`, centred on the origin. */
  footprint: readonly [number, number];
  /** Vertical envelope from `yMin`. */
  height: number;
  /** Lowest point (below 0 for inline bodies and parts that hang through their mounting face). */
  yMin: number;
  /** Inline parts: face-to-face length along X (`port.in` at -length/2, `port.out` at +length/2). */
  length?: number;
  /** `port.<name>` empties (nozzle flange faces) and their positions. */
  ports: Readonly<Record<string, ModelPoint>>;
  /** `anim.<name>` pivots (moving meshes are their children) and their positions. */
  anim: Readonly<Record<string, ModelPoint>>;
  /** Whether the model has an `hd.accent` piece (the per-instance state colour). */
  accent: boolean;
}

/** Slug (`valve-ball`) -> GLB contract. Frozen: a host cannot repoint a model. */
export const PROCESS_MODELS: Readonly<Record<string, ProcessModelContract>> = deepFreeze(
  contract as unknown as Record<string, ProcessModelContract>,
);

/** Every model slug, in catalogue order. */
export const PROCESS_MODEL_SLUGS: readonly string[] = Object.freeze(Object.keys(PROCESS_MODELS));

/**
 * Asset-relative path of a model (`models/<slug>.glb`), resolved by the host's
 * `assetUrl` at install time; throws on an unknown slug (including
 * `Object.prototype` keys) so a typo fails loudly, like the editor's `modelUrl`.
 */
export function processModelPath(slug: string): string {
  if (!Object.prototype.hasOwnProperty.call(PROCESS_MODELS, slug)) {
    throw new Error(`unknown process model "${slug}" (have: ${[...PROCESS_MODEL_SLUGS].sort().join(', ')})`);
  }
  return `models/${slug}.glb`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
