/**
 * Port snapping: turn a clicked cell into a `RouteEnd`. Pure.
 *
 * `IsoPartDefinition.ports` are offsets from the part centre in the part's
 * UNROTATED frame (grid cells) plus the outward `dir`. Placement rotation
 * (yaw) rotates both. Clicking anywhere inside a part's (rotated) footprint
 * snaps to the nearest port of that part and uses its outward heading, so the
 * pipe leaves the vessel instead of crossing it. A click elsewhere, or on a
 * part with no ports, is the bare cell with no heading.
 *
 * Every declared port counts, including ones inside a vessel's cut-away
 * window: such a pipe is drawn clipped at the wall with a cut-section end
 * (vessel-ports.ts `clipPipeEnd`, applied by the renderers), so there is no
 * reason to steer routes away from the window any more.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoSceneFile } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { rotateHeading, rotateOffset, type GridPoint, type Heading } from './grid';
import { footprintContains, rotatedFootprint } from './occupancy';
import type { RouteEnd } from './astar';

export interface ResolvedRouteEnd extends RouteEnd {
  /** Set when the end snapped to a part port. */
  partId?: string;
  port?: string;
}

export function resolveRouteEnd(
  scene: Pick<IsoSceneFile, 'objects'>,
  registry: ContributionRegistry,
  cell: GridPoint,
  opts: {
    exclude?: ReadonlySet<string>;
    /**
     * Tie-break between COINCIDENT ports (several resolving to the same
     * world cell): prefer the one whose (rotated) outward heading is this.
     * Reroute passes the original pipe's heading, so a part with east and
     * west ports both at local (0,0) keeps the side the run actually used
     * (holodeck#47). Never beats a nearer port or one at another cell.
     */
    prefer?: Heading;
  } = {},
): ResolvedRouteEnd {
  // Later objects draw on top, so they win ties: iterate in reverse.
  for (let i = scene.objects.length - 1; i >= 0; i -= 1) {
    const obj = scene.objects[i]!;
    if (opts.exclude?.has(obj.id)) continue;
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, obj.object);
    if (!def) continue;
    const ports = def.ports ?? {};
    if (Object.keys(ports).length === 0) continue;
    const { w, h } = rotatedFootprint(def, obj.rotation, obj);
    if (!footprintContains(obj.x, obj.y, w, h, cell)) continue;

    let bestEnd: ResolvedRouteEnd | null = null;
    let bestDist = Infinity;
    // Object.entries keeps declaration order, so ties resolve deterministically.
    for (const [name, port] of Object.entries(ports)) {
      const off = rotateOffset(port.x, port.y, obj.rotation);
      const px = Math.round(obj.x + off.x);
      const py = Math.round(obj.y + off.y);
      const dist = Math.abs(px - cell.x) + Math.abs(py - cell.y);
      const heading = rotateHeading(port.dir, obj.rotation);
      // Only COINCIDENT ports (same world cell as the current best) are
      // re-ranked by `prefer`; equidistant ports elsewhere keep declaration order.
      const coincident = bestEnd !== null && bestEnd.cell.x === px && bestEnd.cell.y === py;
      const preferred = coincident && opts.prefer !== undefined && heading === opts.prefer && bestEnd?.heading !== opts.prefer;
      if (dist < bestDist || preferred) {
        bestDist = dist;
        bestEnd = { cell: { x: px, y: py }, heading, partId: obj.id, port: name };
      }
    }
    if (bestEnd) return bestEnd;
  }
  return { cell: { x: cell.x, y: cell.y } };
}
