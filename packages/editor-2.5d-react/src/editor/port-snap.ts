/**
 * Port snapping for drag-and-drop building. Pure.
 *
 * Dropping a part so one of its ports lands near a FREE pipe end (or moving
 * a pipe so its free end lands near a port) pulls the move the last bit so
 * the two coincide exactly. The pipe end is then attached by geometry
 * (routing/attach.ts infers it: on the port, leaving it outward), so the pipe
 * follows the part from then on. Only pairs that inference would accept are
 * offered: the pipe must leave the port in the port's outward direction.
 *
 * A free end: no attachment, no other pipe end at that point, not on another
 * pipe's body. Ends already attached never snap (they follow instead).
 */
import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import { isAttachTarget, isPipe, pipeEndPoint, portWorld, resolvePipeEnd, type PipeEndName } from '../routing/attach';
import { headingOf, pipeArmsAt } from '../routing/elbows';
import type { GridPoint, Heading } from '../routing/grid';
import { positionOnPipe, segOf } from '../routing/inline';
import type { IsoPartDefinition } from '../registry/types';

/** Largest pull (grid units, per axis) a port snap may add to a move. */
export const PORT_SNAP_RADIUS = 1;

export interface FreeEnd {
  pipeId: string;
  end: PipeEndName;
  point: GridPoint;
  /** Direction from the end into its pipe: a port must point this way to take it. */
  into: Heading;
}

/** Free pipe ends among `objects`, skipping pipes in `exclude`. */
export function freePipeEnds(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  exclude: ReadonlySet<string> = new Set(),
): FreeEnd[] {
  const pipes = objects.filter(isPipe);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const out: FreeEnd[] = [];
  for (const pipe of pipes) {
    if (exclude.has(pipe.id)) continue;
    for (const end of ['from', 'to'] as const) {
      const point = pipeEndPoint(pipe, end);
      const other = pipeEndPoint(pipe, end === 'from' ? 'to' : 'from');
      const into = headingOf(other.x - point.x, other.y - point.y);
      if (!into) continue;
      if (pipeArmsAt(pipes, point).length !== 1) continue;
      if (pipes.some((q) => q.id !== pipe.id && positionOnPipe(segOf(q), point.x, point.y) !== null)) continue;
      if (resolvePipeEnd(objects, registry, pipe, end, byId)) continue;
      out.push({ pipeId: pipe.id, end, point, into });
    }
  }
  return out;
}

/** World ports of a placement with their outward headings. */
function portsOf(part: IsoPlacement, registry: ContributionRegistry): Array<{ point: GridPoint; heading: Heading }> {
  if (!isAttachTarget(part, registry)) return [];
  return Object.keys(registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, part.object)?.ports ?? {})
    .map((name) => portWorld(part, registry, name))
    .filter((p): p is { point: GridPoint; heading: Heading } => p !== null);
}

/**
 * The extra offset that brings one of `moved` parts' ports onto a free end in
 * `ends` (or one of `movedEnds` onto a port of `fixedParts`), or null when no
 * pair is within `PORT_SNAP_RADIUS`. The nearest pair wins; ties keep scene
 * order. `moved` / `movedEnds` are already at the proposed position.
 */
export function portSnapOffset(
  moved: readonly IsoPlacement[],
  ends: readonly FreeEnd[],
  registry: ContributionRegistry,
  vice?: { movedEnds: readonly FreeEnd[]; fixedParts: readonly IsoPlacement[] },
): GridPoint | null {
  let best: { d: number; offset: GridPoint } | null = null;
  const consider = (from: GridPoint, to: GridPoint) => {
    const offset = { x: to.x - from.x, y: to.y - from.y };
    const d = Math.max(Math.abs(offset.x), Math.abs(offset.y));
    if (d > PORT_SNAP_RADIUS + 1e-9) return;
    if (!best || d < best.d - 1e-9) best = { d, offset };
  };
  for (const part of moved) {
    for (const port of portsOf(part, registry)) {
      for (const end of ends) if (end.into === port.heading) consider(port.point, end.point);
    }
  }
  if (vice) {
    for (const part of vice.fixedParts) {
      for (const port of portsOf(part, registry)) {
        for (const end of vice.movedEnds) if (end.into === port.heading) consider(end.point, port.point);
      }
    }
  }
  const found = best as { d: number; offset: GridPoint } | null;
  if (!found) return null;
  // `+ 0` drops -0 so callers can compare offsets with ===.
  return { x: found.offset.x + 0, y: found.offset.y + 0 };
}

/** Snapped coordinates land on authored values (2-decimal scenes): drop float noise like 0.39999999999999997. */
const tidy = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** Shift a placement (and its run end, if any) by an offset. */
function shifted(o: IsoPlacement, d: GridPoint): IsoPlacement {
  const next: IsoPlacement = { ...o, x: tidy(o.x + d.x), y: tidy(o.y + d.y) };
  if (typeof o.toX === 'number') next.toX = tidy(o.toX + d.x);
  if (typeof o.toY === 'number') next.toY = tidy(o.toY + d.y);
  return next;
}

/**
 * A new placement (palette drop / ghost) pulled onto a free pipe end when
 * one of its ports is within `PORT_SNAP_RADIUS`. `ends` defaults to every
 * free end in `objects`; pass a cached list for per-frame ghosts.
 */
export function snapNewPlacement(
  placement: IsoPlacement,
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  ends: readonly FreeEnd[] = freePipeEnds(objects, registry),
): IsoPlacement {
  const offset = portSnapOffset([placement], ends, registry);
  return offset && (offset.x !== 0 || offset.y !== 0) ? shifted(placement, offset) : placement;
}

/** What a move drag can snap to, computed once per drag (on its first frame). */
export interface MoveSnapTargets {
  /** Free ends of pipes that are not moving (a moving part's port may land on one). */
  ends: FreeEnd[];
  /** Free ends of moving pipes, at their start position (may land on a fixed port). */
  movedEnds: FreeEnd[];
  /** Non-moving placements whose ports can take a moving pipe end. */
  fixedParts: IsoPlacement[];
  /** Moving placements with ports, at their start position. */
  movingParts: IsoPlacement[];
}

export function moveSnapTargets(
  base: readonly IsoPlacement[],
  registry: ContributionRegistry,
  moving: ReadonlySet<string>,
  following: ReadonlySet<string>,
): MoveSnapTargets {
  const all = freePipeEnds(base, registry);
  return {
    ends: all.filter((e) => !moving.has(e.pipeId) && !following.has(e.pipeId)),
    movedEnds: all.filter((e) => moving.has(e.pipeId)),
    fixedParts: base.filter((o) => !moving.has(o.id) && !following.has(o.id) && isAttachTarget(o, registry)),
    movingParts: base.filter((o) => moving.has(o.id) && isAttachTarget(o, registry)),
  };
}

/** Delta (dx, dy) adjusted so a port and a free pipe end meet, when one pair is close enough. */
export function snapMoveDelta(targets: MoveSnapTargets, registry: ContributionRegistry, dx: number, dy: number): GridPoint {
  if (targets.ends.length === 0 && targets.movedEnds.length === 0) return { x: dx, y: dy };
  const d = { x: dx, y: dy };
  const offset = portSnapOffset(
    targets.movingParts.map((p) => shifted(p, d)),
    targets.ends,
    registry,
    { movedEnds: targets.movedEnds.map((e) => ({ ...e, point: { x: e.point.x + dx, y: e.point.y + dy } })), fixedParts: targets.fixedParts },
  );
  return offset ? { x: tidy(dx + offset.x), y: tidy(dy + offset.y) } : d;
}
