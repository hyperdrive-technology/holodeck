import type { ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { routePipe, type RouteEnd, type RouteOptions } from '../routing/astar';
import { footprint } from '../routing/footprint';
import { buildOccupancy } from '../routing/occupancy';
import { collapsePath, pathToPlacements, type CollapsedPath, type NextId } from '../routing/to-placements';
import { sameCell } from './snap';
import { MAX_GRID_COORD, type GridPoint } from '../routing/grid';

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
  opts: { exclude?: ReadonlySet<string>; route?: RouteOptions } = {},
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
      return { ...collapsePath(path.cells), points: path.cells, fallback: false, noRoute: false };
    }
  }
  const { pipes, elbow } = manhattanRoute(from.cell, to.cell);
  const points = pipes.length === 0 ? [] : elbow ? [from.cell, elbow, to.cell] : [from.cell, to.cell];
  return { ...collapsePath(points), points, fallback: true, noRoute: onGrid || occ.skipped.length > 0 };
}

/**
 * Placements for a click-click pipe: routed around obstacles when possible,
 * else the manhattan L. `fallback` surfaces which one the caller got.
 */
export function routeToPlacements(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  from: RouteEnd,
  to: RouteEnd,
  nextId: NextId,
  opts: { exclude?: ReadonlySet<string>; band?: string; route?: RouteOptions } = {},
): { placements: IsoPlacement[]; fallback: boolean; noRoute: boolean } {
  const plan = planRoute(scene, registry, from, to, opts);
  return {
    placements: pathToPlacements(plan.points, scene.objects, nextId, opts.band),
    fallback: plan.fallback,
    noRoute: plan.noRoute,
  };
}
