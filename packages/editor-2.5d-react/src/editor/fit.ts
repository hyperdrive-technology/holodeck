import type { Vector3Tuple } from 'three';
import { gridToWorld } from '../iso/grid';
import { cameraBasis, clampZoom } from '../iso/pan';
import type { IsoPose } from '../iso/pose';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { partScale } from '../registry/part-scale';
import type { IsoPartDefinition } from '../registry/types';
import { isRunPlacement } from '../registry/geometry';

/** Same bounds the wheel / pinch / toolbar zoom clamps to (defined with the pan math). */
export { MAX_ZOOM, MIN_ZOOM } from '../iso/pan';

export interface WorldBox {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

/** Tallest thing we assume for a placement with no explicit height (tank-like parts). */
const DEFAULT_PART_HEIGHT = 3.2;
/** Fixed rough heights for the flat / low built-ins. */
const FLAT_HEIGHT: Record<string, number> = { area: 0, label: 0.1, pipe: 0.3, elbow: 0.3, 'end-cap': 0.3, valve: 1 };

/** Rough vertical extent of one placement; only used to frame the camera, not to draw. */
function placementHeight(p: IsoPlacement, def: IsoPartDefinition | undefined): number {
  if (p.height !== undefined && p.object !== 'area') return p.height;
  const flat = FLAT_HEIGHT[p.object];
  if (flat !== undefined) return flat;
  return (def?.defaults?.height ?? DEFAULT_PART_HEIGHT) * (def?.model ? partScale(def) : 1);
}

/**
 * World-space box around everything in the scene: placement cells (footprint,
 * rotated by 90 degree steps), both pipe ends, area pads and an approximate
 * height. Empty scene -> a unit box at the origin.
 */
export function sceneWorldBox(
  scene: Pick<IsoSceneFile, 'objects'>,
  getPart: (id: string) => IsoPartDefinition | undefined = () => undefined,
): WorldBox {
  const min: Vector3Tuple = [Infinity, 0, Infinity];
  const max: Vector3Tuple = [-Infinity, 0, -Infinity];
  const add = (gx: number, gy: number, halfW: number, halfH: number) => {
    const [wx, , wz] = gridToWorld(gx, gy);
    min[0] = Math.min(min[0], wx - halfW);
    max[0] = Math.max(max[0], wx + halfW);
    min[2] = Math.min(min[2], wz - halfH);
    max[2] = Math.max(max[2], wz + halfH);
  };
  for (const p of scene.objects) {
    const def = getPart(p.object);
    if (p.object === 'area') {
      add(p.x, p.y, (p.width ?? 1) / 2, (p.height ?? 1) / 2);
    } else {
      let w = def?.footprint.w ?? 1;
      let h = def?.footprint.h ?? 1;
      if (Math.abs(Math.sin(p.rotation ?? 0)) > 0.7) [w, h] = [h, w];
      add(p.x, p.y, w / 2, h / 2);
      if (isRunPlacement(p, def) && typeof p.toX === 'number' && typeof p.toY === 'number') {
        add(p.toX, p.toY, 0.15, 0.15);
      }
    }
    const extent = def?.extent?.(p);
    if (extent) {
      add(extent.minX, extent.minY, 0, 0);
      add(extent.maxX, extent.maxY, 0, 0);
    }
    max[1] = Math.max(max[1], placementHeight(p, def));
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [1, 1, 1] };
  max[1] = Math.max(max[1], 0.1);
  return { min, max };
}

export interface FitOptions {
  /** Fraction of each viewport dimension kept empty on every side. */
  margin?: number;
}

/**
 * Zoom and look-at that frame `box` in a `viewW` x `viewH` viewport for the
 * orthographic camera at `pose`. Ortho zoom is pixels per world unit, so the
 * zoom is the viewport size over the box's projected size on the camera's
 * right/up axes. The look-at is the box centre (a box projects symmetrically
 * about its centre). Zoom is clamped to MIN_ZOOM..MAX_ZOOM.
 */
export function fitView(
  box: WorldBox,
  pose: IsoPose,
  viewW: number,
  viewH: number,
  { margin = 0.06 }: FitOptions = {},
): { zoom: number; target: Vector3Tuple } {
  const center: Vector3Tuple = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  // Camera axes; shared with the pan math so fit and pan agree on screen-right / screen-up.
  const { right: r, up: u } = cameraBasis(pose);
  let maxR = 0;
  let maxU = 0;
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) {
        const d: Vector3Tuple = [x - center[0], y - center[1], z - center[2]];
        maxR = Math.max(maxR, Math.abs(d[0] * r[0] + d[1] * r[1] + d[2] * r[2]));
        maxU = Math.max(maxU, Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]));
      }
    }
  }
  const usable = 1 - 2 * margin;
  const zoomX = maxR > 0 ? (viewW * usable) / (2 * maxR) : Infinity;
  const zoomY = maxU > 0 ? (viewH * usable) / (2 * maxU) : Infinity;
  const raw = Math.min(zoomX, zoomY);
  const zoom = Number.isFinite(raw) ? clampZoom(raw) : 20;
  return { zoom, target: center };
}
