/**
 * Connector drawing and re-anchoring in the editor (holodeck#91). Pure.
 *
 * `anchorAt` turns a clicked / dropped grid cell into a link end: the part
 * under the cell (its nearest port when one is within PORT_SNAP cells, else
 * its centre), or a free point when the cell is empty. Hit-testing is done on
 * footprints in grid space rather than on R3F meshes so the same rule serves
 * clicks, drags released over an object, and tests.
 */
import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { resolveConnectorPath, resolveLinkEnd, DEFAULT_CONNECTOR_LENGTH } from '../objects/connector';
import { MAX_LINK_VIA, type IsoLinkEnd } from '../objects/validate';
import type { IsoPartDefinition } from '../registry/types';
import { placementPorts } from '../registry/params';
import { isRunPlacement } from '../registry/geometry';
import { rotateOffset, type GridPoint } from '../routing/grid';
import { footprintContains, isFloorPart, rotatedFootprint } from '../routing/occupancy';
import { isPlacementHidden } from './layers';

/** A click within this many cells of a port anchors to the port rather than the part's centre. */
export const PORT_SNAP = 1;

/**
 * The placement a connector end should attach to at `cell`: solid parts win
 * over floor annotations (an area under a tank), then the smallest footprint
 * (a label inside an area), then the later placement (drawn on top). Runs
 * (pipes), connectors and hidden placements are never anchors.
 */
export function anchorTargetAt(
  scene: Pick<IsoSceneFile, 'objects' | 'layers'>,
  registry: ContributionRegistry,
  cell: GridPoint,
  exclude: ReadonlySet<string> = new Set(),
): IsoPlacement | null {
  let best: { o: IsoPlacement; floor: boolean; area: number; index: number } | null = null;
  scene.objects.forEach((o, index) => {
    if (exclude.has(o.id) || isPlacementHidden(scene, o)) return;
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object);
    if (def?.connector || isRunPlacement(o, def)) return;
    const { w, h } = rotatedFootprint(def, o.rotation, o);
    // Areas size themselves from width / height rather than the footprint.
    const fw = typeof o.width === 'number' && o.object === 'area' ? o.width : w;
    const fh = typeof o.height === 'number' && o.object === 'area' ? o.height : h;
    if (!footprintContains(o.x, o.y, fw, fh, cell)) return;
    const floor = isFloorPart(o.object, def);
    const area = fw * fh;
    const better =
      !best ||
      (best.floor && !floor) ||
      (best.floor === floor && (area < best.area || (area === best.area && index > best.index)));
    if (better) best = { o, floor, area, index };
  });
  return best ? (best as { o: IsoPlacement }).o : null;
}

/** Link end for a click at `cell`: a part (port or centre) or the free cell. */
export function anchorAt(
  scene: Pick<IsoSceneFile, 'objects' | 'layers'>,
  registry: ContributionRegistry,
  cell: GridPoint,
  exclude?: ReadonlySet<string>,
): IsoLinkEnd {
  const target = anchorTargetAt(scene, registry, cell, exclude);
  if (!target) return { x: cell.x, y: cell.y };
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, target.object);
  let port: string | undefined;
  let bestDist = Infinity;
  for (const [name, p] of Object.entries(placementPorts(def, target))) {
    const off = rotateOffset(p.x, p.y, target.rotation);
    const d = Math.hypot(target.x + off.x - cell.x, target.y + off.y - cell.y);
    if (d <= PORT_SNAP && d < bestDist) {
      bestDist = d;
      port = name;
    }
  }
  return port ? { object: target.id, port } : { object: target.id };
}

export function sameLinkEnd(a: IsoLinkEnd | undefined, b: IsoLinkEnd | undefined): boolean {
  if (!a || !b) return a === b;
  if ('object' in a) return 'object' in b && a.object === b.object && a.port === b.port;
  return 'x' in b && a.x === b.x && a.y === b.y;
}

/** Where an end draws, or null for an anchor whose placement is gone. */
export function linkEndPoint(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  end: IsoLinkEnd,
): GridPoint | null {
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  return resolveLinkEnd(end, { x: 0, y: 0 }, byId, registry)?.point ?? null;
}

/** Where a connector's `from` / `to` end currently draws (object anchors resolved, free ends defaulted). */
export function connectorEndPoint(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  connector: IsoPlacement,
  end: 'from' | 'to',
): GridPoint | null {
  const fallback = end === 'from'
    ? { x: connector.x, y: connector.y }
    : { x: connector.toX ?? connector.x + DEFAULT_CONNECTOR_LENGTH, y: connector.toY ?? connector.y };
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  return resolveLinkEnd(connector.link?.[end], fallback, byId, registry)?.point ?? null;
}

/**
 * A connector placement from `from` to `to` over the part's `defaults`
 * (`base`, e.g. from `stamp`). Object anchors go in `link`; free ends are
 * the placement's own x / y and toX / toY, so a fully free line has no `link`.
 */
export function buildConnector(
  base: IsoPlacement,
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  from: IsoLinkEnd,
  to: IsoLinkEnd,
): IsoPlacement | null {
  const a = linkEndPoint(scene, registry, from);
  const b = linkEndPoint(scene, registry, to);
  if (!a || !b) return null;
  const { link: _link, ...rest } = base;
  const next: IsoPlacement = { ...rest, x: a.x, y: a.y, toX: b.x, toY: b.y };
  const link: NonNullable<IsoPlacement['link']> = {};
  if ('object' in from) link.from = from;
  if ('object' in to) link.to = to;
  if (link.from || link.to) next.link = link;
  return next;
}

/**
 * `connector` with its `end` moved to `anchor`. Free ends write the
 * placement's x / y (from) or toX / toY (to) so the halo and moves follow
 * them; object anchors write `link[end]`. Waypoints are kept.
 */
export function reanchor(
  connector: IsoPlacement,
  end: 'from' | 'to',
  anchor: IsoLinkEnd,
): IsoPlacement {
  const link: NonNullable<IsoPlacement['link']> = { ...connector.link };
  const next: IsoPlacement = { ...connector };
  if ('object' in anchor) {
    link[end] = anchor;
  } else {
    delete link[end];
    if (end === 'from') {
      next.x = anchor.x;
      next.y = anchor.y;
    } else {
      next.toX = anchor.x;
      next.toY = anchor.y;
    }
  }
  if (link.from || link.to || link.via) next.link = link;
  else delete next.link;
  return next;
}

/*
 * Waypoints (`link.via`, holodeck#112). A connector with waypoints is a fixed
 * polyline from -> via... -> to (no routing), so the first inserted waypoint
 * also "pins" an auto-routed line. Index i of `via` sits between logical
 * segment i (ending at it) and segment i + 1 (starting at it).
 */

type Via = NonNullable<NonNullable<IsoPlacement['link']>['via']>;

function withVia(connector: IsoPlacement, via: Via): IsoPlacement {
  const link: NonNullable<IsoPlacement['link']> = { ...connector.link };
  if (via.length) link.via = via;
  else delete link.via;
  const next: IsoPlacement = { ...connector };
  if (link.from || link.to || link.via) next.link = link;
  else delete next.link;
  return next;
}

/**
 * Insert a waypoint before `via[index]` (index = via.length appends).
 * Out-of-range, or already at MAX_LINK_VIA waypoints: the same object.
 */
export function insertWaypoint(connector: IsoPlacement, index: number, point: GridPoint): IsoPlacement {
  const via = connector.link?.via ?? [];
  if (!canInsertWaypoint(connector)) return connector;
  if (!Number.isInteger(index) || index < 0 || index > via.length) return connector;
  return withVia(connector, [...via.slice(0, index), { x: point.x, y: point.y }, ...via.slice(index)]);
}

export function moveWaypoint(connector: IsoPlacement, index: number, point: GridPoint): IsoPlacement {
  const via = connector.link?.via ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= via.length) return connector;
  return withVia(connector, via.map((p, i) => (i === index ? { x: point.x, y: point.y } : p)));
}

/** Remove `via[index]`; the last one removed drops `via` (and an empty `link`). */
export function removeWaypoint(connector: IsoPlacement, index: number): IsoPlacement {
  const via = connector.link?.via ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= via.length) return connector;
  return withVia(connector, via.filter((_, i) => i !== index));
}

/** Room for one more waypoint: scene validation rejects more than MAX_LINK_VIA (holodeck#126). */
export function canInsertWaypoint(connector: IsoPlacement): boolean {
  return (connector.link?.via?.length ?? 0) < MAX_LINK_VIA;
}

/** Snap a handle position to the half-cell grid the editor uses elsewhere. */
const half = (v: number) => Math.round(v * 2) / 2;

/**
 * "+" handles for inserting a waypoint: the midpoint of each logical segment
 * (from -> via... -> to) with the `via` index to insert at. A connector with
 * no waypoints gets one handle at the middle of its drawn (routed) path, so
 * the handle sits on the line the user sees. None once the connector has
 * MAX_LINK_VIA waypoints: the insert would be rejected, and the drag that
 * follows it would grab an existing waypoint instead (holodeck#126).
 */
export function waypointInsertHandles(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  connector: IsoPlacement,
): Array<{ index: number; point: GridPoint }> {
  const via = connector.link?.via ?? [];
  if (!canInsertWaypoint(connector)) return [];
  if (via.length === 0) {
    const path = resolveConnectorPath(connector, scene.objects, registry);
    if (!path) return [];
    const mid = polylineMidpoint(path.points.map(([x, y]) => ({ x, y })));
    return mid ? [{ index: 0, point: { x: half(mid.x), y: half(mid.y) } }] : [];
  }
  const from = connectorEndPoint(scene, registry, connector, 'from');
  const to = connectorEndPoint(scene, registry, connector, 'to');
  if (!from || !to) return [];
  const pts = [from, ...via, to];
  return pts.slice(1).map((b, i) => {
    const a = pts[i]!;
    return { index: i, point: { x: half((a.x + b.x) / 2), y: half((a.y + b.y) / 2) } };
  });
}

/** Point halfway along a polyline by length. */
export function polylineMidpoint(points: readonly GridPoint[]): GridPoint | null {
  if (points.length === 0) return null;
  const lens = points.slice(1).map((b, i) => Math.hypot(b.x - points[i]!.x, b.y - points[i]!.y));
  let remaining = lens.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lens.length; i += 1) {
    const len = lens[i]!;
    if (remaining <= len && len > 0) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const t = remaining / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= len;
  }
  return points[points.length - 1]!;
}
