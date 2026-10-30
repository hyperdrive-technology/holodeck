/**
 * Pipe end attachments: which part (and port) each pipe end is connected to.
 * Pure. Drives "pipes follow a dragged vessel" (editor/follow.ts).
 *
 * Model: a pipe may record `attach: { from?: { object, port? }, to?: ... }`
 * (`from` = its (x, y) end, `to` = its (toX, toY) end). No `port` means the
 * part's centre: a bottom outlet (the cellar's fermenter branches) or an
 * inline valve / cap sitting on the pipe joint.
 *
 * Geometry wins, exactly like `onPipe` (inline.ts): a recorded attachment only
 * counts while the end really lies on that port, so a stale record (the part
 * was Alt-dragged away, an import moved things) is ignored instead of
 * teleporting anything. Ends WITHOUT a record are inferred from geometry, so
 * scenes written before this existed (core's brewery HMI) need no migration:
 *
 * - port: the end lies on the port's outward axis within
 *   `PORT_ATTACH_TOLERANCE` of the port point, and the pipe leaves the port
 *   outward. The tolerance absorbs hand-authored ends that stop at the wall
 *   surface rather than the footprint edge (brewery kettle r=0.65: port at
 *   16.5, pipe end at 16.8).
 * - centre: the end is at the part's centre (within 1e-3).
 *
 * Explicit records exist for what geometry cannot say: which of two
 * coincident ports a pipe uses, and a stable answer when two parts touch.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import type { IsoPipeAttach, IsoPipeEnds } from '../objects/validate';
import { isRunPlacement } from '../registry/geometry';
import type { IsoPartDefinition } from '../registry/types';
import { headingOf } from './elbows';
import { rotateHeading, rotateOffset, type GridPoint, type Heading } from './grid';
import { isFloorPart } from './occupancy';

export type PipeEndName = 'from' | 'to';

/** How far (grid units, along the port's outward axis) an end may sit from a port and still count as on it. */
export const PORT_ATTACH_TOLERANCE = 0.5;
/** Exact-position tolerance (centres, the port axis); scenes use 2-decimal coordinates. */
const EPS = 1e-3;

export interface ResolvedAttach {
  object: string;
  port?: string;
  /** Exact world point of the port (or the part centre). */
  point: GridPoint;
  /**
   * Outward direction from the part into the pipe: the port's (rotated)
   * `dir`, or at a centre attachment the pipe's own direction. Null for a
   * diagonal / zero-length pipe at a centre.
   */
  heading: Heading | null;
  /** True when it came from `pipe.attach`, false when inferred from geometry. */
  explicit: boolean;
}

export const isPipe = (o: IsoPlacement): boolean =>
  o.object === 'pipe' && typeof o.toX === 'number' && typeof o.toY === 'number';

export function pipeEndPoint(pipe: IsoPlacement, end: PipeEndName): GridPoint {
  return end === 'from' ? { x: pipe.x, y: pipe.y } : { x: pipe.toX!, y: pipe.toY! };
}

const partDef = (registry: ContributionRegistry, o: IsoPlacement) =>
  registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object);

/** Can a pipe end attach to this placement? Not pipes, elbows (joints), floor annotations, connectors or other run parts. */
export function isAttachTarget(o: IsoPlacement, registry: ContributionRegistry): boolean {
  if (o.object === 'pipe' || o.object === 'elbow') return false;
  const def = partDef(registry, o);
  if (isFloorPart(o.object, def) || def?.connector) return false;
  return !isRunPlacement(o, def);
}

/** World point and outward heading of `part`'s port `name` (null when the part has no such port). */
export function portWorld(
  part: IsoPlacement,
  registry: ContributionRegistry,
  name: string,
): { point: GridPoint; heading: Heading } | null {
  const port = partDef(registry, part)?.ports?.[name];
  if (!port) return null;
  const off = rotateOffset(port.x, port.y, part.rotation);
  return { point: { x: part.x + off.x, y: part.y + off.y }, heading: rotateHeading(port.dir, part.rotation) };
}

/** Distance along `heading` from `from` to `to`, and the perpendicular offset. */
function axisOffsets(from: GridPoint, to: GridPoint, heading: Heading): { along: number; across: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  switch (heading) {
    case 'e': return { along: dx, across: Math.abs(dy) };
    case 'w': return { along: -dx, across: Math.abs(dy) };
    case 's': return { along: dy, across: Math.abs(dx) };
    default: return { along: -dy, across: Math.abs(dx) };
  }
}

/**
 * Does the pipe end `end` (other end `other`) lie on `part`'s port `name`?
 * `strict` (inference) also requires the pipe to leave the port outward;
 * an explicit record only needs the end on the port.
 */
function matchPort(
  part: IsoPlacement,
  registry: ContributionRegistry,
  name: string,
  end: GridPoint,
  other: GridPoint,
  strict: boolean,
): (ResolvedAttach & { gap: number }) | null {
  const port = portWorld(part, registry, name);
  if (!port) return null;
  const { along, across } = axisOffsets(port.point, end, port.heading);
  if (across > EPS || Math.abs(along) > PORT_ATTACH_TOLERANCE + EPS) return null;
  if (strict && headingOf(other.x - end.x, other.y - end.y) !== port.heading) return null;
  return { object: part.id, port: name, point: port.point, heading: port.heading, explicit: !strict, gap: Math.abs(along) };
}

function matchCentre(part: IsoPlacement, end: GridPoint, other: GridPoint, explicit: boolean): ResolvedAttach | null {
  if (Math.abs(end.x - part.x) > EPS || Math.abs(end.y - part.y) > EPS) return null;
  return { object: part.id, point: { x: part.x, y: part.y }, heading: headingOf(other.x - end.x, other.y - end.y), explicit };
}

/** Best inferred attachment of `end` on `part`: nearest port (declaration order breaks ties), else the centre. */
function inferOn(part: IsoPlacement, registry: ContributionRegistry, end: GridPoint, other: GridPoint): ResolvedAttach | null {
  let best: (ResolvedAttach & { gap: number }) | null = null;
  for (const name of Object.keys(partDef(registry, part)?.ports ?? {})) {
    const hit = matchPort(part, registry, name, end, other, true);
    if (hit && (!best || hit.gap < best.gap - EPS)) best = hit;
  }
  if (best) {
    const { gap: _gap, ...out } = best;
    return out;
  }
  return matchCentre(part, end, other, false);
}

/** Validate an explicit record against geometry; null when stale (wrong place, unknown part / port). */
function explicitAttach(
  rec: IsoPipeAttach,
  byId: ReadonlyMap<string, IsoPlacement>,
  registry: ContributionRegistry,
  end: GridPoint,
  other: GridPoint,
): ResolvedAttach | null {
  const part = byId.get(rec.object);
  if (!part || !isAttachTarget(part, registry)) return null;
  if (rec.port === undefined) return matchCentre(part, end, other, true);
  const hit = matchPort(part, registry, rec.port, end, other, false);
  if (!hit) return null;
  const { gap: _gap, ...out } = hit;
  return { ...out, explicit: true };
}

/**
 * What the `end` of `pipe` is attached to: its valid explicit record, else
 * the part it geometrically lies on (later placements win, like
 * `resolveRouteEnd`, because they draw on top). Null = a free end, a joint
 * with other pipes, or a tee.
 *
 * `byId` lets callers resolving many ends share one index.
 */
export function resolvePipeEnd(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  pipe: IsoPlacement,
  end: PipeEndName,
  byId: ReadonlyMap<string, IsoPlacement> = new Map(objects.map((o) => [o.id, o])),
): ResolvedAttach | null {
  if (!isPipe(pipe)) return null;
  const at = pipeEndPoint(pipe, end);
  const other = pipeEndPoint(pipe, end === 'from' ? 'to' : 'from');
  const rec = pipe.attach?.[end];
  if (rec) {
    const hit = explicitAttach(rec, byId, registry, at, other);
    if (hit) return hit;
  }
  for (let i = objects.length - 1; i >= 0; i -= 1) {
    const part = objects[i]!;
    if (part.id === pipe.id || !isAttachTarget(part, registry)) continue;
    const hit = inferOn(part, registry, at, other);
    if (hit) return hit;
  }
  return null;
}

/** One pipe end attached to a given part. */
export interface AttachedEnd {
  pipe: IsoPlacement;
  end: PipeEndName;
  attach: ResolvedAttach;
}

/**
 * Every pipe end attached to one of `partIds`. Pipes in `partIds` themselves
 * are skipped (they move as selected objects). O(pipes x objects) in the worst
 * case, but only ends near a candidate part pay the full resolution.
 */
export function endsAttachedTo(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  partIds: ReadonlySet<string>,
): AttachedEnd[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const parts = [...partIds].map((id) => byId.get(id)).filter((o): o is IsoPlacement => !!o && isAttachTarget(o, registry));
  if (parts.length === 0) return [];
  // Cheap pre-filter: an end can only be on a part within its bounding radius
  // (largest port offset + tolerance). Avoids resolving every end in big scenes.
  const reach = parts.map((part) => {
    const ports = Object.values(partDef(registry, part)?.ports ?? {});
    const r = Math.max(0, ...ports.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
    return { part, r: r + PORT_ATTACH_TOLERANCE + EPS };
  });
  const near = (pt: GridPoint) =>
    reach.some(({ part, r }) => Math.abs(pt.x - part.x) <= r && Math.abs(pt.y - part.y) <= r);
  const out: AttachedEnd[] = [];
  for (const pipe of objects) {
    if (!isPipe(pipe) || partIds.has(pipe.id)) continue;
    for (const end of ['from', 'to'] as const) {
      const pt = pipeEndPoint(pipe, end);
      if (!near(pt)) continue;
      const attach = resolvePipeEnd(objects, registry, pipe, end, byId);
      if (attach && partIds.has(attach.object)) out.push({ pipe, end, attach });
    }
  }
  return out;
}

/** The record to store for a resolved attachment. */
export function attachRecord(a: Pick<ResolvedAttach, 'object' | 'port'>): IsoPipeAttach {
  return a.port === undefined ? { object: a.object } : { object: a.object, port: a.port };
}

/**
 * Copy of `pipe` with `attach[end]` set (or removed when `rec` is null). An
 * empty `attach` is dropped so untouched pipes round-trip without noise.
 */
export function withPipeAttach(pipe: IsoPlacement, end: PipeEndName, rec: IsoPipeAttach | null): IsoPlacement {
  const ends: IsoPipeEnds = { ...pipe.attach };
  if (rec) ends[end] = rec;
  else delete ends[end];
  const { attach: _attach, ...rest } = pipe;
  return ends.from || ends.to ? { ...rest, attach: ends } : rest;
}

/**
 * Remove every attach record that points at an id for which `gone` holds
 * (the part was deleted, or not copied with the pipe). Returns the same
 * object when nothing changed.
 */
export function detachPipeEnds(pipe: IsoPlacement, gone: (id: string) => boolean): IsoPlacement {
  const a = pipe.attach;
  if (!a) return pipe;
  let next = pipe;
  for (const end of ['from', 'to'] as const) {
    const rec = a[end];
    if (rec && gone(rec.object)) next = withPipeAttach(next, end, null);
  }
  return next;
}

/** `pipe` with attach records renamed through `idMap` (paste); records to ids outside the map are dropped. */
export function remapPipeEnds(pipe: IsoPlacement, idMap: ReadonlyMap<string, string>): IsoPlacement {
  const a = pipe.attach;
  if (!a) return pipe;
  let next = pipe;
  for (const end of ['from', 'to'] as const) {
    const rec = a[end];
    if (!rec) continue;
    const id = idMap.get(rec.object);
    next = withPipeAttach(next, end, id ? { ...rec, object: id } : null);
  }
  return next;
}
