/**
 * Shared grid vocabulary for the pipe router. Pure: no React, no three.
 *
 * Compass convention (matches the scene file, where grid +X / +Y are the two
 * screen-down axes): n = -y, e = +x, s = +y, w = -x. A "cell" is an integer
 * grid node; pipes run node to node, so a pipe vertex is a cell.
 */

export interface GridPoint {
  x: number;
  y: number;
}

export type Heading = 'n' | 'e' | 's' | 'w';

/** Index order is the router's deterministic expansion order. */
export const HEADINGS: readonly Heading[] = ['n', 'e', 's', 'w'];

export const HEADING_VECTOR: Record<Heading, GridPoint> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

export function oppositeHeading(h: Heading): Heading {
  return HEADINGS[(HEADINGS.indexOf(h) + 2) % 4]!;
}

/**
 * Rotate a heading by a part's yaw. `rotation` is yaw radians about +Y
 * (three.js), which maps grid (x, y) -> (x cos + y sin, -x sin + y cos), the
 * same convention `mouthAfterYaw` uses in pipe-math. +90 deg turns east into
 * north, i.e. n <- e <- s <- w, so each quarter turn steps back one index.
 */
export function rotateHeading(h: Heading, rotation = 0): Heading {
  return HEADINGS[(((HEADINGS.indexOf(h) - quarterTurns(rotation)) % 4) + 4) % 4]!;
}

/** Yaw radians -> whole quarter turns (non-right-angle yaws round to the nearest). */
export function quarterTurns(rotation = 0): number {
  return Math.round(rotation / (Math.PI / 2));
}

/** Rotate a part-local offset by the part's yaw (same convention as `rotateHeading`). */
export function rotateOffset(dx: number, dy: number, rotation = 0): GridPoint {
  const t = ((quarterTurns(rotation) % 4) + 4) % 4;
  // `+ 0` normalises -0 so callers can compare with toEqual / ===.
  switch (t) {
    case 1:
      return { x: dy + 0, y: -dx + 0 };
    case 2:
      return { x: -dx + 0, y: -dy + 0 };
    case 3:
      return { x: -dy + 0, y: dx + 0 };
    default:
      return { x: dx, y: dy };
  }
}

/** Numeric cell key (cheaper than string keys in the A* hot loop). Valid for |x|, |y| < 32768. */
const KEY_OFFSET = 32768;
/** Symmetric integer range where cellKey is collision-free. */
export const MAX_CELL_COORD = KEY_OFFSET - 1;

/**
 * Largest |coordinate| a scene may use, in grid cells. Half of `cellKey`'s
 * range. Placement origins and run endpoints stay inside this limit;
 * footprint nodes may extend to MAX_CELL_COORD. Clearance and search margins
 * are clipped to that safe key range. Geometry enumeration is also capped
 * (holodeck#8: an `Infinity` coordinate made `footprintCells` loop forever).
 */
export const MAX_GRID_COORD = 16_384;
export function cellKey(x: number, y: number): number {
  return (x + KEY_OFFSET) * 65536 + (y + KEY_OFFSET);
}
