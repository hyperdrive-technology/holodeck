/**
 * Where each pipe run is drawn and how its ends are finished, resolved ONCE
 * per scene in SceneGraph (like the auto-elbow resolution) so the pooled
 * `InstancedPipes` and the unique-mesh `PipePart` draw identical runs. Pure:
 * no React, no three.
 *
 * Two things shorten a run:
 * - a 90 degree elbow on an end cell trims ELBOW_RADIUS so the tube meets the
 *   bend mouth (`trimRun`, as before);
 * - a vessel clip (routing/vessel-ports.ts `clipPipeEnd`): an end that runs
 *   into a cut-away window stops at the wall surface and gets a `cut` end
 *   (open tube-wall ring), an end under a raised vessel is pulled back to
 *   the rim. Solid-wall ends are unchanged.
 * An end on a bend cell is the elbow's business, so it ignores vessel clips.
 *
 * Ends that meet a RAISED vessel (clip contact `under` / `outlet`) get a
 * riser instead (routing/vessel-risers.ts): the run is trimmed to end flush
 * with a vertical riser that climbs to a side nozzle or the bottom outlet.
 * The riser trims replace the clip trims for those ends; SceneGraph draws
 * the risers from `ScenePipeRuns.risers`.
 *
 * Fittings (valves, caps, elbows) whose centre sits inside a cut-away
 * vessel's wall are listed in `hiddenFittings`: they would float in the open
 * interior, so SceneGraph does not draw them.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { ELBOW_RADIUS, PIPE_RADIUS, pipeWorldY, trimRun } from '../../assets/process/pipe-math';
import type { PipeEndStyle } from '../../assets/process/pipe-geometry';
import {
  resolvePipeClips,
  vesselWalls,
  type PipeClip,
  type PipeClipOptions,
  type VesselWall,
} from '../routing/vessel-ports';
import { planRisers, type PipeRiser } from '../routing/vessel-risers';
import type { IsoPartDefinition } from '../registry/types';
import { gridToWorld } from './grid';
import type { IsoPlacement } from './scene';

export interface PipeRunSpec {
  /** World (x, z) of the drawn `from` / `to` ends, after bend and vessel trimming. */
  from: [number, number];
  to: [number, number];
  ends: { from: PipeEndStyle; to: PipeEndStyle };
  /** The vessel clip of each end that touches a vessel (informational). */
  clip?: PipeClip;
  /** Clipping left (almost) nothing: draw no run. */
  hidden: boolean;
}

/** Shorter than this after clipping and the run is not drawn (a sliver would read as a stray ring). */
export const MIN_DRAWN_RUN = 0.02;

/** Grid cells that hold a 90 degree elbow (numeric rotation): pipes trim ELBOW_RADIUS there. */
export function bendKeysOf(objects: readonly IsoPlacement[]): Set<string> {
  return new Set(objects.filter((o) => o.object === 'elbow' && o.rotation != null).map((o) => `${o.x},${o.y}`));
}

/**
 * One run. `bendKeys` from `bendKeysOf`; `clip` from `resolvePipeClips`
 * (absent = no vessel contact); `riserTrim` from `planRisers` (an end listed
 * there joins a riser: its trim wins over the clip's, and it is flanged).
 * Null for a pipe without a far end.
 */
export function pipeRunSpec(
  object: IsoPlacement,
  bendKeys: ReadonlySet<string> | undefined,
  clip?: PipeClip,
  riserTrim?: { from?: number; to?: number },
): PipeRunSpec | null {
  if (object.toX === undefined || object.toY === undefined) return null;
  const [wx, , wz] = gridToWorld(object.x, object.y);
  const [tx, , tz] = gridToWorld(object.toX, object.toY);
  const bendFrom = Boolean(bendKeys?.has(`${object.x},${object.y}`));
  const bendTo = Boolean(bendKeys?.has(`${object.toX},${object.toY}`));
  const bent = trimRun([wx, wz], [tx, tz], bendFrom, bendTo);
  const vesselFrom = bendFrom ? undefined : clip?.from;
  const vesselTo = bendTo ? undefined : clip?.to;
  const riserFrom = bendFrom ? undefined : riserTrim?.from;
  const riserTo = bendTo ? undefined : riserTrim?.to;
  const a = riserFrom ?? vesselFrom?.trim ?? 0;
  const b = riserTo ?? vesselTo?.trim ?? 0;
  const dx = bent.to[0] - bent.from[0];
  const dz = bent.to[1] - bent.from[1];
  const len = Math.hypot(dx, dz);
  const ends = {
    from: riserFrom === undefined && vesselFrom?.cut ? 'cut' : 'flange',
    to: riserTo === undefined && vesselTo?.cut ? 'cut' : 'flange',
  } as const;
  const base = { ends, ...(clip ? { clip } : {}) };
  // Only vessel clipping hides a run; a degenerate authored pipe draws as before.
  const clipped = a !== 0 || b !== 0;
  if (len < 1e-9) return { ...base, from: bent.from, to: bent.to, hidden: clipped };
  const ux = dx / len;
  const uz = dz / len;
  const hidden = clipped && len - a - b < MIN_DRAWN_RUN;
  return {
    ...base,
    from: [bent.from[0] + ux * a, bent.from[1] + uz * a],
    to: [bent.to[0] - ux * b, bent.to[1] - uz * b],
    hidden,
  };
}

/** Parts that are drawn at pipe height on a single cell and so can end up inside a vessel. */
export const VESSEL_HIDDEN_FITTINGS: ReadonlySet<string> = new Set(['valve', 'end-cap', 'elbow']);

/**
 * Is a fitting centred at grid (x, y), at pipe height, inside `vessel`'s
 * wall (strictly inside radius R, overlapping the straight wall's height)?
 */
export function fittingInsideVessel(
  point: { x: number; y: number },
  vessel: VesselWall,
  opts: PipeClipOptions = {},
): boolean {
  const rp = opts.pipeRadius ?? PIPE_RADIUS;
  const y = opts.pipeY ?? pipeWorldY(rp);
  if (y + rp <= vessel.span.bottomY || y - rp >= vessel.span.topY) return false;
  return Math.hypot(point.x - vessel.x, point.y - vessel.y) < vessel.radius - 1e-6;
}

export interface ScenePipeRuns {
  /** By pipe id; every pipe with a far end is present. */
  runs: Map<string, PipeRunSpec>;
  /** Fitting ids that sit inside a cut-away vessel. */
  hiddenFittings: Set<string>;
  /** Risers that carry runs up to raised vessels (routing/vessel-risers.ts). */
  risers: PipeRiser[];
}

/** Every run in the scene plus the fittings to hide. `objects` should already have auto elbows resolved. */
export function resolvePipeRuns(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  opts: PipeClipOptions = {},
): ScenePipeRuns {
  const bendKeys = bendKeysOf(objects);
  const clips = resolvePipeClips(objects, registry, opts);
  const walls = vesselWalls(objects, registry);
  const { risers, trims } = planRisers(objects, clips, walls, bendKeys, opts);
  const runs = new Map<string, PipeRunSpec>();
  for (const o of objects) {
    if (o.object !== 'pipe') continue;
    const spec = pipeRunSpec(o, bendKeys, clips.get(o.id), trims.get(o.id));
    if (spec) runs.set(o.id, spec);
  }
  const hiddenFittings = new Set<string>();
  if (walls.length > 0) {
    for (const o of objects) {
      if (!VESSEL_HIDDEN_FITTINGS.has(o.object)) continue;
      if (!registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object)) continue;
      if (walls.some((w) => w.id !== o.id && fittingInsideVessel(o, w, opts))) hiddenFittings.add(o.id);
    }
  }
  return { runs, hiddenFittings, risers };
}
