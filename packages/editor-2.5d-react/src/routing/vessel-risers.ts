/**
 * Pipe risers: how a floor-level pipe run climbs to a raised vessel. Pure:
 * no React, no three.
 *
 * Every pipe run is drawn at one height (`pipeWorldY`, just off the floor).
 * A vessel on legs or a skirt lifts its shell above that, so a run that ends
 * "at" such a vessel used to stop beside the legs or under the bottom, never
 * on the shell (Des, 2026-11-15, brewery kettle / fermenters). The vessel
 * clip (vessel-ports.ts `clipPipeEnd`) already tells those ends apart:
 *
 * - `under`: the run ends at the rim, below the straight wall. It becomes a
 *   SIDE riser: the run stops a nozzle length outside the shell, a vertical
 *   riser climbs to just above the wall's bottom edge, and a short
 *   horizontal nozzle stub runs from the riser into the shell, flanged on
 *   the shell (or drawn as a cut section when that spot is in the cut-away
 *   window, like any other window entry).
 * - `outlet`: the run ends deep under the vessel (a cone / bottom outlet
 *   branch). It becomes a BOTTOM riser: a vertical drop leg on the run axis,
 *   right under the outlet, climbing to the bottom closure (the cone tip, or
 *   the dish at that radius).
 *
 * Both risers are vertical pipes with a flange ring at each end, so their
 * vertical outline lines end on rings (holodeck/blender/README.md line rule,
 * the same rule the vessels follow). The run is trimmed (or stretched) so it
 * ends flush with the riser's side: the riser foot reads as a tee with a
 * capped drip leg below the run, the usual way a header drops to a nozzle.
 *
 * HEADER: several pipe ends whose risers land on the same spot of the same
 * vessel (an inlet and an outlet branch both drawn from the cone outlet, two
 * runs meeting at one side nozzle) share ONE riser and one nozzle: a short
 * manifold, rather than overlapping risers. Each run is re-trimmed to the
 * shared riser.
 *
 * Why derived geometry and not new scene objects: the risers follow from
 * data the scene already has (the run, the vessel's `wallSpan`), so every
 * existing scene (the brewery HMI in core included) gets them without a file
 * or schema change, and moving a vessel moves its risers with it.
 *
 * Coordinates: grid units in, like vessel-ports.ts (grid x/y = world X/Z,
 * one cell = one world unit); heights are world Y. `at` / nozzle points come
 * out in world (x, z) via `gridToWorld`, ready for the renderer.
 */

import { ELBOW_RADIUS, pipeWorldY, PIPE_RADIUS } from '../../assets/process/pipe-math';
import { gridToWorld } from '../iso/grid';
import type { IsoPlacement } from '../iso/scene';
import type { PipeClip, PipeEndClip, VesselWall } from './vessel-ports';
import { overlapsCutout, pipeHalfAngleDeg, wallAngleDeg } from './vessel-ports';

/**
 * Horizontal length of a side nozzle stub, from the riser's side to the
 * shell (world units). Long enough to read as a nozzle with its two flanges
 * at the default zoom, short enough that a run beside a vessel keeps most of
 * its length (FV glycol stubs are 1 cell).
 */
export const RISER_NOZZLE_LEN = 0.2;
/** Shortest nozzle stub worth drawing; a run with no room even for this keeps its plain vessel clip. */
export const RISER_NOZZLE_MIN = 0.05;
/** Gap between the straight wall's bottom edge and the side nozzle's underside (world units). */
export const RISER_NOZZLE_CLEARANCE = 0.08;
/**
 * Below this rise (top of the riser minus the run's top) there is no room
 * for a riser: the run already touches the vessel, so it is left as clipped.
 */
export const RISER_MIN_RISE = 0.02;
/**
 * The run must keep at least this much drawn length between the riser and
 * its other end (or that end's elbow); otherwise the end keeps its plain
 * vessel clip. Matches pipe-runs.ts MIN_DRAWN_RUN in spirit, with room for
 * the two end flanges.
 */
export const RISER_MIN_RUN = 0.1;

/** A run joins a shared (header) riser only when its axis passes this close to the riser axis. */
export const HEADER_AXIS_TOL = 1e-3;

export type RiserKind = 'side' | 'bottom';

/** One pipe end that joins a riser. */
export interface RiserPipeEnd {
  pipeId: string;
  end: 'from' | 'to';
}

/** A vertical riser (plus a side nozzle stub) connecting floor runs to a raised vessel. */
export interface PipeRiser {
  /** Stable id: `<vesselId>:<kind>:<n>`. */
  id: string;
  vesselId: string;
  kind: RiserKind;
  /** World (x, z) of the riser axis. */
  at: [number, number];
  /** World Y of the riser's drawn bottom and top (flange ring at each). */
  bottomY: number;
  topY: number;
  /** World Y of the run axis that feeds it. */
  runY: number;
  /** Side risers: the horizontal stub from the riser into the shell. */
  nozzle?: {
    /** World Y of the stub axis. */
    y: number;
    /** World (x, z) of the stub's riser end (on the riser's side) and shell end (on the wall). */
    from: [number, number];
    to: [number, number];
    /** Shell end finish: a flange on solid wall, a cut section in the cut-away window. */
    shellEnd: 'flange' | 'cut';
  };
  /** The pipe ends that feed this riser (a header when more than one). */
  pipes: RiserPipeEnd[];
}

export interface RiserOptions {
  /** Pipe (and riser) radius, default PIPE_RADIUS. */
  pipeRadius?: number;
  /** World Y of the run axis, default `pipeWorldY(pipeRadius)`. */
  pipeY?: number;
  nozzleLen?: number;
  nozzleClearance?: number;
}

export interface RiserPlan {
  risers: PipeRiser[];
  /**
   * Per pipe, the trim of each end that joins a riser: distance along the
   * run from the authored end to the drawn end (> 0 shortens, < 0 extends),
   * replacing the vessel clip's trim for that end.
   */
  trims: Map<string, { from?: number; to?: number }>;
}

type Pt = { x: number; y: number };

const EPS = 1e-6;

/**
 * World Y of a vessel's underside at horizontal distance `r` from its axis:
 * flat at `outletY` inside the outlet radius, then straight up to the wall's
 * bottom edge at the vessel radius. Exact for a cone; for a dish the chord
 * sits just above the (convex) surface, so a riser ending there finishes
 * hidden inside the closure, never short of it. No `outletY` = flat bottom.
 */
export function vesselUndersideY(vessel: Pick<VesselWall, 'radius' | 'span'>, r: number): number {
  const { bottomY, outletY } = vessel.span;
  if (outletY === undefined || !(outletY < bottomY)) return bottomY;
  const R = vessel.radius;
  // An outlet as wide as the shell is a dish pole, not a flat cone tip.
  const r0 = Math.min(Math.max(0, vessel.span.outletRadius ?? 0), R);
  const rFlat = r0 >= R - EPS ? 0 : r0;
  const d = Math.min(Math.max(0, r), R);
  if (d <= rFlat) return outletY;
  return outletY + ((bottomY - outletY) * (d - rFlat)) / (R - rFlat);
}

/** Unit direction and length of the run from `end` towards `other` (grid units). */
function axis(end: Pt, other: Pt): { ux: number; uy: number; len: number } | null {
  const len = Math.hypot(other.x - end.x, other.y - end.y);
  if (len < EPS) return null;
  return { ux: (other.x - end.x) / len, uy: (other.y - end.y) / len, len };
}

interface EndPlan {
  pipeId: string;
  end: 'from' | 'to';
  vessel: VesselWall;
  kind: RiserKind;
  /** Riser axis (grid). */
  at: Pt;
  /** Distance along the run (from the authored end) to the riser axis. */
  tAxis: number;
  /** The run's own geometry, for re-trimming to a shared riser. */
  endPt: Pt;
  reserve: number;
  ux: number;
  uy: number;
  len: number;
}

/**
 * Where the riser for one pipe end goes, or null when this end gets none
 * (no contact, solid wall / window contact, run too short, no room to rise).
 * Pure; `planRisers` runs it over a scene.
 */
export function planRiserEnd(
  end: Pt,
  other: Pt,
  clip: PipeEndClip | undefined,
  vessel: VesselWall | undefined,
  opts: RiserOptions = {},
  /** Length the far end already takes off the run (an elbow's trim). */
  reserve = 0,
): { kind: RiserKind; at: Pt; tAxis: number } | null {
  if (!clip || !vessel || clip.vesselId !== vessel.id) return null;
  if (clip.contact !== 'under' && clip.contact !== 'outlet') return null;
  const ax = axis(end, other);
  if (!ax) return null;
  const rp = Math.max(0, opts.pipeRadius ?? PIPE_RADIUS);
  const pipeY = opts.pipeY ?? pipeWorldY(rp);
  const R = vessel.radius;
  // Same decomposition as clipPipeEnd: a0 = where the vessel axis' foot sits
  // along the run, b = how far the run axis passes from the vessel axis.
  const wx = vessel.x - end.x;
  const wy = vessel.y - end.y;
  const a0 = wx * ax.ux + wy * ax.uy;
  const b = Math.abs(wx * ax.uy - wy * ax.ux);
  let kind: RiserKind;
  let tAxis: number;
  let top: number;
  if (clip.contact === 'outlet') {
    kind = 'bottom';
    tAxis = a0;
    top = vesselUndersideY(vessel, b);
  } else {
    kind = 'side';
    // The nozzle shrinks (down to RISER_NOZZLE_MIN) when the run is too short
    // for the full one, e.g. a 1-cell glycol stub that ends in an elbow. The
    // riser axis may sit at most `tMax` along the run: there, sqrt(S^2 - b^2)
    // = tMax - a0, so the largest standoff S is hypot(tMax - a0, b).
    const tMax = ax.len - reserve - RISER_MIN_RUN - rp;
    const sMax = tMax - a0 >= 0 ? Math.hypot(tMax - a0, b) : 0;
    const nozzle = Math.min(opts.nozzleLen ?? RISER_NOZZLE_LEN, sMax - R - rp);
    if (nozzle < RISER_NOZZLE_MIN - EPS) return null;
    const standoff = R + rp + nozzle;
    if (b >= standoff) return null;
    // The far crossing of the standoff circle: outside the shell, on the run's side.
    tAxis = a0 + Math.sqrt(standoff * standoff - b * b);
    top = nozzleAxisY(vessel, rp, opts) + rp;
  }
  // The drawn run must keep some length once it ends flush with the riser.
  if (tAxis + rp > ax.len - reserve - RISER_MIN_RUN + EPS) return null;
  if (top - (pipeY + rp) < RISER_MIN_RISE) return null;
  return { kind, at: { x: end.x + ax.ux * tAxis, y: end.y + ax.uy * tAxis }, tAxis };
}

/** World Y of a side nozzle's axis: just above the straight wall's bottom edge, never above the wall's middle. */
export function nozzleAxisY(vessel: Pick<VesselWall, 'span'>, pipeRadius = PIPE_RADIUS, opts: RiserOptions = {}): number {
  const { bottomY, topY } = vessel.span;
  const y = bottomY + pipeRadius + (opts.nozzleClearance ?? RISER_NOZZLE_CLEARANCE);
  return Number.isFinite(topY) ? Math.min(y, (bottomY + topY) / 2) : y;
}

const isPipe = (o: IsoPlacement): o is IsoPlacement & { toX: number; toY: number } =>
  o.object === 'pipe' && typeof o.toX === 'number' && typeof o.toY === 'number';

const toWorld = (p: Pt): [number, number] => {
  const [x, , z] = gridToWorld(p.x, p.y);
  return [x, z];
};

/**
 * Plan every riser in a scene. `clips` from `resolvePipeClips`, `walls` from
 * `vesselWalls`; `bendKeys` (cells holding a 90 degree elbow) mark ends that
 * belong to an elbow and so get no riser, like they ignore vessel clips.
 */
export function planRisers(
  objects: readonly IsoPlacement[],
  clips: ReadonlyMap<string, PipeClip>,
  walls: readonly VesselWall[],
  bendKeys: ReadonlySet<string> = new Set(),
  opts: RiserOptions = {},
): RiserPlan {
  const rp = Math.max(0, opts.pipeRadius ?? PIPE_RADIUS);
  const pipeY = opts.pipeY ?? pipeWorldY(rp);
  const byId = new Map(walls.map((w) => [w.id, w]));
  const ends: EndPlan[] = [];
  for (const p of objects) {
    if (!isPipe(p)) continue;
    const clip = clips.get(p.id);
    if (!clip) continue;
    const from = { x: p.x, y: p.y };
    const to = { x: p.toX, y: p.toY };
    const sides = [
      ['from', from, to],
      ['to', to, from],
    ] as const;
    // ONE length budget per run: both ends may want a riser (a short pipe
    // between two raised vessels), so each end's reserve covers whatever the
    // other end takes (its elbow, its riser or its plain clip trim).
    const elbowAt = (q: Pt) => (bendKeys.has(`${q.x},${q.y}`) ? ELBOW_RADIUS : 0);
    const want = sides.map(([end, self]) => {
      if (bendKeys.has(`${self.x},${self.y}`)) return null;
      const c = clip[end];
      const vessel = c ? byId.get(c.vesselId) : undefined;
      return c && vessel ? { c, vessel } : null;
    });
    const ax = axis(from, to);
    if (!ax) continue;
    const tryPlan = (i: 0 | 1, reserve: number) => {
      const w = want[i];
      const [, self, other] = sides[i];
      return w ? planRiserEnd(self, other, w.c, w.vessel, opts, reserve) : null;
    };
    const elbowReserve = [elbowAt(to), elbowAt(from)] as const;
    let plans = [tryPlan(0, elbowReserve[0]), tryPlan(1, elbowReserve[1])];
    if (plans[0] && plans[1] && plans[0].tAxis + plans[1].tAxis + 2 * rp > ax.len - RISER_MIN_RUN + EPS) {
      // Both fit alone but not together: give each half the run (nozzles shrink to fit).
      const half = (ax.len - RISER_MIN_RUN) / 2;
      plans = [tryPlan(0, half), tryPlan(1, half)];
    }
    // An end that gets no riser keeps its clip trim; the other end must leave room for it.
    for (const i of [0, 1] as const) {
      const j = (1 - i) as 0 | 1;
      if (plans[i] && !plans[j]) {
        const otherTrim = Math.max(0, elbowReserve[i], want[j] ? want[j]!.c.trim : 0);
        plans[i] = tryPlan(i, otherTrim);
      }
    }
    for (const i of [0, 1] as const) {
      const plan = plans[i];
      const w = want[i];
      if (!plan || !w) continue;
      const [end, self, other] = sides[i];
      const j = (1 - i) as 0 | 1;
      const otherTake = plans[j] ? plans[j]!.tAxis + rp : Math.max(elbowReserve[i], want[j] ? want[j]!.c.trim : 0);
      const selfAx = axis(self, other)!;
      ends.push({ pipeId: p.id, end, vessel: w.vessel, kind: plan.kind, at: plan.at, tAxis: plan.tAxis, endPt: self, reserve: otherTake, ...selfAx });
    }
  }

  // Header: ends of the same kind on the same vessel whose risers land within
  // one pipe diameter share the first one's riser (scene order, deterministic).
  const groups: EndPlan[][] = [];
  for (const e of ends) {
    const g = groups.find(
      (grp) =>
        grp[0]!.vessel.id === e.vessel.id &&
        grp[0]!.kind === e.kind &&
        Math.hypot(grp[0]!.at.x - e.at.x, grp[0]!.at.y - e.at.y) < 2 * rp &&
        // Only runs whose axis passes through the shared riser can butt onto
        // it; an offset parallel branch keeps its own riser (holodeck#321).
        Math.abs((grp[0]!.at.x - e.endPt.x) * e.uy - (grp[0]!.at.y - e.endPt.y) * e.ux) < HEADER_AXIS_TOL,
    );
    if (g) g.push(e);
    else groups.push([e]);
  }

  const risers: PipeRiser[] = [];
  const trims = new Map<string, { from?: number; to?: number }>();
  const counters = new Map<string, number>();
  for (const grp of groups) {
    const lead = grp[0]!;
    const vessel = lead.vessel;
    const at = lead.at;
    const members: RiserPipeEnd[] = [];
    for (const e of grp) {
      // Re-trim to the shared riser: the foot of `at` on this run's axis.
      const t = e === lead ? e.tAxis : (at.x - e.endPt.x) * e.ux + (at.y - e.endPt.y) * e.uy;
      const trim = t + rp;
      if (trim > e.len - e.reserve - RISER_MIN_RUN + EPS) continue; // cannot reach the shared riser and keep a length
      const prev = trims.get(e.pipeId) ?? {};
      prev[e.end] = trim;
      trims.set(e.pipeId, prev);
      members.push({ pipeId: e.pipeId, end: e.end });
    }
    if (members.length === 0) continue;
    const n = counters.get(`${vessel.id}:${lead.kind}`) ?? 0;
    counters.set(`${vessel.id}:${lead.kind}`, n + 1);
    const bottomY = pipeY - rp;
    const base = { id: `${vessel.id}:${lead.kind}:${n}`, vesselId: vessel.id, kind: lead.kind, at: toWorld(at), bottomY, runY: pipeY, pipes: members };
    if (lead.kind === 'bottom') {
      const r = Math.hypot(at.x - vessel.x, at.y - vessel.y);
      risers.push({ ...base, topY: vesselUndersideY(vessel, r) });
      continue;
    }
    // Side: the stub runs radially from the riser's side into the shell.
    const dx = vessel.x - at.x;
    const dy = vessel.y - at.y;
    const dist = Math.hypot(dx, dy);
    const ux = dist > EPS ? dx / dist : 0;
    const uy = dist > EPS ? dy / dist : 0;
    const y = nozzleAxisY(vessel, rp, opts);
    const shell = { x: vessel.x - ux * vessel.radius, y: vessel.y - uy * vessel.radius };
    const angle = wallAngleDeg(shell.x - vessel.x, shell.y - vessel.y);
    const inWindow = y - rp < vessel.span.topY && overlapsCutout(vessel.cutout, angle, pipeHalfAngleDeg(vessel.radius, rp));
    risers.push({
      ...base,
      topY: y + rp,
      nozzle: {
        y,
        from: toWorld({ x: at.x + ux * rp, y: at.y + uy * rp }),
        to: toWorld(shell),
        shellEnd: inWindow ? 'cut' : 'flange',
      },
    });
  }
  return enforceRunBudgets(objects, clips, bendKeys, risers, trims);
}

/**
 * The invariant, checked once on the FINAL trims (after header grouping,
 * whatever the input order): every run keeps at least RISER_MIN_RUN between
 * its drawn ends. A run that does not is put back exactly as on main: both of
 * its riser ends are dropped (it keeps the plain vessel clip trims), and a
 * riser left with no pipe is not drawn. A run hidden by risers but visible on
 * main is therefore impossible (holodeck#320 and its header follow-up).
 */
function enforceRunBudgets(
  objects: readonly IsoPlacement[],
  clips: ReadonlyMap<string, PipeClip>,
  bendKeys: ReadonlySet<string>,
  risers: PipeRiser[],
  trims: Map<string, { from?: number; to?: number }>,
): RiserPlan {
  const revert = new Set<string>();
  for (const p of objects) {
    if (!isPipe(p)) continue;
    const t = trims.get(p.id);
    if (!t) continue;
    const len = Math.hypot(p.toX - p.x, p.toY - p.y);
    // Elbow trims as pipe-math.ts trimRun applies them (dropped when both do not fit).
    let ea = bendKeys.has(`${p.x},${p.y}`) ? ELBOW_RADIUS : 0;
    let eb = bendKeys.has(`${p.toX},${p.toY}`) ? ELBOW_RADIUS : 0;
    if (ea + eb >= len - 1e-4) ea = eb = 0;
    const clip = clips.get(p.id);
    const a = t.from ?? (ea || clip?.from?.trim || 0);
    const b = t.to ?? (eb || clip?.to?.trim || 0);
    if (a + b > len - RISER_MIN_RUN + EPS) revert.add(p.id);
  }
  if (revert.size === 0) return { risers, trims };
  for (const id of revert) trims.delete(id);
  const kept = risers
    .map((r) => ({ ...r, pipes: r.pipes.filter((pe) => !revert.has(pe.pipeId)) }))
    .filter((r) => r.pipes.length > 0);
  return { risers: kept, trims };
}

/**
 * Opacity / z-order of a riser, from the pipes that feed it (holodeck#326):
 * a riser belongs to its runs, so it fades with them. A shared header takes
 * the most visible member (max opacity) and the frontmost z (max), so it is
 * never fainter or further back than any run it carries. Opacity 0 = do not
 * draw it (every feeding run is invisible). Missing values default like
 * placements do (opacity 1, z 0).
 */
export function riserAppearance(
  riser: Pick<PipeRiser, 'pipes'>,
  byId: ReadonlyMap<string, Pick<IsoPlacement, 'opacity' | 'z'>>,
): { opacity: number; z: number } {
  let opacity = 0;
  let z = -Infinity;
  for (const pe of riser.pipes) {
    const p = byId.get(pe.pipeId);
    opacity = Math.max(opacity, Math.min(1, Math.max(0, p?.opacity ?? 1)));
    z = Math.max(z, p?.z ?? 0);
  }
  return { opacity, z: Number.isFinite(z) ? z : 0 };
}
