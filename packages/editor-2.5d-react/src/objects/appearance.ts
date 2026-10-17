/**
 * Per-placement opacity and z-order (holodeck#36), applied to whatever a part
 * renders without the part knowing about it.
 *
 * Materials are often shared (a GLB's finish materials across clones, the
 * label texture material, pooled instanced parts), so opacity never touches
 * a material in place: each mesh under the placement gets its own clone the
 * first time, and the clone is re-made if the part later swaps the mesh's
 * material (a GLB finishing its load, a label's text texture changing).
 * z-order is a `renderOrder` offset; three sorts both the opaque and the
 * transparent queues by renderOrder first, so higher z draws later.
 */

import type { Material, Object3D } from 'three';

/** renderOrder step per z unit: larger than any renderOrder a built-in part uses (<= 10). */
export const Z_RENDER_STEP = 100;

interface Owned {
  /** The part's own material we cloned from. */
  source: Material | Material[];
  /** What we put on the mesh. */
  applied: Material | Material[];
  /** The part's renderOrder before our offset. */
  baseOrder: number;
}

/** Bookkeeping for one placement: which meshes we cloned for. Dispose on unmount. */
export class AppearanceState {
  readonly owned = new Map<Object3D, Owned>();

  dispose(): void {
    for (const own of this.owned.values()) {
      for (const m of asArray(own.applied)) if (!asArray(own.source).includes(m)) m.dispose();
    }
    this.owned.clear();
  }
}

const asArray = (m: Material | Material[]): Material[] => (Array.isArray(m) ? m : [m]);

function fade(source: Material, opacity: number): Material {
  const clone = source.clone();
  clone.transparent = true;
  clone.opacity = source.opacity * opacity;
  // A see-through object must not hide what is behind it.
  clone.depthWrite = false;
  clone.userData = { ...source.userData, hdFadedFrom: source.uuid };
  return clone;
}

/**
 * Part components mutate their material through props (a label's `map` when
 * its text changes, a colour on alarm) without replacing it. Mirror the
 * properties that do that onto our clone. Not `Material.copy`: that would
 * reset `transparent` every frame and force a pipeline rebuild.
 */
function syncFaded(clone: Material, source: Material): void {
  const c = clone as unknown as Record<string, unknown> & { color?: { equals(o: unknown): boolean; copy(o: unknown): void } };
  const s = source as unknown as Record<string, unknown> & { color?: unknown };
  if ('map' in s && c.map !== s.map) {
    c.map = s.map;
    clone.needsUpdate = true;
  }
  if (c.color && s.color && !c.color.equals(s.color)) c.color.copy(s.color);
  if (clone.visible !== source.visible) clone.visible = source.visible;
}

/**
 * Bring every mesh / line under `root` in line with `opacity` (0..1) and `z`.
 * Idempotent and cheap when nothing changed (one map lookup per object), so
 * it can run every frame. Returns how many materials were (re)cloned.
 */
export function applyAppearance(root: Object3D, opacity: number, z: number, state: AppearanceState): number {
  let cloned = 0;
  const fadeOn = opacity < 1;
  const seen = new Set<Object3D>();
  root.traverse((o) => {
    const material = (o as { material?: Material | Material[] }).material;
    if (!material) return;
    seen.add(o);
    let own = state.owned.get(o);
    if (own && material !== own.applied) {
      // The part replaced the material since we last looked: forget our clone.
      for (const m of asArray(own.applied)) if (!asArray(own.source).includes(m)) m.dispose();
      own = { source: material, applied: material, baseOrder: own.baseOrder };
      state.owned.set(o, own);
    }
    if (!own) {
      own = { source: material, applied: material, baseOrder: o.renderOrder };
      state.owned.set(o, own);
    }
    const wantFaded = fadeOn;
    const isFaded = own.applied !== own.source;
    if (wantFaded && (!isFaded || asArray(own.applied)[0]!.opacity !== asArray(own.source)[0]!.opacity * opacity)) {
      if (isFaded) for (const m of asArray(own.applied)) m.dispose();
      own.applied = Array.isArray(own.source) ? own.source.map((m) => fade(m, opacity)) : fade(own.source, opacity);
      (o as unknown as { material: Material | Material[] }).material = own.applied;
      cloned += asArray(own.applied).length;
    } else if (wantFaded && isFaded) {
      const sources = asArray(own.source);
      asArray(own.applied).forEach((m, i) => syncFaded(m, sources[i]!));
    } else if (!wantFaded && isFaded) {
      for (const m of asArray(own.applied)) m.dispose();
      own.applied = own.source;
      (o as unknown as { material: Material | Material[] }).material = own.source;
    }
    const order = own.baseOrder + z * Z_RENDER_STEP;
    if (o.renderOrder !== order) o.renderOrder = order;
  });
  // Objects that left the subtree: drop their clones.
  for (const [o, own] of state.owned) {
    if (seen.has(o)) continue;
    for (const m of asArray(own.applied)) if (!asArray(own.source).includes(m)) m.dispose();
    state.owned.delete(o);
  }
  return cloned;
}

/** True when a placement shows a metadata plane (`meta` rows and not `metaHidden`). */
export function hasVisibleMeta(placement: { meta?: Record<string, unknown>; metaHidden?: boolean }): boolean {
  return !!placement.meta && !placement.metaHidden && Object.keys(placement.meta).length > 0;
}

/**
 * True when a placement must render as a unique mesh rather than through an
 * instanced pool: per-placement materials / renderOrder (opacity, z) or a
 * metadata plane, which only SceneObjectView draws (holodeck#95).
 */
export function needsUniqueRender(placement: { opacity?: number; z?: number; meta?: Record<string, unknown>; metaHidden?: boolean }): boolean {
  return needsAppearance(placement) || hasVisibleMeta(placement);
}

/** True when a placement needs the Appearance wrapper (and so cannot be pooled). */
export function needsAppearance(placement: { opacity?: number; z?: number }): boolean {
  return (placement.opacity !== undefined && placement.opacity < 1) || (placement.z !== undefined && placement.z !== 0);
}
