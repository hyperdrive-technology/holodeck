/**
 * Inline parts that sit ON a pipe (holodeck#22). Pure.
 *
 * Design: a valve drawn on the middle of one long pipe records the pipe it
 * sits on with `onPipe: <pipe id>` and `at: <0..1 along that pipe, from its
 * (x, y) end to its (toX, toY) end>`. The pipe is NOT split. Reroute then
 * carries such parts along to the same fraction of the new route.
 *
 * Why not split the pipe at the valve (so the valve becomes a joint and
 * `findRun` already stops there)? Splitting rewrites hand-authored scenes:
 * one pipe id becomes two, and hosts bind tags / animation to placement ids
 * (`extensions` bags), the band/colour has to be copied, and pipe-cutaway /
 * flange rendering sees an extra joint. `onPipe` is additive metadata, so
 * old scenes parse unchanged and the part's own x,y stays the single source
 * of truth for drawing.
 *
 * `onPipe` is a hint that must also hold geometrically: `hostPipeOf` only
 * honours it while the part really lies on that pipe's segment (a dragged
 * part or a moved pipe silently detaches instead of teleporting the part).
 * Geometry alone is never enough (an obstacle dropped across a pipe is not
 * hosted and reroute still routes around it) -- the explicit attachment is.
 *
 * A part at `at` 0 or 1 is at a joint, which is a run END (see run.ts), not
 * something to carry; hosted means strictly inside the pipe.
 */

import type { IsoPlacement } from '../iso/scene';
import { ELBOW_RADIUS } from '../../assets/process/pipe-math';
import type { GridPoint } from './grid';

/** Grid units; scenes are hand-authored with 2-decimal coordinates. */
const ON_PIPE_EPS = 1e-3;

export interface PipeSeg {
  id: string;
  from: GridPoint;
  to: GridPoint;
}

export interface PipeAttachment {
  onPipe: string;
  at: number;
}

export const isPipePlacement = (o: IsoPlacement): boolean =>
  o.object === 'pipe' && typeof o.toX === 'number' && typeof o.toY === 'number';

export const segOf = (p: IsoPlacement): PipeSeg => ({
  id: p.id,
  from: { x: p.x, y: p.y },
  to: { x: p.toX!, y: p.toY! },
});

const segLength = (s: PipeSeg) => Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);

/** Parametric position of (x, y) on `seg` if it lies on it (strictly inside, within eps), else null. */
export function positionOnPipe(seg: PipeSeg, x: number, y: number): number | null {
  const dx = seg.to.x - seg.from.x;
  const dy = seg.to.y - seg.from.y;
  const len = Math.hypot(dx, dy);
  if (len < ON_PIPE_EPS) return null;
  const t = ((x - seg.from.x) * dx + (y - seg.from.y) * dy) / (len * len);
  const dist = Math.hypot(seg.from.x + t * dx - x, seg.from.y + t * dy - y);
  if (dist > ON_PIPE_EPS) return null;
  // Strictly inside: a part within eps of an end is AT the joint.
  if (t * len <= ON_PIPE_EPS || (1 - t) * len <= ON_PIPE_EPS) return null;
  return t;
}

/** The attachment a part at (x, y) would get: the first pipe it lies strictly inside. */
export function findHostPipe(
  objects: readonly IsoPlacement[],
  x: number,
  y: number,
  skipId?: string,
): PipeAttachment | null {
  for (const o of objects) {
    if (o.id === skipId || !isPipePlacement(o)) continue;
    const at = positionOnPipe(segOf(o), x, y);
    if (at !== null) return { onPipe: o.id, at };
  }
  return null;
}

/** Copy of `part` with its attachment set to match its position (cleared when it is on no pipe). */
export function withAttachment(part: IsoPlacement, objects: readonly IsoPlacement[]): IsoPlacement {
  const { onPipe: _onPipe, at: _at, ...rest } = part;
  const host = findHostPipe(objects, part.x, part.y, part.id);
  return host ? { ...rest, ...host } : rest;
}

/** The pipe `part` is validly attached to, or null (no `onPipe`, dangling id, or no longer on the pipe). */
export function hostPipeOf(part: IsoPlacement, objects: readonly IsoPlacement[]): IsoPlacement | null {
  if (typeof part.onPipe !== 'string') return null;
  const host = objects.find((o) => o.id === part.onPipe);
  if (!host || !isPipePlacement(host)) return null;
  return positionOnPipe(segOf(host), part.x, part.y) === null ? null : host;
}

/** Strip the attachment from every part hosted on pipe `pipeId` (the pipe is going away). */
export function detachFrom(objects: readonly IsoPlacement[], pipeId: string): IsoPlacement[] {
  return objects.map((o) => {
    if (o.onPipe !== pipeId) return o;
    const { onPipe: _onPipe, at: _at, ...rest } = o;
    return rest;
  });
}

/**
 * Order `pipes` as a chain from `start`, each oriented along travel. Pipes
 * that do not connect are ignored (a run is a simple chain, run.ts).
 */
export function chainFrom(pipes: readonly PipeSeg[], start: GridPoint): PipeSeg[] {
  const same = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
  const left = [...pipes];
  const out: PipeSeg[] = [];
  let at = start;
  for (;;) {
    const i = left.findIndex((p) => same(p.from, at) || same(p.to, at));
    if (i < 0) return out;
    const [p] = left.splice(i, 1);
    const seg = same(p!.from, at) ? p! : { id: p!.id, from: p!.to, to: p!.from };
    out.push(seg);
    at = seg.to;
  }
}

/** Fraction (0..1) of the chain's total length at `t` along chain[index]. */
function fractionAlong(chain: readonly PipeSeg[], index: number, t: number): number {
  const total = chain.reduce((n, s) => n + segLength(s), 0);
  const before = chain.slice(0, index).reduce((n, s) => n + segLength(s), 0);
  return total === 0 ? 0 : (before + t * segLength(chain[index]!)) / total;
}

const axisOf = (s: PipeSeg) => (Math.abs(s.to.x - s.from.x) >= Math.abs(s.to.y - s.from.y) ? 0 : Math.PI / 2);

/**
 * Where on `route` (oriented pipes of the NEW route, start to end) a part at
 * fraction `f` of the old run goes. Positions within an elbow's trim of a
 * bend slide to the nearest clear spot on that straight; if a straight is
 * too short to clear its bends the part goes to its middle.
 */
export function placeOnRoute(route: readonly PipeSeg[], f: number): { seg: PipeSeg; t: number } | null {
  const total = route.reduce((n, s) => n + segLength(s), 0);
  if (route.length === 0 || total === 0) return null;
  let remaining = Math.min(Math.max(f, 0), 1) * total;
  let i = 0;
  while (i < route.length - 1 && remaining > segLength(route[i]!)) {
    remaining -= segLength(route[i]!);
    i += 1;
  }
  const seg = route[i]!;
  const len = segLength(seg);
  // A bend sits at a pipe end unless it is the route's own start / end.
  const lo = i === 0 ? 0 : ELBOW_RADIUS;
  const hi = len - (i === route.length - 1 ? 0 : ELBOW_RADIUS);
  const d = lo >= hi ? len / 2 : Math.min(Math.max(remaining, lo), hi);
  // Strictly inside, so the part stays hosted rather than becoming a joint.
  const t = Math.min(Math.max(d / len, 2 * ON_PIPE_EPS / len), 1 - 2 * ON_PIPE_EPS / len);
  return { seg, t };
}

/**
 * Re-seat `hosted` parts (attached to the old run's pipes) on the new route.
 * `oldChain` / `newRoute` are both oriented start to end. Rotation follows
 * the part's own offset from the pipe axis, so a yawed extension part keeps
 * its barrel along the pipe whichever way the new straight runs.
 */
export function carryHostedParts(
  hosted: readonly IsoPlacement[],
  oldChain: readonly PipeSeg[],
  newRoute: readonly PipeSeg[],
): IsoPlacement[] {
  return hosted.map((part) => {
    const index = oldChain.findIndex((s) => s.id === part.onPipe);
    const old = oldChain[index];
    const at = old ? positionOnPipe(old, part.x, part.y) : null;
    const target = index >= 0 && at !== null ? placeOnRoute(newRoute, fractionAlong(oldChain, index, at)) : null;
    if (!old || !target) return part; // cannot happen for validated parts; leave as is
    const { seg, t } = target;
    const x = round(seg.from.x + t * (seg.to.x - seg.from.x));
    const y = round(seg.from.y + t * (seg.to.y - seg.from.y));
    const turn = axisOf(seg) - axisOf(old);
    const next: IsoPlacement = { ...part, x, y, onPipe: seg.id, at: round(t) };
    if (turn !== 0) next.rotation = (part.rotation ?? 0) + turn;
    return next;
  });
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
