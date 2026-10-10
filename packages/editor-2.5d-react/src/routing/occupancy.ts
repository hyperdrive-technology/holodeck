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
import { cellKey, quarterTurns, type GridPoint } from './grid';

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

/** Rotated footprint size of a placement. */
export function rotatedFootprint(
  def: { footprint: { w: number; h: number } } | undefined,
  rotation: number | undefined,
): { w: number; h: number } {
  const { w, h } = def?.footprint ?? { w: 1, h: 1 };
  return Math.abs(quarterTurns(rotation)) % 2 === 1 ? { w: h, h: w } : { w, h };
}

/** Integer nodes of the closed box centred on (cx, cy). */
export function footprintCells(cx: number, cy: number, w: number, h: number): GridPoint[] {
  const out: GridPoint[] = [];
  const x0 = Math.ceil(cx - w / 2 - EPS);
  const x1 = Math.floor(cx + w / 2 + EPS);
  const y0 = Math.ceil(cy - h / 2 - EPS);
  const y1 = Math.floor(cy + h / 2 + EPS);
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      out.push({ x, y });
    }
  }
  return out;
}

/** Integer nodes along an axis-aligned run (inclusive). Diagonal runs yield only their end nodes. */
export function runCells(o: Pick<IsoPlacement, 'x' | 'y' | 'toX' | 'toY'>): GridPoint[] {
  const { x, y } = o;
  const toX = o.toX ?? x;
  const toY = o.toY ?? y;
  if (x !== toX && y !== toY) {
    return [
      { x: Math.round(x), y: Math.round(y) },
      { x: Math.round(toX), y: Math.round(toY) },
    ];
  }
  const out: GridPoint[] = [];
  const x0 = Math.ceil(Math.min(x, toX) - EPS);
  const x1 = Math.floor(Math.max(x, toX) + EPS);
  const y0 = Math.ceil(Math.min(y, toY) - EPS);
  const y1 = Math.floor(Math.max(y, toY) + EPS);
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
  const blocked = new Set<number>();
  const near = new Set<number>();
  const vesselBoxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  let bounds: Bounds | null = null;

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
    if (def?.draw === 'run' || (typeof obj.toX === 'number' && typeof obj.toY === 'number')) {
      for (const c of runCells(obj)) block(c.x, c.y);
      continue;
    }
    const { w, h } = rotatedFootprint(def, obj.rotation);
    const cells = footprintCells(obj.x, obj.y, w, h);
    for (const c of cells) block(c.x, c.y);
    if (cells.length > 1 && margin > 0) {
      const xs = cells.map((c) => c.x);
      const ys = cells.map((c) => c.y);
      vesselBoxes.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
  }

  // Clearance ring: free nodes within `margin` (Chebyshev) of a vessel box.
  for (const b of vesselBoxes) {
    for (let x = b.x0 - margin; x <= b.x1 + margin; x += 1) {
      for (let y = b.y0 - margin; y <= b.y1 + margin; y += 1) {
        const key = cellKey(x, y);
        if (!blocked.has(key)) near.add(key);
      }
    }
  }

  return {
    blocked,
    near,
    bounds,
    isBlocked: (x, y) => blocked.has(cellKey(x, y)),
    isNearVessel: (x, y) => near.has(cellKey(x, y)),
  };
}
