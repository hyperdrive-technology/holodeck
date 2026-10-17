import { Box3, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { authoredName } from '../../assets/process/apply-style';

/** Name of the GLB empty that marks where a data-only part's logo goes (lane A1 contract). */
export const LOGO_NODE_NAME = 'logo';

/** Lift above the face the logo sits on, so it wins the depth test without z-fighting. */
export const LOGO_LIFT = 0.004;

/** Default logo edge as a fraction of the footprint's short side, when nothing else sizes it. */
export const LOGO_FOOTPRINT_FRACTION = 0.6;

export interface LogoAnchor {
  /** Centre of the logo plane in the model's own (unscaled) frame. */
  position: [number, number, number];
  /** Square edge length in the model's own (unscaled) frame. */
  size: number;
  /** `node`: from the GLB's `logo` empty; `top`: from the bounding box; `block`: the code-built block. */
  source: 'node' | 'top' | 'block';
}

/**
 * Where a data-only part's logo goes on `model` (the parsed, un-parented GLB
 * scene). Matrices are taken relative to `model` itself, so the answer does
 * not depend on where the part is placed.
 *
 * 1. A node named `logo` (Blender empty; GLTFLoader keeps the authored name in
 *    userData): its position, and its X/Z scale as the edge length (a unit
 *    empty = 1 world unit). Rotation is ignored: logos always face up.
 * 2. Otherwise the top of the bounding box, centred in X/Z, sized to
 *    LOGO_FOOTPRINT_FRACTION of the box's short side.
 *
 * Returns null for an empty model (no geometry and no logo node).
 */
export function logoAnchorFromModel(model: Object3D): LogoAnchor | null {
  model.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(model.matrixWorld).invert();
  let node: Object3D | undefined;
  model.traverse((o) => {
    if (!node && o !== model && authoredName(o) === LOGO_NODE_NAME) node = o;
  });
  if (node) {
    const m = new Matrix4().multiplyMatrices(toModel, node.matrixWorld);
    const p = new Vector3();
    const s = new Vector3();
    m.decompose(p, new Quaternion(), s);
    const size = Math.min(Math.abs(s.x), Math.abs(s.z));
    return { position: [p.x, p.y + LOGO_LIFT, p.z], size: size > 0 ? size : 1, source: 'node' };
  }
  const box = new Box3();
  model.traverse((o) => {
    const geometry = (o as { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } }).geometry;
    // Outline children (hd.edges) duplicate their mesh's bounds; skip non-mesh helpers.
    if (!geometry || !(o as { isMesh?: boolean }).isMesh || (o as { isLineSegments2?: boolean }).isLineSegments2) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    const m = new Matrix4().multiplyMatrices(toModel, o.matrixWorld);
    box.union(geometry.boundingBox.clone().applyMatrix4(m));
  });
  if (box.isEmpty()) return null;
  const center = box.getCenter(new Vector3());
  const span = box.getSize(new Vector3());
  return {
    position: [center.x, box.max.y + LOGO_LIFT, center.z],
    size: Math.max(0.05, Math.min(span.x, span.z) * LOGO_FOOTPRINT_FRACTION),
    source: 'top',
  };
}

/** Logo anchor on the code-built block (no model): the top face of a w x h x height box. */
export function logoAnchorForBlock(w: number, h: number, height: number): LogoAnchor {
  return {
    position: [0, height + LOGO_LIFT, 0],
    size: Math.max(0.05, Math.min(w, h) * LOGO_FOOTPRINT_FRACTION),
    source: 'block',
  };
}

/**
 * Plane size [width, depth] that fits an image of `aspect` (width / height)
 * inside a `size` x `size` square (letterbox), so logos never stretch.
 * Non-finite or non-positive aspects fall back to square.
 */
export function fitAspect(size: number, aspect: number): [number, number] {
  if (!Number.isFinite(aspect) || aspect <= 0) return [size, size];
  return aspect >= 1 ? [size, size / aspect] : [size * aspect, size];
}
