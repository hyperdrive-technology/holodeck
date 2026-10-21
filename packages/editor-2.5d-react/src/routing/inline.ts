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
import type { IsoPartDefinition } from '../registry/types';
import { ELBOW_RADIUS } from '../../assets/process/pipe-math';
import { headingOf } from './elbows';
import type { GridPoint, Heading } from './grid';

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

/** Split an oriented chain at fixed hosted parts, retaining original IDs for attachment lookup. */
export function splitChainAtParts(chain: readonly PipeSeg[], fixed: readonly IsoPlacement[]): PipeSeg[][] {
  const sections: PipeSeg[][] = [];
  let section: PipeSeg[] = [];
  for (const seg of chain) {
    const cuts = fixed
      .filter((part) => part.onPipe === seg.id)
      .map((part) => ({ part, at: positionOnPipe(seg, part.x, part.y) }))
      .filter((cut): cut is { part: IsoPlacement; at: number } => cut.at !== null)
      .sort((a, b) => a.at - b.at);
    let from = seg.from;
    for (const { part } of cuts) {
      const to = { x: part.x, y: part.y };
      if (from.x === to.x && from.y === to.y) continue;
      section.push({ ...seg, from, to });
      sections.push(section);
      section = [];
      from = to;
    }
    section.push({ ...seg, from, to: seg.to });
  }
  if (section.length > 0) sections.push(section);
  return sections;
}

/** Fraction (0..1) of the chain's total length at `t` along chain[index]. */
function fractionAlong(chain: readonly PipeSeg[], index: number, t: number): number {
  const total = chain.reduce((n, s) => n + segLength(s), 0);
  const before = chain.slice(0, index).reduce((n, s) => n + segLength(s), 0);
  return total === 0 ? 0 : (before + t * segLength(chain[index]!)) / total;
}

/**
 * Yaw (radians, `rotateHeading` convention: +90 deg turns east into north) of
 * travel along `s`; null for a diagonal or zero-length segment.
 */
function travelYaw(s: PipeSeg): number | null {
  const h = headingOf(s.to.x - s.from.x, s.to.y - s.from.y);
  return h === null ? null : yawOf(h);
}
const yawOf = (h: Heading) => ({ e: 0, n: Math.PI / 2, w: Math.PI, s: -Math.PI / 2 })[h];
/** Normalise to (-pi, pi] so a straight-through carry adds no rotation at all. */
function normaliseTurn(a: number): number {
  const turns = Math.round(a / (Math.PI / 2));
  const q = ((turns % 4) + 4) % 4; // 0..3 quarter turns
  return q === 3 ? -Math.PI / 2 : (q * Math.PI) / 2;
}

/** Default along-pipe body length (the built-in valve) and the extra clearance, in grid units. */
export const INLINE_PART_LENGTH = 0.6;
export const INLINE_PART_MARGIN = 0.1;
// Repeated 0.7-unit spacing can differ by a few ulps at an exact fit. This
// tolerance is far smaller than the attachment epsilon or the body margin.
const CLEARANCE_EPS = 1e-9;

/**
 * Along-pipe body length of an inline part (holodeck#54): the part's
 * `inlineLength` metadata when valid, else the longer side of its (unrotated)
 * footprint, which is conservative for any 1x1 part. Unknown parts are 1x1
 * like `footprint()`. Built-in valve and end cap declare 0.6.
 */
export function inlineBodyLength(
  def: Pick<IsoPartDefinition, 'footprint'> & Partial<Pick<IsoPartDefinition, 'inlineLength' | 'footprintOf'>> | undefined,
  placement?: IsoPlacement,
): number {
  const declared = def?.inlineLength;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared >= 0) return declared;
  const { w, h } = (placement && def?.footprintOf?.(placement)) ?? def?.footprint ?? { w: 1, h: 1 };
  const side = Math.max(w, h);
  return Number.isFinite(side) && side >= 0 ? side : 1;
}

/**
 * A straight of the route with the centre range left after the bends and the
 * retained endpoint bodies, BEFORE the carried part's own half-length and
 * margin (those differ per part, holodeck#54).
 */
interface RouteSpan {
  seg: PipeSeg;
  offset: number;
  lo: number;
  hi: number;
}

/** Along-route body lengths of retained parts centred at the two route ends. */
export interface EndpointBodies {
  start?: number;
  end?: number;
}

export interface CarryOptions {
  /** Along-pipe body length of a carried part (default `INLINE_PART_LENGTH`). See `inlineBodyLength`. */
  bodyLength?: (part: IsoPlacement) => number;
  /**
   * Land parts only where a click can hit them (holodeck#53): whole grid
   * nodes when every part fits on one, else half cells (the editor's click
   * snap). A route that is itself off the half-cell grid (hand-authored
   * 2-decimal pipes) has no such spot and keeps continuous placement.
   */
  snap?: boolean;
}

function routeSpans(route: readonly PipeSeg[], endpoints: EndpointBodies): RouteSpan[] {
  let offset = 0;
  return route.map((seg, i) => {
    const len = segLength(seg);
    const span = {
      seg,
      offset,
      lo: offset + (i === 0 ? (endpoints.start ?? 0) / 2 : ELBOW_RADIUS),
      hi: offset + len - (i === route.length - 1 ? (endpoints.end ?? 0) / 2 : ELBOW_RADIUS),
    };
    offset += len;
    return span;
  });
}

interface Spot {
  span: RouteSpan;
  /** Distance of the part centre from the route start. */
  distance: number;
  point: GridPoint;
}

const isMultiple = (v: number, q: number) => Math.abs(v / q - Math.round(v / q)) < CLEARANCE_EPS;

/**
 * Nearest legal centre for a part of half-length `half` inside [lo, hi];
 * ties use the earlier straight. `quantum` restricts centres to multiples of
 * it in world coordinates (axis-aligned straights only).
 */
function nearestSpot(
  spans: readonly RouteSpan[],
  half: number,
  desired: number,
  lo: number,
  hi: number,
  quantum?: number,
): Spot | null {
  let best: Spot | null = null;
  const clearance = half + INLINE_PART_MARGIN;
  for (const span of spans) {
    const a = Math.max(lo, span.lo + clearance);
    const b = Math.min(hi, span.hi - clearance);
    if (a > b + CLEARANCE_EPS) continue;
    const { seg, offset } = span;
    const len = segLength(seg);
    let spot: Spot;
    if (quantum === undefined) {
      const distance = Math.min(Math.max(desired, a), Math.max(a, b));
      const t = (distance - offset) / len;
      spot = { span, distance, point: { x: seg.from.x + t * (seg.to.x - seg.from.x), y: seg.from.y + t * (seg.to.y - seg.from.y) } };
    } else {
      const horizontal = seg.from.y === seg.to.y;
      const fixed = horizontal ? seg.from.y : seg.from.x;
      if (!isMultiple(fixed, quantum)) continue;
      const c0 = horizontal ? seg.from.x : seg.from.y;
      const sign = Math.sign((horizontal ? seg.to.x : seg.to.y) - c0);
      // World coordinate along the straight at a given route distance, and back.
      const coordAt = (d: number) => c0 + sign * (d - offset);
      const [ca, cb] = [coordAt(a - CLEARANCE_EPS), coordAt(b + CLEARANCE_EPS)];
      const kMin = Math.ceil(Math.min(ca, cb) / quantum);
      const kMax = Math.floor(Math.max(ca, cb) / quantum);
      if (kMin > kMax) continue;
      const k = Math.min(Math.max(Math.round(coordAt(Math.min(Math.max(desired, a), b)) / quantum), kMin), kMax);
      const coord = k * quantum + 0; // exact for quantum 1 and 0.5; `+ 0` drops -0
      const distance = offset + sign * (coord - c0);
      spot = { span, distance, point: horizontal ? { x: coord, y: fixed } : { x: fixed, y: coord } };
    }
    if (!best || Math.abs(spot.distance - desired) < Math.abs(best.distance - desired)) best = spot;
  }
  return best;
}

/** Nearest straight with clearance for one default-size part's entire body, or null if none fits. */
export function placeOnRoute(route: readonly PipeSeg[], f: number): { seg: PipeSeg; t: number } | null {
  const total = route.reduce((n, s) => n + segLength(s), 0);
  const target = nearestSpot(routeSpans(route, {}), INLINE_PART_LENGTH / 2, Math.min(Math.max(f, 0), 1) * total, 0, total);
  if (!target) return null;
  return { seg: target.span.seg, t: (target.distance - target.span.offset) / segLength(target.span.seg) };
}

/**
 * Jointly allocate ordered parts (half-lengths `halves`). A backward pass
 * reserves room for every later part; a forward pass picks the nearest
 * remaining position. Because each backward bound is itself a legal spot,
 * the forward pass can never run dry, with or without a quantum.
 */
function allocate(
  spans: readonly RouteSpan[],
  total: number,
  desired: readonly number[],
  halves: readonly number[],
  quantum?: number,
): Spot[] | null {
  const gap = (i: number, j: number) => halves[i]! + halves[j]! + INLINE_PART_MARGIN;
  const latest: number[] = [];
  let ceiling = total;
  for (let i = desired.length - 1; i >= 0; i -= 1) {
    const spot = nearestSpot(spans, halves[i]!, ceiling, 0, ceiling, quantum);
    if (!spot) return null;
    latest[i] = spot.distance;
    if (i > 0) ceiling = spot.distance - gap(i - 1, i);
  }
  const out: Spot[] = [];
  let floor = 0;
  for (let i = 0; i < desired.length; i += 1) {
    const spot = nearestSpot(spans, halves[i]!, desired[i]!, floor, latest[i]!, quantum);
    if (!spot) return null;
    out.push(spot);
    if (i + 1 < desired.length) floor = spot.distance + gap(i, i + 1);
  }
  return out;
}

/**
 * Allocate carried parts jointly, in their geometric order along the old run.
 * Fractions are preferred positions, subject to body/bend clearance and
 * per-part spacing (`opts.bodyLength`), optionally on clickable positions
 * (`opts.snap`). Each part keeps its yaw relative to the direction of travel,
 * so a directional part never comes out reversed (holodeck#57). Return null
 * when the new route cannot carry them all; callers must keep the old scene
 * rather than publish a partially reattached run.
 */
export function carryHostedParts(
  hosted: readonly IsoPlacement[],
  oldChain: readonly PipeSeg[],
  newRoute: readonly PipeSeg[],
  endpoints: EndpointBodies = {},
  opts: CarryOptions = {},
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
  const spans = routeSpans(newRoute, endpoints);
  const desired = ordered.map((o) => o.fraction * total);
  const halves = ordered.map((o) => {
    const len = opts.bodyLength?.(o.part) ?? INLINE_PART_LENGTH;
    return (Number.isFinite(len) && len >= 0 ? len : INLINE_PART_LENGTH) / 2;
  });

  // Snap only on routes whose straights are axis-aligned on the half-cell
  // grid; elsewhere no clickable spot exists, so keep continuous placement.
  const snappable = opts.snap === true && newRoute.every((s) =>
    (s.from.x === s.to.x || s.from.y === s.to.y) && [s.from.x, s.from.y, s.to.x, s.to.y].every((v) => isMultiple(v, 0.5)));
  const quanta: Array<number | undefined> = snappable ? [1, 0.5] : [undefined];
  let spots: Spot[] | null = null;
  for (const q of quanta) {
    spots = allocate(spans, total, desired, halves, q);
    if (spots) break;
  }
  if (!spots) return null;

  const out: IsoPlacement[] = [];
  for (const [i, { part, old, index }] of ordered.entries()) {
    const { span: { seg, offset }, distance, point } = spots[i]!;
    const t = (distance - offset) / segLength(seg);
    // Rotate by the change in TRAVEL direction, not pipe axis (holodeck#57).
    // Both chains are oriented from the same run start, so this preserves
    // which way the part faces relative to flow. Diagonal pipes (hand-authored) keep the yaw.
    const [from, to] = [travelYaw(old), travelYaw(seg)];
    const turn = from === null || to === null ? 0 : normaliseTurn(to - from);
    // Keep full precision: rounding centres independently can erode clearance.
    const next: IsoPlacement = { ...part, x: point.x, y: point.y, onPipe: seg.id, at: t };
    if (turn !== 0) next.rotation = (part.rotation ?? 0) + turn;
    out[index] = next;
  }
  return out;
}
