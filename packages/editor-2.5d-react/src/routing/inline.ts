/**
 * Inline parts that sit ON a pipe (holodeck#22). Pure.
 *
 * Design: a valve drawn on the middle of one long pipe records the pipe it
 * sits on with `onPipe: <pipe id>` and `at: <0..1 along that pipe, from its
 * (x, y) end to its (toX, toY) end>`. The pipe is NOT split. Reroute then
 * carries such parts along near the same fraction of the new route, with
 * clearance for their bodies and bends.
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

/** Along-pipe body length and extra clearance, in grid units. */
export const INLINE_PART_LENGTH = 0.6;
export const INLINE_PART_MARGIN = 0.1;
const PART_END_CLEARANCE = INLINE_PART_LENGTH / 2 + INLINE_PART_MARGIN;
const PART_SPACING = INLINE_PART_LENGTH + INLINE_PART_MARGIN;
// Repeated 0.7-unit spacing can differ by a few ulps at an exact fit. This
// tolerance is far smaller than the attachment epsilon or the body margin.
const CLEARANCE_EPS = 1e-9;

interface ClearSpan {
  seg: PipeSeg;
  offset: number;
  lo: number;
  hi: number;
}

/** Legal centre positions by distance from the route start, excluding bends and body overhang. */
function clearSpans(route: readonly PipeSeg[]): ClearSpan[] {
  let offset = 0;
  const spans: ClearSpan[] = [];
  route.forEach((seg, i) => {
    const len = segLength(seg);
    const lo = offset + PART_END_CLEARANCE + (i === 0 ? 0 : ELBOW_RADIUS);
    const hi = offset + len - PART_END_CLEARANCE - (i === route.length - 1 ? 0 : ELBOW_RADIUS);
    if (lo <= hi + CLEARANCE_EPS) spans.push({ seg, offset, lo: Math.min(lo, hi), hi });
    offset += len;
  });
  return spans;
}

/** Nearest legal centre inside the bounds; ties use the earlier straight. */
function nearestPosition(spans: readonly ClearSpan[], desired: number, lo: number, hi: number): { span: ClearSpan; distance: number } | null {
  let best: { span: ClearSpan; distance: number } | null = null;
  for (const span of spans) {
    const start = Math.max(lo, span.lo);
    const end = Math.min(hi, span.hi);
    if (start > end + CLEARANCE_EPS) continue;
    const bounded = Math.min(Math.max(desired, start), end);
    const distance = Math.min(Math.max(bounded, span.lo), span.hi);
    if (!best || Math.abs(distance - desired) < Math.abs(best.distance - desired)) {
      best = { span, distance };
    }
  }
  return best;
}

/** Nearest straight with clearance for one part's entire body, or null if none fits. */
export function placeOnRoute(route: readonly PipeSeg[], f: number): { seg: PipeSeg; t: number } | null {
  const total = route.reduce((n, s) => n + segLength(s), 0);
  const target = nearestPosition(clearSpans(route), Math.min(Math.max(f, 0), 1) * total, 0, total);
  if (!target) return null;
  return { seg: target.span.seg, t: (target.distance - target.span.offset) / segLength(target.span.seg) };
}

/**
 * Allocate carried parts jointly, in their geometric order along the old run.
 * Fractions are preferred positions, subject to body/bend clearance and spacing.
 * A backward pass reserves room for every later part; a forward pass picks the
 * nearest remaining position. This prevents both bend clamping collisions and
 * a late cluster failing when it could fit by shifting earlier parts upstream.
 * Return null when the new route cannot carry them all; callers must keep the
 * old scene rather than publish a partially reattached run.
 */
export function carryHostedParts(
  hosted: readonly IsoPlacement[],
  oldChain: readonly PipeSeg[],
  newRoute: readonly PipeSeg[],
): IsoPlacement[] | null {
  if (hosted.length === 0) return [];
  const ordered: Array<{ part: IsoPlacement; old: PipeSeg; fraction: number; index: number }> = [];
  for (const [index, part] of hosted.entries()) {
    const oldIndex = oldChain.findIndex((s) => s.id === part.onPipe);
    const old = oldChain[oldIndex];
    const at = old ? positionOnPipe(old, part.x, part.y) : null;
    if (!old || at === null) return null;
    ordered.push({ part, old, fraction: fractionAlong(oldChain, oldIndex, at), index });
  }
  ordered.sort((a, b) => a.fraction - b.fraction || a.index - b.index);
  const total = newRoute.reduce((n, s) => n + segLength(s), 0);
  const spans = clearSpans(newRoute);
  const latest: number[] = [];
  let ceiling = total;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const target = nearestPosition(spans, ceiling, 0, ceiling);
    if (!target) return null;
    latest[i] = target.distance;
    ceiling = target.distance - PART_SPACING;
  }

  const out: IsoPlacement[] = [];
  let floor = 0;
  for (const [i, { part, old, fraction, index }] of ordered.entries()) {
    const target = nearestPosition(spans, fraction * total, floor, latest[i]!);
    if (!target) return null;
    const { seg, offset } = target.span;
    const t = (target.distance - offset) / segLength(seg);
    const turn = axisOf(seg) - axisOf(old);
    // Keep full precision: rounding centres independently can erode clearance.
    const next: IsoPlacement = {
      ...part,
      x: seg.from.x + t * (seg.to.x - seg.from.x),
      y: seg.from.y + t * (seg.to.y - seg.from.y),
      onPipe: seg.id,
      at: t,
    };
    if (turn !== 0) next.rotation = (part.rotation ?? 0) + turn;
    out[index] = next;
    floor = target.distance + PART_SPACING;
  }
  return out;
}
