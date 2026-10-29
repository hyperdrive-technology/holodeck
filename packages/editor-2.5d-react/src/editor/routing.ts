import type { ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { routePipe, type RouteEnd, type RouteOptions } from '../routing/astar';
import { footprint } from '../routing/footprint';
import { buildOccupancy } from '../routing/occupancy';
import { collapsePath, pathToPlacements, type CollapsedPath, type NextId } from '../routing/to-placements';
import { sameCell } from './snap';
import { MAX_GRID_COORD, type GridPoint, type Heading } from '../routing/grid';

export type { GridPoint };
export { footprint };

/**
 * Legacy router and the fallback when `routePipe` finds nothing. Axis-aligned pipe run. Diagonal clicks become an L (horizontal first)
 * plus an elbow at the corner — process pipes stay on the grid axes.
 */
export function manhattanRoute(from: GridPoint, to: GridPoint): {
  pipes: Array<{ x: number; y: number; toX: number; toY: number }>;
  elbow: GridPoint | null;
} {
  if (sameCell(from, to)) {
    return { pipes: [], elbow: null };
  }
  if (from.x === to.x || from.y === to.y) {
    return { pipes: [{ x: from.x, y: from.y, toX: to.x, toY: to.y }], elbow: null };
  }
  const corner = { x: to.x, y: from.y };
  return {
    pipes: [
      { x: from.x, y: from.y, toX: corner.x, toY: corner.y },
      { x: corner.x, y: corner.y, toX: to.x, toY: to.y },
    ],
    elbow: corner,
  };
}

export interface PlannedRoute extends CollapsedPath {
  /** Cells of the A* path (or the L's vertices on fallback). */
  points: GridPoint[];
  /**
   * True when the route is the plain manhattan L: either no clear route exists
   * (`blocked` or incomplete occupancy), or the endpoints are off-grid so the
   * router was not asked.
   */
  fallback: boolean;
  /** A* found nothing, endpoints were invalid or obstacles were skipped (drives the red ghost and "No clear route" notice). */
  noRoute: boolean;
}

/**
 * One route, shared by the live ghost, the commit and reroute so they can
 * never disagree. A* between `from` and `to` against the scene's obstacles
 * (minus `exclude`); manhattan L when A* returns null. Half-cell clicks
 * (`snapHalf`) are not on a pipe node, so they skip the router.
 */
export function planRoute(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  from: RouteEnd,
  to: RouteEnd,
  opts: {
    exclude?: ReadonlySet<string>;
    route?: RouteOptions;
    /**
     * Exact off-grid end points joined to `from.cell` / `to.cell` by a short
     * straight (see `entryNode`). The A* path is extended to them, so the
     * pipe still ends exactly where a hand-authored brewery pipe meets its
     * vessel wall (16.8, not the 17 node). Used by follow-on-drag.
     */
    stubs?: { start?: GridPoint; end?: GridPoint };
  } = {},
): PlannedRoute {
  // The fallback also becomes persisted geometry, including for half-cell
  // clicks. Invalid endpoints must fail without producing an out-of-bounds L.
  if (![from.cell.x, from.cell.y, to.cell.x, to.cell.y]
    .every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_GRID_COORD)) {
    return { ...collapsePath([]), points: [], fallback: true, noRoute: true };
  }
  const onGrid = [from.cell, to.cell].every((c) => Number.isInteger(c.x) && Number.isInteger(c.y));
  const occ = buildOccupancy(scene, registry, { exclude: opts.exclude });
  if (onGrid) {
    const path = routePipe(from, to, occ, opts.route);
    if (path) {
      const points = withStubs(path.cells, opts.stubs);
      return { ...collapsePath(points), points, fallback: false, noRoute: false };
    }
  }
  const { pipes, elbow } = manhattanRoute(from.cell, to.cell);
  const corners = pipes.length === 0 ? [] : elbow ? [from.cell, elbow, to.cell] : [from.cell, to.cell];
  const points = corners.length === 0 ? [] : withStubs(corners, opts.stubs);
  return { ...collapsePath(points), points, fallback: true, noRoute: onGrid || Boolean(occ.skipped?.length) };
}

function withStubs(points: readonly GridPoint[], stubs: { start?: GridPoint; end?: GridPoint } | undefined): GridPoint[] {
  if (!stubs) return [...points];
  const out = [...points];
  if (stubs.start && !(out[0] && sameCell(out[0], stubs.start))) out.unshift(stubs.start);
  if (stubs.end && !(out[out.length - 1] && sameCell(out[out.length - 1]!, stubs.end))) out.push(stubs.end);
  return out;
}

/** Below this, a coordinate counts as on the integer grid (2-decimal authored scenes). */
const NODE_EPS = 1e-6;

/**
 * Grid node where a route from exact point `p`, leaving along `heading`,
 * can start: `p` itself when it is a node, else the next node along the
 * heading (an end at 16.8 leaving west starts the search at 16). Null when
 * the cross-axis coordinate is off-grid (no straight stub reaches a node).
 */
export function entryNode(p: GridPoint, heading: Heading | undefined): GridPoint | null {
  const isNode = (v: number) => Math.abs(v - Math.round(v)) < NODE_EPS;
  if (isNode(p.x) && isNode(p.y)) return { x: Math.round(p.x), y: Math.round(p.y) };
  if (!heading) return null;
  const horizontal = heading === 'e' || heading === 'w';
  const across = horizontal ? p.y : p.x;
  if (!isNode(across)) return null;
  const along = horizontal ? p.x : p.y;
  const step = heading === 'e' || heading === 's' ? Math.ceil(along - NODE_EPS) : Math.floor(along + NODE_EPS);
  return horizontal ? { x: step, y: Math.round(across) } : { x: Math.round(across), y: step };
}

/**
 * Placements for a click-click pipe: routed around obstacles when possible,
 * else the manhattan L. `fallback` surfaces which one the caller got.
 * `reservedObjects` separates retained IDs from the obstacle scene (e.g.
 * hosted parts excluded while rerouting); defaults to all scene objects.
 */
export function routeToPlacements(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  from: RouteEnd,
  to: RouteEnd,
  nextId: NextId,
  opts: {
    exclude?: ReadonlySet<string>;
    band?: string;
    route?: RouteOptions;
    reservedObjects?: readonly IsoPlacement[];
    stubs?: { start?: GridPoint; end?: GridPoint };
  } = {},
): { placements: IsoPlacement[]; fallback: boolean; noRoute: boolean } {
  const plan = planRoute(scene, registry, from, to, opts);
  return {
    placements: pathToPlacements(plan.points, opts.reservedObjects ?? scene.objects, nextId, opts.band),
    fallback: plan.fallback,
    noRoute: plan.noRoute,
  };
}
