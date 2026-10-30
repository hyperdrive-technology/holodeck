/**
 * Vessel cut-away windows and the pipes that run into them. Pure: no React,
 * no three.
 *
 * Vessels (the code `Tank`, and any part that declares the same window) have
 * a cut-away window in the wall that shows the liquid. Pipes MAY connect
 * through that window, but then the pipe is cut away the same way the tank
 * is: it stops at the wall surface (radius R) and its end is drawn as a cut
 * section (open tube-wall ring) instead of a flange, so nothing floats inside
 * the open interior or pokes through the missing wall. `clipPipeEnd` decides
 * that per pipe end; `resolvePipeClips` runs it over a scene (SceneGraph does
 * this once, see src/iso/pipe-runs.ts). Pipes on solid wall are untouched.
 *
 * ANGLES: "wall angle" theta is measured like three.js CylinderGeometry, the
 * geometry `Tank` cuts its window from: a wall point is
 * (x, z) = (r sin theta, r cos theta). With grid x = world X and grid y =
 * world Z that is theta = atan2(dx, dy) on the grid, so s (+y) = 0 deg,
 * e (+x) = 90, n (-y) = 180, w (-x) = 270. A placement yaw of phi (radians
 * about +Y, as every part uses) turns theta into theta + phi.
 *
 * CUTOUT: `tankWindow(windowDeg, windowYawDeg)` removes the arc
 * [windowYaw - windowDeg/2, windowYaw + windowDeg/2] from the wall. The
 * default tank window (TANK_WINDOW_YAW 45, TANK_WINDOW_DEG 91) is therefore
 * [-0.5, 90.5] deg: it faces the default iso camera (screen-down) and just
 * includes both the e and the s side. Mixer: 40 +- 35 = [5, 75].
 *
 * BAND: a pipe of radius rp meeting a wall of radius R covers the wall
 * angles theta +- asin(rp / R). It enters through the window when that band
 * overlaps the cutout arc, i.e.
 *   angularDistance(theta, cutoutCentre) < cutoutWidth/2 + asin(rp/R).
 * A band exactly touching the jamb is solid wall.
 *
 * HEIGHT: the window only spans the straight wall (bottom closures are solid
 * all round, see Tank.tsx). A vessel on legs or a skirt lifts that wall off
 * the floor, so a floor-level pipe can pass UNDER the window instead of
 * through it. `IsoPartDefinition.wallSpan` gives the wall's world Y range;
 * without it the wall is assumed to stand on the floor.
 *
 * WHERE THE CUTOUT COMES FROM (first match wins):
 *   1. The placement's resolved params (`placement.params` over the part's
 *      param defaults): `windowYaw` (or `windowYawDeg`) and `windowDeg`, in
 *      degrees. This is how the parametric Tank exposes its window.
 *   2. `IsoPartDefinition.cutoutOf(placement)`, for a window that follows
 *      another param (the built-in `tank`'s `preset`).
 *   3. `IsoPartDefinition.cutout`, for parts whose window is fixed in code
 *      (the built-in `tank` / `mixer` read it from tank-params.ts).
 * Parts with neither have no cutout: pipes into them are never clipped.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { PIPE_RADIUS, pipeWorldY } from '../../assets/process/pipe-math';
import { DEFAULT_TANK_PARAMS } from '../../assets/process/tank-params';
import type { IsoPlacement } from '../iso/scene';
import { resolveParams } from '../registry/params';
import type { IsoPartDefinition, IsoPartPort } from '../registry/types';
import { HEADING_VECTOR, rotateHeading, rotateOffset, type Heading } from './grid';

const RAD = Math.PI / 180;

/** The window the code `Tank` cuts with its default params (read from tank-params.ts, not copied). */
export const DEFAULT_TANK_CUTOUT: NonNullable<IsoPartDefinition['cutout']> = {
  windowYawDeg: DEFAULT_TANK_PARAMS.windowYawDeg,
  windowDeg: DEFAULT_TANK_PARAMS.windowDeg,
};

/** A wall arc in world wall-angle degrees (see the header for the convention). */
export interface VesselCutout {
  /** Arc centre, normalised to [0, 360). */
  centerDeg: number;
  /** Full arc width in degrees, clamped to [0, 360]. */
  widthDeg: number;
}

/** Normalise degrees to [0, 360). */
export function wrapDeg(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r + 0; // + 0 turns -0 into 0
}

/** Smallest angle between two directions, in [0, 180]. */
export function angularDistanceDeg(a: number, b: number): number {
  const d = wrapDeg(a - b);
  return d > 180 ? 360 - d : d;
}

/** Wall angle of a grid offset from the vessel centre: s = 0, e = 90, n = 180, w = 270. */
export function wallAngleDeg(dx: number, dy: number): number {
  return wrapDeg(Math.atan2(dx, dy) / RAD);
}

export function headingWallAngleDeg(h: Heading): number {
  const v = HEADING_VECTOR[h];
  return wallAngleDeg(v.x, v.y);
}

/**
 * Cutout of a window `windowDeg` wide centred on `windowYawDeg` (Tank's own
 * frame), on a placement yawed by `rotation` radians.
 */
export function cutoutFromWindow(windowYawDeg: number, windowDeg: number, rotation = 0): VesselCutout {
  return {
    centerDeg: wrapDeg(windowYawDeg + rotation / RAD),
    widthDeg: Math.min(360, Math.max(0, windowDeg)),
  };
}

/** Half the wall arc a pipe of `pipeRadius` covers on a wall of `vesselRadius`. */
export function pipeHalfAngleDeg(vesselRadius: number, pipeRadius = PIPE_RADIUS): number {
  if (!(vesselRadius > 0)) return 90;
  return Math.asin(Math.min(1, Math.max(0, pipeRadius) / vesselRadius)) / RAD;
}

/** Does the band `angleDeg +- halfWidthDeg` overlap the open cutout? Boundary contact is not an overlap. */
export function overlapsCutout(cutout: VesselCutout | null, angleDeg: number, halfWidthDeg = 0): boolean {
  if (!cutout || cutout.widthDeg <= 0) return false;
  if (cutout.widthDeg >= 360) return true;
  return angularDistanceDeg(angleDeg, cutout.centerDeg) < cutout.widthDeg / 2 + halfWidthDeg - 1e-9;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The cutout of `placement` (a `def` part), or null when the part has none. */
export function vesselCutout(
  def: Pick<IsoPartDefinition, 'params' | 'cutout' | 'cutoutOf'>,
  placement: Pick<IsoPlacement, 'id' | 'params' | 'rotation'>,
): VesselCutout | null {
  const params = resolveParams(def, placement);
  const yaw = num(params.windowYaw) ?? num(params.windowYawDeg);
  const width = num(params.windowDeg);
  if (yaw !== undefined && width !== undefined) return cutoutFromWindow(yaw, width, placement.rotation);
  const own = def.cutoutOf?.(placement) ?? def.cutout;
  if (own) return cutoutFromWindow(own.windowYawDeg, own.windowDeg, placement.rotation);
  return null;
}

/**
 * Wall radius used for the pipe band. A `radius` param wins (the parametric
 * Tank); otherwise half the smaller footprint side, which is what a 2x2
 * vessel of radius 1 fills.
 */
export function vesselRadius(
  def: Pick<IsoPartDefinition, 'params' | 'footprint' | 'footprintOf'>,
  placement: IsoPlacement,
): number {
  const r = num(resolveParams(def, placement).radius);
  if (r !== undefined && r > 0) return r;
  const fp = def.footprintOf?.(placement) ?? def.footprint;
  return Math.min(fp.w, fp.h) / 2;
}


/** World wall angle of a part-local port (its offset; its outward `dir` for a port at the centre). */
export function portWallAngleDeg(port: IsoPartPort, rotation = 0): number {
  const off = rotateOffset(port.x, port.y, rotation);
  if (Math.hypot(off.x, off.y) > 1e-9) return wallAngleDeg(off.x, off.y);
  return headingWallAngleDeg(rotateHeading(port.dir, rotation));
}

/** World Y range of a vessel's straight (windowed) wall. */
export interface WallSpan {
  bottomY: number;
  topY: number;
}

/**
 * The vessel's wall span: `def.wallSpan(placement)` when the part declares
 * it (vessels on legs / skirts), else a wall standing on the floor up to the
 * placement height (built-in `tank` / `mixer`), else unbounded.
 */
export function vesselWallSpan(
  def: Pick<IsoPartDefinition, 'wallSpan' | 'defaults'>,
  placement: IsoPlacement,
): WallSpan {
  const declared = def.wallSpan?.(placement);
  if (declared) return declared;
  const h = num(placement.height) ?? num(def.defaults?.height);
  return { bottomY: 0, topY: h ?? Infinity };
}

/** Everything the clip needs about one vessel placement (grid units; grid x/y = world X/Z). */
export interface VesselWall {
  id: string;
  x: number;
  y: number;
  radius: number;
  cutout: VesselCutout;
  span: WallSpan;
}

/** The `VesselWall` of a placement, or null when the part has no cutout. */
export function vesselWall(def: IsoPartDefinition, placement: IsoPlacement): VesselWall | null {
  const cutout = vesselCutout(def, placement);
  if (!cutout) return null;
  return {
    id: placement.id,
    x: placement.x,
    y: placement.y,
    radius: vesselRadius(def, placement),
    cutout,
    span: vesselWallSpan(def, placement),
  };
}

/** Every vessel with a cutout in `objects`, in scene order. */
export function vesselWalls(objects: readonly IsoPlacement[], registry: ContributionRegistry): VesselWall[] {
  const out: VesselWall[] = [];
  for (const obj of objects) {
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, obj.object);
    const wall = def ? vesselWall(def, obj) : null;
    if (wall) out.push(wall);
  }
  return out;
}

/**
 * How a pipe end meets a vessel:
 * - `window`: through the cut-away window. Clip to the wall surface, cut-section end.
 * - `wall`: through solid wall. Untouched (the wall hides any overrun, as before).
 * - `under`: below a raised vessel's straight wall (legs / skirt), at the rim.
 *   Trimmed back to the rim if it reached inside; normal flanged end.
 * - `outlet`: deep under a raised vessel (a bottom / cone outlet branch drawn
 *   from near the centre). Untouched.
 */
export type PipeEndContact = 'window' | 'wall' | 'under' | 'outlet';

export interface PipeEndClip {
  vesselId: string;
  contact: PipeEndContact;
  /** World wall angle (deg) where the pipe axis crosses the wall (or passes closest to the centre). */
  angleDeg: number;
  /**
   * Distance along the pipe, from the authored end towards the other end, to
   * the end that is drawn. > 0 trims, < 0 extends (a window end authored up
   * to one pipe radius short of the wall is stretched onto it), 0 = as
   * authored.
   */
  trim: number;
  /** Draw this end as a cut section (open ring in the tank's cut-edge style), not a flange. */
  cut: boolean;
}

export interface PipeClipOptions {
  /** Pipe radius (default PIPE_RADIUS). */
  pipeRadius?: number;
  /** World Y of the pipe axis (default `pipeWorldY(pipeRadius)`, where every run is drawn). */
  pipeY?: number;
}

const EPS = 1e-6;

/**
 * Clip one pipe end against one vessel. Pure.
 *
 * `end` is the pipe end, `other` the far end of the same run (grid units).
 * Returns null when the end does not touch the vessel: it is further than
 * R + rp from the centre (the same one-pipe-radius tolerance the scenes rely
 * on), the run misses the cylinder, or it passes above the wall.
 *
 * THE CLIP DISTANCE. Put t along the pipe axis from `end` towards `other`
 * (unit vector u). With w = centre - end, the centre's foot on the axis is
 * at a0 = w . u and the axis passes b = |w x u| from the centre. A point of
 * the pipe at axial t and lateral offset s (|s| <= rp; vertical offsets do
 * not change the distance to a vertical cylinder's axis) is
 * sqrt((t - a0)^2 + (b - s)^2) from the centre, smallest at s = +-rp towards
 * the centre: m = max(0, b - rp). The whole cross-section is outside the
 * cylinder for t >= a0 + sqrt(R^2 - m^2), so that is where the pipe's
 * surface meets the curved wall and where a flat cut leaves nothing inside
 * radius R. A radial pipe (b = 0) is cut exactly at the wall: t = a0 + R.
 */
export function clipPipeEnd(
  end: { x: number; y: number },
  other: { x: number; y: number },
  vessel: VesselWall,
  opts: PipeClipOptions = {},
): PipeEndClip | null {
  const rp = Math.max(0, opts.pipeRadius ?? PIPE_RADIUS);
  const pipeY = opts.pipeY ?? pipeWorldY(rp);
  const R = vessel.radius;
  if (!(R > 0)) return null;
  const d = Math.hypot(end.x - vessel.x, end.y - vessel.y);
  if (d > R + rp + EPS) return null;
  const len = Math.hypot(other.x - end.x, other.y - end.y);
  if (len < EPS) return null;
  const ux = (other.x - end.x) / len;
  const uy = (other.y - end.y) / len;
  const wx = vessel.x - end.x;
  const wy = vessel.y - end.y;
  const a0 = wx * ux + wy * uy;
  const b = Math.abs(wx * uy - wy * ux);
  const m = Math.max(0, b - rp);
  if (m >= R - EPS) return null; // grazes the wall without entering it
  const tSurface = a0 + Math.sqrt(R * R - m * m);
  // Where the axis crosses the wall (or, if the axis itself misses, its closest point): the band centre.
  const tAxis = b < R ? a0 + Math.sqrt(R * R - b * b) : a0;
  const angleDeg = wallAngleDeg(end.x + ux * tAxis - vessel.x, end.y + uy * tAxis - vessel.y);
  const base = { vesselId: vessel.id, angleDeg };
  if (pipeY - rp >= vessel.span.topY - EPS) return null; // passes over the vessel
  if (pipeY + rp <= vessel.span.bottomY + EPS) {
    if (d < R - rp - EPS) return { ...base, contact: 'outlet', trim: 0, cut: false };
    return { ...base, contact: 'under', trim: Math.max(0, tSurface), cut: false };
  }
  if (overlapsCutout(vessel.cutout, angleDeg, pipeHalfAngleDeg(R, rp))) {
    return { ...base, contact: 'window', trim: tSurface, cut: true };
  }
  return { ...base, contact: 'wall', trim: 0, cut: false };
}

/**
 * Smallest horizontal distance from `centre` (a vertical axis) to any point
 * of a straight pipe of radius `pipeRadius` from `a` to `b` (flat ends).
 * Same maths as `clipPipeEnd`: the axial gap to the nearest axis point,
 * combined with the lateral gap less the pipe radius. A pipe with no
 * geometry inside a vessel of radius R has `pipeAxisDistance(...) >= R`.
 */
export function pipeAxisDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  centre: { x: number; y: number },
  pipeRadius = PIPE_RADIUS,
): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const wx = centre.x - a.x;
  const wy = centre.y - a.y;
  if (len < EPS) return Math.max(0, Math.hypot(wx, wy) - pipeRadius);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const a0 = wx * ux + wy * uy;
  const lateral = Math.max(0, Math.abs(wx * uy - wy * ux) - pipeRadius);
  const axial = a0 < 0 ? -a0 : a0 > len ? a0 - len : 0;
  return Math.hypot(axial, lateral);
}

/** Per-pipe clips by end; an end that touches no vessel is absent. */
export interface PipeClip {
  from?: PipeEndClip;
  to?: PipeEndClip;
}

const isPipe = (o: IsoPlacement): o is IsoPlacement & { toX: number; toY: number } =>
  o.object === 'pipe' && typeof o.toX === 'number' && typeof o.toY === 'number';

/** Rank when one end touches several vessels: a window clip wins, then the nearest wall. */
const CONTACT_RANK: Record<PipeEndContact, number> = { window: 0, under: 1, wall: 2, outlet: 3 };

/**
 * `clipPipeEnd` for both ends of every pipe against every vessel with a
 * cutout. Pipes with no contact are absent from the map. Pure; SceneGraph
 * calls it once per scene change (src/iso/pipe-runs.ts).
 */
export function resolvePipeClips(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  opts: PipeClipOptions = {},
): Map<string, PipeClip> {
  const walls = vesselWalls(objects, registry);
  const out = new Map<string, PipeClip>();
  if (walls.length === 0) return out;
  for (const p of objects) {
    if (!isPipe(p)) continue;
    const from = { x: p.x, y: p.y };
    const to = { x: p.toX, y: p.toY };
    const best = (end: typeof from, other: typeof from): PipeEndClip | undefined => {
      let pick: PipeEndClip | undefined;
      for (const w of walls) {
        const c = clipPipeEnd(end, other, w, opts);
        if (c && (!pick || CONTACT_RANK[c.contact] < CONTACT_RANK[pick.contact])) pick = c;
      }
      return pick;
    };
    const clip: PipeClip = {};
    const f = best(from, to);
    const t = best(to, from);
    if (f) clip.from = f;
    if (t) clip.to = t;
    if (f || t) out.set(p.id, clip);
  }
  return out;
}

export interface WindowConnection {
  pipeId: string;
  vesselId: string;
  /** Which end of the pipe enters the window. */
  end: 'from' | 'to';
  /** Where the pipe axis meets the wall (world wall angle, degrees). */
  angleDeg: number;
  /** The clip the renderers apply (always `contact: 'window'`, `cut: true`). */
  clip: PipeEndClip;
  message: string;
}

/**
 * Informational: every pipe end that runs into a vessel through its
 * cut-away window (and so is drawn clipped, with a cut-section end). Not a
 * validation error; the brewery scene test uses it to pin which runs are
 * clipped.
 */
export function findWindowConnections(
  scene: { readonly objects: readonly IsoPlacement[] },
  registry: ContributionRegistry,
  opts: PipeClipOptions = {},
): WindowConnection[] {
  const out: WindowConnection[] = [];
  for (const [pipeId, clip] of resolvePipeClips(scene.objects, registry, opts)) {
    for (const end of ['from', 'to'] as const) {
      const c = clip[end];
      if (c?.contact !== 'window') continue;
      out.push({
        pipeId,
        vesselId: c.vesselId,
        end,
        angleDeg: c.angleDeg,
        clip: c,
        message: `${pipeId} (${end} end) enters ${c.vesselId}'s window at ${c.angleDeg.toFixed(1)} deg, clipped ${c.trim.toFixed(3)} to the wall`,
      });
    }
  }
  return out;
}
