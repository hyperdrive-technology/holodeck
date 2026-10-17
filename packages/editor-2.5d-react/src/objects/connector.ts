/**
 * Connector paths (Arcentry "line groups"): where a `connector` placement's
 * line runs, in grid coordinates. Pure; the renderer turns the result into a
 * stroke (stroke.ts).
 *
 * ENDS (`placement.link`, see IsoLink in validate.ts):
 * - `{ object, port }`: that part's port cell with its outward heading (the
 *   same port table pipes use, rotated with the part).
 * - `{ object }`: the part's centre; the drawn line is clipped where it
 *   leaves the part's (rotated) footprint, so it starts at the edge.
 * - `{ x, y }` or absent: a free point. Absent `from` = the placement's own
 *   (x, y); absent `to` = (toX, toY), else 3 cells along +x.
 * An anchor naming a placement that no longer exists resolves to null: the
 * connector draws nothing until it is re-anchored or deleted.
 *
 * ROUTE (`params.route`):
 * - `via` waypoints set: a fixed polyline from -> via... -> to (no routing).
 * - `straight`: one segment, diagonal allowed.
 * - `auto` (default): the pipe router (`planRoute`, A* around part
 *   footprints) between the two ends, ignoring the anchored parts themselves
 *   and every floor annotation. Off-grid ends or no clear route fall back to
 *   the manhattan L, like pipes.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { planRoute } from '../editor/routing';
import { rotateHeading, rotateOffset, type GridPoint, type Heading } from '../routing/grid';
import { rotatedFootprint } from '../routing/occupancy';
import type { RouteEnd } from '../routing/astar';
import { simplifyPolyline, type Vec2 } from './stroke';
import type { IsoLinkEnd } from './validate';

export type ConnectorRoute = 'auto' | 'straight';

export interface ResolvedLinkEnd {
  point: GridPoint;
  heading?: Heading;
  /** Anchored placement id, when the end is on an object. */
  objectId?: string;
  /** Footprint box to clip the line at (centre anchors only). */
  clip?: { cx: number; cy: number; w: number; h: number };
}

export interface ConnectorPath {
  /** Grid-space polyline, corners only. At least two points. */
  points: Vec2[];
  /** True when `auto` routing found no clear route and drew the manhattan L. */
  fallback: boolean;
}

/** Default far end of a free connector with no `toX/toY`: 3 cells along +x. */
export const DEFAULT_CONNECTOR_LENGTH = 3;

export function resolveLinkEnd(
  end: IsoLinkEnd | undefined,
  fallback: GridPoint,
  byId: ReadonlyMap<string, IsoPlacement>,
  registry: ContributionRegistry,
): ResolvedLinkEnd | null {
  if (!end) return { point: fallback };
  if ('x' in end) return { point: { x: end.x, y: end.y } };
  const target = byId.get(end.object);
  if (!target) return null;
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, target.object);
  const port = end.port ? def?.ports?.[end.port] : undefined;
  if (port) {
    const off = rotateOffset(port.x, port.y, target.rotation);
    return {
      point: { x: target.x + off.x, y: target.y + off.y },
      heading: rotateHeading(port.dir, target.rotation),
      objectId: target.id,
    };
  }
  const { w, h } = rotatedFootprint(def, target.rotation, target);
  return { point: { x: target.x, y: target.y }, objectId: target.id, clip: { cx: target.x, cy: target.y, w, h } };
}

/**
 * Where a segment from inside a box first crosses its border, as a fraction
 * of the segment (Liang-Barsky against the box, exit side). 0 when `a` is
 * already outside, 1 when the whole segment is inside.
 */
export function exitFraction(a: Vec2, b: Vec2, box: { cx: number; cy: number; w: number; h: number }): number {
  const x0 = box.cx - box.w / 2;
  const x1 = box.cx + box.w / 2;
  const y0 = box.cy - box.h / 2;
  const y1 = box.cy + box.h / 2;
  const inside = (p: Vec2) => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1;
  if (!inside(a)) return 0;
  let t = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx > 0) t = Math.min(t, (x1 - a[0]) / dx);
  if (dx < 0) t = Math.min(t, (x0 - a[0]) / dx);
  if (dy > 0) t = Math.min(t, (y1 - a[1]) / dy);
  if (dy < 0) t = Math.min(t, (y0 - a[1]) / dy);
  return Math.max(0, Math.min(1, t));
}

/** Trim the start of `points` where it runs inside `box` (the anchored part). */
function clipStart(points: Vec2[], box: NonNullable<ResolvedLinkEnd['clip']>): Vec2[] {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const t = exitFraction(a, b, box);
    if (t < 1) return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...points.slice(i)];
  }
  // Both ends inside the same part: nothing sensible to clip to.
  return points;
}

export function resolveConnectorPath(
  connector: IsoPlacement,
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  byId: ReadonlyMap<string, IsoPlacement> = new Map(objects.map((o) => [o.id, o])),
): ConnectorPath | null {
  const link = connector.link ?? {};
  const from = resolveLinkEnd(link.from, { x: connector.x, y: connector.y }, byId, registry);
  const to = resolveLinkEnd(
    link.to,
    {
      x: connector.toX ?? connector.x + DEFAULT_CONNECTOR_LENGTH,
      y: connector.toY ?? connector.y,
    },
    byId,
    registry,
  );
  if (!from || !to) return null;
  const route = connector.params?.route === 'straight' ? 'straight' : 'auto';
  let raw: Vec2[];
  let fallback = false;
  if (link.via?.length) {
    raw = [[from.point.x, from.point.y], ...link.via.map((p): Vec2 => [p.x, p.y]), [to.point.x, to.point.y]];
  } else if (route === 'straight') {
    raw = [[from.point.x, from.point.y], [to.point.x, to.point.y]];
  } else {
    const exclude = new Set<string>([connector.id]);
    if (from.objectId) exclude.add(from.objectId);
    if (to.objectId) exclude.add(to.objectId);
    const a: RouteEnd = from.heading ? { cell: from.point, heading: from.heading } : { cell: from.point };
    const b: RouteEnd = to.heading ? { cell: to.point, heading: to.heading } : { cell: to.point };
    // TODO(perf): planRoute builds an occupancy grid per call (one per
    // connector). Fine for tens of connectors; share one grid with
    // per-connector exclusions if scenes grow to hundreds.
    const plan = planRoute({ objects: objects as IsoPlacement[] }, registry, a, b, { exclude });
    fallback = plan.fallback;
    raw = plan.points.map((p): Vec2 => [p.x, p.y]);
    if (raw.length < 2) raw = [[from.point.x, from.point.y], [to.point.x, to.point.y]];
  }
  let points = simplifyPolyline(raw);
  if (from.clip) points = clipStart(points, from.clip);
  if (to.clip) points = clipStart([...points].reverse(), to.clip).reverse();
  points = simplifyPolyline(points);
  if (points.length < 2) return null;
  return { points, fallback };
}

/** Every connector's path, keyed by placement id (one pass for SceneGraph). Null paths are left out. */
export function resolveConnectorPaths(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  isConnector: (o: IsoPlacement) => boolean = (o) => o.object === 'connector',
): Map<string, ConnectorPath> {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out = new Map<string, ConnectorPath>();
  for (const o of objects) {
    if (!isConnector(o)) continue;
    const path = resolveConnectorPath(o, objects, registry, byId);
    if (path) out.set(o.id, path);
  }
  return out;
}

/** Grid-space bounding box of a connector's ends (for fit-to-view / sceneBounds). */
export function connectorExtent(placement: IsoPlacement): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = [placement.x, placement.toX ?? placement.x + DEFAULT_CONNECTOR_LENGTH];
  const ys = [placement.y, placement.toY ?? placement.y];
  for (const end of [placement.link?.from, placement.link?.to]) {
    if (end && 'x' in end) {
      xs.push(end.x);
      ys.push(end.y);
    }
  }
  for (const p of placement.link?.via ?? []) {
    xs.push(p.x);
    ys.push(p.y);
  }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Path of a connector rendered without SceneGraph (a bare SceneObjectView):
 * free ends only, straight or through `via`. Object anchors need the scene,
 * so such a connector draws nothing here.
 */
export function freeConnectorPath(connector: IsoPlacement): ConnectorPath | null {
  const link = connector.link ?? {};
  if ((link.from && 'object' in link.from) || (link.to && 'object' in link.to)) return null;
  const from: Vec2 = link.from ? [link.from.x, link.from.y] : [connector.x, connector.y];
  const to: Vec2 = link.to
    ? [link.to.x, link.to.y]
    : [connector.toX ?? connector.x + DEFAULT_CONNECTOR_LENGTH, connector.toY ?? connector.y];
  const points = simplifyPolyline([from, ...(link.via ?? []).map((p): Vec2 => [p.x, p.y]), to]);
  return points.length >= 2 ? { points, fallback: false } : null;
}
