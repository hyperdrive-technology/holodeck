import type { Object3D } from 'three';
import { findAnimNodes } from '../../assets/process';

/**
 * The Blender vessels (fermenter, mash tun, kettle, brite tank) have an opaque
 * shell and show their level through a narrow pie-slice "sight window" on the
 * liquid mesh, built to face the iso camera when the part is unrotated (see
 * holodeck/blender/brewery.py). A placement rotated by `rotationY` (say a pi
 * turn so the inlet nozzle faces upstream) would carry the window to the far
 * side of the vessel, where the level can no longer be read. The vessels are
 * axisymmetric, so counter-rotating only the `anim.liquid` pivot puts the
 * window back without moving nozzles, legs or the manway.
 *
 * Returns true when the part has a liquid pivot. The fill animator only
 * writes `scale.y`, so it does not fight this rotation.
 */
export function faceLiquidWindow(root: Object3D, rotationY: number): boolean {
  const liquid = findAnimNodes(root)['anim.liquid'];
  if (!liquid) return false;
  liquid.rotation.y = -rotationY;
  return true;
}
