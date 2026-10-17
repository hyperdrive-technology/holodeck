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
  /**
   * Orientation of the logo slot relative to the model, as a quaternion
   * [x, y, z, w]: the slot's local +Y is the face normal and its local -Z is
   * the image top (the `logo` empty contract). Identity for every top-face
   * slot (normal +Y, image top toward -Z); `cloud:billboard` authors its
   * empty on the sign's front face, rotated so the normal is +Z (holodeck#138).
   * Optional so anchors a host builds for the exported `LogoPlane` keep
   * working (holodeck#142): omitted = identity, a flat top-face logo.
   */
  quaternion?: [number, number, number, number];
  /**
   * Unit face normal in the model frame (slot local +Y); `position` is
   * already lifted along it. Informational; omitted = +Y (holodeck#142).
   */
  normal?: [number, number, number];
  /** `node`: from the GLB's `logo` empty; `top`: from the bounding box; `block`: the code-built block. */
  source: 'node' | 'top' | 'block';
}

/**
 * Where a data-only part's logo goes on `model` (the parsed, un-parented GLB
 * scene). Matrices are taken relative to `model` itself, so the answer does
 * not depend on where the part is placed.
 *
 * 1. A node named `logo` (Blender empty; GLTFLoader keeps the authored name in
 *    userData): its position, its X/Z scale as the edge length (a unit
 *    empty = 1 world unit) and its rotation (local +Y = face normal, local
 *    -Z = image top), so an upright sign's logo stands on its front face
 *    (holodeck#138). The lift is applied along that normal.
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
    const q = new Quaternion();
    m.decompose(p, q, s);
    q.normalize();
    const size = Math.min(Math.abs(s.x), Math.abs(s.z));
    const n = new Vector3(0, 1, 0).applyQuaternion(q).normalize();
    p.addScaledVector(n, LOGO_LIFT);
    return {
      position: [p.x, p.y, p.z],
      size: size > 0 ? size : 1,
      quaternion: [q.x, q.y, q.z, q.w],
      normal: [n.x, n.y, n.z],
      source: 'node',
    };
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
    ...FLAT,
    source: 'top',
  };
}

/** Orientation of a top-face slot: no rotation, normal +Y. */
const FLAT_QUATERNION: [number, number, number, number] = [0, 0, 0, 1];
const FLAT: Required<Pick<LogoAnchor, 'quaternion' | 'normal'>> = { quaternion: FLAT_QUATERNION, normal: [0, 1, 0] };

/**
 * Rotation of the logo plane mesh for `anchor`. three's PlaneGeometry lies in
 * its local XY plane facing +Z with the image top toward +Y; turning it by
 * -90 degrees about X makes it face the slot's +Y with the image top toward
 * the slot's -Z, then the slot's own rotation carries it onto its face.
 */
export function logoPlaneQuaternion(anchor: Pick<LogoAnchor, 'quaternion'>): Quaternion {
  const [x, y, z, w] = anchor.quaternion ?? FLAT_QUATERNION;
  const toFlat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  return new Quaternion(x, y, z, w).multiply(toFlat);
}

/** Logo anchor on the code-built block (no model): the top face of a w x h x height box. */
export function logoAnchorForBlock(w: number, h: number, height: number): LogoAnchor {
  return {
    position: [0, height + LOGO_LIFT, 0],
    size: Math.max(0.05, Math.min(w, h) * LOGO_FOOTPRINT_FRACTION),
    ...FLAT,
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
