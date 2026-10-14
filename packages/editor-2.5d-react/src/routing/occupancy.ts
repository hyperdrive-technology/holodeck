/**
 * Occupancy grid for the pipe router: which grid nodes are blocked, and which
 * are merely close to a vessel (cost, not block). Pure.
 *
 * FOOTPRINT ANCHORING (read from SceneGraph / builtin.tsx `TankPart`, which
 * positions a part at `gridToWorld(x, y)`, and from `EditorLayer`'s `Ghost`,
 * which centres a w x h plane there): a placement's (x, y) is the CENTRE of
 * its footprint, not a corner. A 2x2 tank at (0,0) therefore covers the
 * square [-1,1] x [-1,1]; pipes attach "at the edge (+-1 cell)" (scene.ts
 * header). Pipes run node to node, so the router blocks every grid NODE in the
 * CLOSED box [x-w/2, x+w/2] x [y-h/2, y+h/2]. For the 2x2 tank that is a 3x3
 * block of nodes, edge nodes included: a pipe may not graze the vessel wall
 * (the tube is 0.4 cells across). The edge nodes are still reachable as
 * route ENDS (ports sit on them), because `routePipe` exempts its exact
 * start/end cells. A 1x1 part blocks just its own node.
 *
 * ROTATION: `placement.rotation` is yaw radians; odd quarter turns (90/270)
 * swap w and h. Other angles round to the nearest quarter turn.
 *
 * NOT OBSTACLES: `area` and `label` are floor annotations.
 *
 * PIPES: every node on an existing run (x,y -> toX,toY) is blocked, ends
 * included, so a new pipe cannot overlap or cross one. The router lets a route
 * start or finish on such a node (joining a pipe end).
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { isRunPlacement } from '../registry/geometry';
import { cellKey, MAX_CELL_COORD, MAX_GRID_COORD, quarterTurns, type GridPoint } from './grid';

/** Floor annotations: drawn on the ground, pipes may run across them. */
export const NON_OBSTACLE_PARTS: ReadonlySet<string> = new Set(['area', 'label']);

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Occupancy {
  /** Keys (`cellKey`) of nodes a pipe cannot occupy. */
  readonly blocked: ReadonlySet<number>;
  /** Keys of free nodes within the clearance ring of a vessel (routing cost). */
  readonly near: ReadonlySet<number>;
  /** Bounding box of every blocked node; null when the grid is empty. */
  readonly bounds: Bounds | null;
  /**
   * Ids of placements left out because their geometry is non-finite, beyond
   * the safe geometry limits or bigger than `MAX_FOOTPRINT_CELLS` (see
   * `GeometryRangeError`). The parser validates effective footprints too, but
   * live edits or changed part definitions can still produce invalid geometry.
   * Routing must fail whenever this list is nonempty. Optional for custom
   * occupancy providers; buildOccupancy always populates it.
   */
  readonly skipped?: readonly string[];
  isBlocked(x: number, y: number): boolean;
  isNearVessel(x: number, y: number): boolean;
}

export interface OccupancyOptions {
  /** Placement ids to leave out (e.g. the run being rerouted). */
  exclude?: ReadonlySet<string>;
  /**
   * Clearance ring width in cells around "vessels" (parts bigger than 1x1).
   * Cost only, never a block. Default 1.
   */
  margin?: number;
}

const EPS = 1e-6;

/** Most nodes one footprint may cover (256 x 256); anything larger is treated as bad input. */
export const MAX_FOOTPRINT_CELLS = 65_536;

/**
 * Thrown by `footprintCells` / `runCells` for geometry they refuse to
 * enumerate: non-finite, outside the origin/endpoint or safe cell-key limits,
 * or (footprints) more than `MAX_FOOTPRINT_CELLS` nodes. Without it,
 * `Infinity + 1 === Infinity` kept the cell loops running forever (holodeck#8).
 */
export class GeometryRangeError extends RangeError {
  override name = 'GeometryRangeError';
}

/** Inclusive integer node range covering [lo, hi]; throws GeometryRangeError when unbounded. */
function nodeRange(lo: number, hi: number, what: string, limit = MAX_GRID_COORD): [number, number] {
  const a = Math.ceil(lo - EPS);
  const b = Math.floor(hi + EPS);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > limit || Math.abs(b) > limit) {
    throw new GeometryRangeError(`${what} [${lo}, ${hi}] is outside +-${limit} grid cells`);
  }
  return [a, b];
}

/** Whether `cell` lies in the closed box centred on (cx, cy). O(1), never enumerates; false for NaN. */
export function footprintContains(cx: number, cy: number, w: number, h: number, cell: GridPoint): boolean {
  return (
    cell.x >= cx - w / 2 - EPS &&
    cell.x <= cx + w / 2 + EPS &&
    cell.y >= cy - h / 2 - EPS &&
    cell.y <= cy + h / 2 + EPS
  );
}

/** Rotated footprint size of a placement. */
export function rotatedFootprint(
  def: Pick<IsoPartDefinition, 'footprint' | 'footprintOf'> | undefined,
  rotation: number | undefined,
  /** When given, a part that sizes itself from a param (`footprintOf`, e.g. a vessel radius) uses that size. */
  placement?: IsoPlacement,
): { w: number; h: number } {
  const { w, h } = (placement && def?.footprintOf?.(placement)) ?? def?.footprint ?? { w: 1, h: 1 };
  return Math.abs(quarterTurns(rotation)) % 2 === 1 ? { w: h, h: w } : { w, h };
}

/** Validate an effective footprint without allocating its nodes (also used by the parser). */
export function footprintBounds(cx: number, cy: number, w: number, h: number): Bounds {
  if (![cx, cy].every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_GRID_COORD)) {
    throw new GeometryRangeError(`footprint centre must be finite and within +-${MAX_GRID_COORD}`);
  }
  if (![w, h].every((v) => Number.isFinite(v) && v >= 0)) {
    throw new GeometryRangeError(`footprint size ${w}x${h} must be finite and nonnegative`);
  }
  // A boundary-centred tank still occupies its outer nodes beyond the scene
  // coordinate limit. Reject only at cellKey's safe limit, not at its origin limit.
  const [x0, x1] = nodeRange(cx - w / 2, cx + w / 2, 'footprint x', MAX_CELL_COORD);
  const [y0, y1] = nodeRange(cy - h / 2, cy + h / 2, 'footprint y', MAX_CELL_COORD);
  const count = Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1);
  if (count > MAX_FOOTPRINT_CELLS) {
    throw new GeometryRangeError(`footprint ${w}x${h} covers ${count} nodes (max ${MAX_FOOTPRINT_CELLS})`);
  }
  return { minX: x0, maxX: x1, minY: y0, maxY: y1 };
}

/** Integer nodes of the closed box centred on (cx, cy). Throws GeometryRangeError on unbounded input. */
export function footprintCells(cx: number, cy: number, w: number, h: number): GridPoint[] {
  const out: GridPoint[] = [];
  const { minX: x0, maxX: x1, minY: y0, maxY: y1 } = footprintBounds(cx, cy, w, h);
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Integer nodes along an axis-aligned run (inclusive). Diagonal runs yield only their end nodes.
 * Throws GeometryRangeError on unbounded input. A bounded run is at most 2 * MAX_GRID_COORD + 1 nodes.
 */
export function runCells(o: Pick<IsoPlacement, 'x' | 'y' | 'toX' | 'toY'>): GridPoint[] {
  const { x, y } = o;
  const toX = o.toX ?? x;
  const toY = o.toY ?? y;
  const [x0, x1] = nodeRange(Math.min(x, toX), Math.max(x, toX), 'run x');
  const [y0, y1] = nodeRange(Math.min(y, toY), Math.max(y, toY), 'run y');
  if (x !== toX && y !== toY) {
    return [
      { x: Math.round(x), y: Math.round(y) },
      { x: Math.round(toX), y: Math.round(toY) },
    ];
  }
  const out: GridPoint[] = [];
  for (let cx = x0; cx <= x1; cx += 1) {
    for (let cy = y0; cy <= y1; cy += 1) {
      out.push({ x: cx, y: cy });
    }
  }
  return out;
}

export function buildOccupancy(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  opts: OccupancyOptions = {},
): Occupancy {
  const exclude = opts.exclude;
  const margin = opts.margin ?? 1;
  if (!Number.isInteger(margin) || margin < 0 || margin > MAX_GRID_COORD) {
    throw new RangeError(`occupancy margin must be an integer in [0, ${MAX_GRID_COORD}], got ${margin}`);
  }
  const blocked = new Set<number>();
  const near = new Set<number>();
  const vesselBoxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  let bounds: Bounds | null = null;
  const skipped: string[] = [];

  const block = (x: number, y: number) => {
    blocked.add(cellKey(x, y));
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, x),
          minY: Math.min(bounds.minY, y),
          maxX: Math.max(bounds.maxX, x),
          maxY: Math.max(bounds.maxY, y),
        }
      : { minX: x, minY: y, maxX: x, maxY: y };
  };

  for (const obj of scene.objects) {
    if (exclude?.has(obj.id) || NON_OBSTACLE_PARTS.has(obj.object)) {
      continue;
    }
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, obj.object);
    const isRun = isRunPlacement(obj, def);
    let cells: GridPoint[];
    try {
      if (isRun) {
        cells = runCells(obj);
      } else {
        const { w, h } = rotatedFootprint(def, obj.rotation, obj);
        cells = footprintCells(obj.x, obj.y, w, h);
      }
    } catch (err) {
      // Bad geometry must not hang or crash the live route ghost: leave the
      // placement out and report it. Anything else is a real bug: rethrow.
      if (!(err instanceof GeometryRangeError)) throw err;
      skipped.push(obj.id);
      continue;
    }
    if (isRun) {
      for (const c of cells) block(c.x, c.y);
      continue;
    }
    for (const c of cells) block(c.x, c.y);
    if (cells.length > 1 && margin > 0) {
      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      vesselBoxes.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
  }

  // Clearance ring: free nodes within `margin` (Chebyshev) of a vessel box.
  for (const b of vesselBoxes) {
    for (let x = Math.max(-MAX_CELL_COORD, b.x0 - margin); x <= Math.min(MAX_CELL_COORD, b.x1 + margin); x += 1) {
      for (let y = Math.max(-MAX_CELL_COORD, b.y0 - margin); y <= Math.min(MAX_CELL_COORD, b.y1 + margin); y += 1) {
        const key = cellKey(x, y);
        if (!blocked.has(key)) near.add(key);
      }
    }
  }

  return {
    blocked,
    near,
    bounds,
    skipped,
    isBlocked: (x, y) => blocked.has(cellKey(x, y)),
    isNearVessel: (x, y) => near.has(cellKey(x, y)),
  };
}
