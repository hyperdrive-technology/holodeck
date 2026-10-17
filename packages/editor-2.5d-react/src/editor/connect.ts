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
import { resolveLinkEnd, DEFAULT_CONNECTOR_LENGTH } from '../objects/connector';
import type { IsoLinkEnd } from '../objects/validate';
import type { IsoPartDefinition } from '../registry/types';
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
  for (const [name, p] of Object.entries(def?.ports ?? {})) {
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
