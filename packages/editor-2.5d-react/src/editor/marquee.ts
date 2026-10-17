/**
 * Marquee (rubber-band) selection, lane E3. Pure: the caller supplies a
 * grid -> screen projection (EditorLayer builds one from the R3F camera), so
 * this works in any view pose and is unit-testable without WebGL.
 *
 * A placement is hit when the centre of its grid box (`objectBounds`: the
 * footprint, or a pipe's / connector's span) projects inside the rectangle.
 * Hidden placements are skipped by the caller (the reducer also refuses
 * them); tiny rectangles (a shift-click on empty floor) select nothing.
 */
import type { ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import { objectBounds } from './arrange';

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Below this size (px) in both axes a marquee is treated as a click. */
export const MARQUEE_MIN_PX = 4;

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): ScreenRect {
  return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

export function isClickSized(rect: ScreenRect): boolean {
  return rect.right - rect.left < MARQUEE_MIN_PX && rect.bottom - rect.top < MARQUEE_MIN_PX;
}

export function marqueeHits(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  /** Grid (x, y) on the floor -> screen px in the same space as `rect`; null when off-screen / behind. */
  toScreen: (gx: number, gy: number) => { x: number; y: number } | null,
  rect: ScreenRect,
): string[] {
  if (isClickSized(rect)) return [];
  const out: string[] = [];
  for (const o of objects) {
    const b = objectBounds(o, registry);
    const cx = Number.isFinite(b.minX) ? (b.minX + b.maxX) / 2 : o.x;
    const cy = Number.isFinite(b.minY) ? (b.minY + b.maxY) / 2 : o.y;
    const p = toScreen(cx, cy);
    if (p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) out.push(o.id);
  }
  return out;
}
