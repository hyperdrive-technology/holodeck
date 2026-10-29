/**
 * Pipes follow a moved part (drag-and-drop building). Pure.
 *
 * `planFollow` runs once when a move starts: it finds every pipe end attached
 * to a moving part (routing/attach.ts: explicit `attach` records or inferred
 * from geometry), the run each belongs to (routing/run.ts `findRun`) and how
 * that run should respond:
 *
 * - `translate`: both run ends move with the selection (a pipe between two
 *   selected vessels), or the far end is a free stub. The run and the parts
 *   hosted on it shift by the same delta; nothing is re-routed.
 * - `reroute`: one end moves, the other is fixed (another vessel's port, a
 *   valve on a joint, a tee). The run is re-planned between the moved end
 *   and the fixed one with the shared replan.ts (A*, inline parts carried,
 *   port headings kept, ids and fields preserved).
 *
 * Runs that contain a selected member are the user's own move and are left
 * alone, as are runs whose attached end is not a run end (two pipes meeting
 * on one port). A run with any member, or hosted part, on a locked or hidden
 * layer makes the whole move refuse (holodeck#122): replacing it would
 * silently move a locked pipe.
 *
 * `applyFollow` runs per pointer frame with the snapped delta and returns the
 * whole scene for that frame plus the runs that could not be routed there
 * (with a ghost path for the preview). Every frame starts from the scene as it
 * was when the move began, so a frame never builds on another frame's routes.
 */
import type { ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import { attachRecord, endsAttachedTo, isPipe, pipeEndPoint, resolvePipeEnd, withPipeAttach, type AttachedEnd, type ResolvedAttach } from '../routing/attach';
import type { RouteOptions } from '../routing/astar';
import { headingOf, pipeArmsAt } from '../routing/elbows';
import type { GridPoint, Heading } from '../routing/grid';
import { findHostPipe, positionOnPipe, segOf, withAttachment } from '../routing/inline';
import { findRun, isInlinePart, type PipeRun } from '../routing/run';
import { moveBy } from './arrange';
import { manhattanRoute } from './routing';
import { hostedOnRun, replanRun, type RunEndSpec } from './replan';
import { sameCell } from './snap';

/** Shown while (and after) a drop position leaves an attached pipe with no clear route. */
export const FOLLOW_BLOCKED_NOTICE = 'No clear route for an attached pipe here — Alt-drag moves the part alone';
/** Shown while the route exists but the parts riding on the pipe do not fit its straights. */
export const FOLLOW_PARTS_NOTICE = 'Valves / pumps on an attached pipe do not fit the route here — Alt-drag moves the part alone';

/** The notice for a frame with blocked runs. */
export function blockedNotice(blocked: readonly BlockedRun[]): string {
  const identity = blocked.find((b) => b.reason === 'identity');
  if (identity?.notice) return identity.notice;
  return blocked.every((b) => b.reason === 'inline') ? FOLLOW_PARTS_NOTICE : FOLLOW_BLOCKED_NOTICE;
}

/** Notices a drag frame sets (cleared again when a frame routes, on drop or Esc). */
export function isFollowFrameNotice(notice: string | null): boolean {
  return notice === FOLLOW_BLOCKED_NOTICE || notice === FOLLOW_PARTS_NOTICE || notice === FOLLOW_LOCKED_NOTICE
    || (notice !== null && notice.includes('this route would remove it'));
}
/** Drop at an unroutable spot: the move lands on the last position every pipe could follow. */
export const FOLLOW_SNAPPED_NOTICE = 'Pipes could not follow to that spot — dropped at the last position they could reach';
/** Drop at an unroutable spot with no earlier routable position: nothing moved. */
export const FOLLOW_CANCELLED_NOTICE = 'Pipes could not follow to that spot — move cancelled (Alt-drag moves the part alone)';
/** A pipe attached to the moved part is on a locked or hidden layer. */
export const FOLLOW_LOCKED_NOTICE = 'Move rejected — an attached pipe is on a locked or hidden layer (Alt-drag moves the part alone)';

/**
 * Interactive search budget per run and frame. The default 200k is the
 * safety valve for an explicit Reroute; a drag frame must stay well under a
 * frame budget, and a route that needs more than this many expansions is
 * reported as unroutable instead (the user can drop elsewhere or press R).
 * An empty 200x200 grid with a far target needs < 5k (astar.test.ts).
 */
export const FOLLOW_MAX_EXPANSIONS = 30_000;

export interface FollowEnd {
  /** Exact end point in the base scene. */
  point: GridPoint;
  /** Outward heading from the end into the run (port dir, or the old pipe direction). */
  heading?: Heading;
  attach: ResolvedAttach | null;
  /** The end rides with the selection (attached to a moving part). */
  moves: boolean;
}

export interface FollowRun {
  run: PipeRun;
  mode: 'translate' | 'reroute';
  start: FollowEnd;
  end: FollowEnd;
  /** Parts riding on the run, plus (translate) a stub's terminal fitting: moved with a translated run. */
  hosted: string[];
}

export interface FollowPlan {
  moving: ReadonlySet<string>;
  runs: FollowRun[];
  /**
   * Pipe ends attached to a moving part, in the REAL base scene (before any
   * tee split): Alt-drag frames start from that base, so this is the list
   * whose records they drop.
   */
  attached: AttachedEnd[];
  /** Some affected run is on a locked / hidden layer: the move must refuse. */
  locked: boolean;
  /**
   * The scene frames start from when it differs from the drag's base: pipes
   * split at mid-pipe tees (`splitAtMidTees`). Absent = the base itself.
   */
  base?: IsoPlacement[];
}

/** A run that could not follow at this frame, with the straight-L ghost to draw. */
export interface BlockedRun {
  ids: string[];
  points: GridPoint[];
  /** `inline`: a route exists but the valves / pumps riding on the run do not fit it. */
  reason: 'no-route' | 'inline' | 'locked' | 'retained' | 'identity';
  /** Reason text from the planner (e.g. which pipe would lose its data). */
  notice?: string;
}

const sameRunEnd = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;

/** The run pipe whose end lies at `point`, and which end it is. */
function terminalAt(pipes: readonly IsoPlacement[], point: GridPoint): { pipe: IsoPlacement; end: 'from' | 'to' } | null {
  for (const pipe of pipes) {
    if (sameRunEnd(pipeEndPoint(pipe, 'from'), point)) return { pipe, end: 'from' };
    if (sameRunEnd(pipeEndPoint(pipe, 'to'), point)) return { pipe, end: 'to' };
  }
  return null;
}

/** No other pipe ends at or passes through `point`: a dangling stub. */
function isFreeEnd(objects: readonly IsoPlacement[], point: GridPoint, self: string): boolean {
  const pipes = objects.filter((o) => isPipe(o) && o.id !== self);
  if (pipeArmsAt(pipes, point).length > 0) return false;
  return !pipes.some((p) => positionOnPipe(segOf(p), point.x, point.y) !== null);
}

export function planFollow(
  original: IsoPlacement[],
  registry: ContributionRegistry,
  moving: ReadonlySet<string>,
  editable: (o: IsoPlacement) => boolean,
): FollowPlan {
  const originalAttached = endsAttachedTo(original, registry, moving);
  // A branch teed into the MIDDLE of an attached run (cellar glycol header)
  // pins that point: split the pipe there so the run ends at the tee and the
  // far side, with its branch, stays exactly where it is.
  const objects = splitAtMidTees(original, registry, originalAttached, moving);
  const split = objects !== original;
  // PR #212 review (P2): splitting rewrites the split pipes and the riders
  // re-attached to a new piece, including riders on the far, stationary side
  // that the run's own lock check never sees. Every placement the split
  // changes must be editable, or the move refuses like any locked run.
  let splitLocked = false;
  if (split) {
    const after = new Map(objects.map((o) => [o.id, o]));
    splitLocked = original.some((o) => after.get(o.id) !== o && !editable(o));
  }
  const attached = split ? endsAttachedTo(objects, registry, moving) : originalAttached;
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const runs: FollowRun[] = [];
  let locked = splitLocked;
  for (const { pipe } of attached) {
    if (seen.has(pipe.id)) continue;
    const run = findRun(objects, pipe.id, registry);
    if (!run) continue;
    for (const id of run.ids) seen.add(id);
    // The user is dragging part of this run already: their move, not ours.
    if (run.ids.some((id) => moving.has(id))) continue;
    const pipes = run.ids.map((id) => byId.get(id)!).filter(isPipe);
    const endInfo = (point: GridPoint, fallbackHeading: Heading | undefined): FollowEnd | null => {
      const t = terminalAt(pipes, point);
      if (!t) return null;
      const attach = resolvePipeEnd(objects, registry, t.pipe, t.end, byId);
      const other = pipeEndPoint(t.pipe, t.end === 'from' ? 'to' : 'from');
      const heading = attach?.heading ?? fallbackHeading ?? headingOf(other.x - point.x, other.y - point.y) ?? undefined;
      return { point, heading, attach, moves: attach !== null && moving.has(attach.object) };
    };
    const start = endInfo(run.start, run.startHeading);
    const end = endInfo(run.end, run.endHeading);
    // A moving part whose pipe is not a run end (two pipes on one port): leave it.
    if (!start || !end || (!start.moves && !end.moves)) continue;
    const riders = hostedOnRun(objects, registry, new Set(run.ids), true);
    // A part riding on the run is itself selected: the user moves it, leave the run.
    if (riders.some((o) => moving.has(o.id))) continue;
    const hosted = riders.map((o) => o.id);
    // A stub: the far end touches no other pipe and at most a terminal fitting
    // (an end cap or valve that nothing else connects to). It is part of the
    // vessel's own pipework, so it rides along rigidly with its fitting.
    const stubFitting = (e: FollowEnd): string[] | null => {
      if (e.moves || !isFreeEnd(objects, e.point, terminalAt(pipes, e.point)!.pipe.id)) return null;
      if (e.attach === null) return [];
      const part = byId.get(e.attach.object);
      return part && isInlinePart(part, registry) && pipeArmsAt(objects, { x: part.x, y: part.y }).length === 1 ? [part.id] : null;
    };
    const stub = stubFitting(start) ?? stubFitting(end);
    const mode = (start.moves && end.moves) || stub !== null ? 'translate' : 'reroute';
    const carry = mode === 'translate' ? [...hosted, ...(stub ?? [])] : hosted;
    if ([...run.ids, ...carry].some((id) => !editable(byId.get(id)!))) locked = true;
    runs.push({ run, mode, start, end, hosted: carry });
  }
  return { moving, runs, attached: originalAttached, locked, ...(split ? { base: objects } : {}) };
}

/**
 * Split every pipe of a run attached to a moving part where a pipe outside
 * the run ends strictly inside it (a tee without a joint). Returns the same
 * array when there is nothing to split. The piece containing the pipe's
 * (x, y) end keeps its id and every field; later pieces get fresh ids and the
 * pipe's non-identity fields. Parts riding on a split pipe re-attach to the
 * piece they lie on.
 */
export function splitAtMidTees(
  objects: IsoPlacement[],
  registry: ContributionRegistry,
  attached: readonly AttachedEnd[],
  moving: ReadonlySet<string>,
  nextId: (prefix: string, objects: readonly IsoPlacement[]) => string = defaultNextId,
): IsoPlacement[] {
  const runPipeIds = new Set<string>();
  for (const { pipe } of attached) {
    if (runPipeIds.has(pipe.id)) continue;
    const run = findRun(objects, pipe.id, registry);
    if (!run || run.ids.some((id) => moving.has(id))) continue;
    for (const id of run.ids) runPipeIds.add(id);
  }
  const cuts = new Map<string, number[]>();
  const pipes = objects.filter(isPipe);
  for (const p of pipes) {
    if (!runPipeIds.has(p.id)) continue;
    const seg = segOf(p);
    for (const q of pipes) {
      // Only pipes outside the runs pin a point (a run's own joints are its ends).
      if (runPipeIds.has(q.id)) continue;
      for (const pt of [pipeEndPoint(q, 'from'), pipeEndPoint(q, 'to')]) {
        const t = positionOnPipe(seg, pt.x, pt.y);
        if (t !== null) cuts.set(p.id, [...(cuts.get(p.id) ?? []), t]);
      }
    }
  }
  if (cuts.size === 0) return objects as IsoPlacement[];
  const out: IsoPlacement[] = [];
  const all: IsoPlacement[] = [...objects];
  const pieceIds = new Map<string, string[]>();
  for (const o of objects) {
    const ts = cuts.get(o.id);
    if (!ts) {
      out.push(o);
      continue;
    }
    const sorted = [...new Set(ts)].sort((a, b) => a - b);
    const from = { x: o.x, y: o.y };
    const to = { x: o.toX!, y: o.toY! };
    const at = (t: number) => ({ x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) });
    const stops = [...sorted.map(at), to];
    let prev = from;
    const ids: string[] = [];
    stops.forEach((stop, i) => {
      const first = i === 0;
      const lastPiece = i === stops.length - 1;
      let piece: IsoPlacement;
      if (first) {
        piece = { ...o, toX: stop.x, toY: stop.y };
      } else {
        const { meta: _m, metaHidden: _mh, bindings: _b, extensions: _e, animation: _a, ...shared } = o;
        piece = { ...shared, id: nextId('pipe', all), x: prev.x, y: prev.y, toX: stop.x, toY: stop.y };
        all.push(piece);
      }
      // The `from` record belongs to the first piece, the `to` record to the last.
      if (!first) piece = withPipeAttach(piece, 'from', null);
      if (!lastPiece) piece = withPipeAttach(piece, 'to', null);
      else if (o.attach?.to) piece = withPipeAttach(piece, 'to', o.attach.to);
      ids.push(piece.id);
      out.push(piece);
      prev = stop;
    });
    pieceIds.set(o.id, ids);
  }
  // Riders of a split pipe move to the piece they lie inside.
  return out.map((o) => {
    if (!o.onPipe || !pieceIds.has(o.onPipe)) return o;
    const pieces = out.filter((p) => pieceIds.get(o.onPipe!)!.includes(p.id));
    const host = findHostPipe(pieces, o.x, o.y);
    if (host) return { ...o, ...host };
    const { onPipe: _p, at: _at, ...rest } = o;
    return rest;
  });
}

const defaultNextId = (prefix: string, objects: readonly IsoPlacement[]) => {
  const ids = new Set(objects.map((o) => o.id));
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
};

/** Does this plan move any pipe at all? (Deltas snap to whole cells when it does.) */
export function followsAnything(plan: FollowPlan | null): boolean {
  return plan !== null && plan.runs.length > 0;
}

export interface FollowFrame {
  objects: IsoPlacement[];
  blocked: BlockedRun[];
}

/**
 * The scene for one move frame: `moving` shifted by (dx, dy), translate runs
 * shifted with them, reroute runs re-planned in plan order (each sees the
 * ones before it as obstacles). With `detach` (Alt) only the moving parts
 * move, and pipe ends recorded as attached to them are freed.
 */
export function applyFollow(
  base: readonly IsoPlacement[],
  registry: ContributionRegistry,
  plan: FollowPlan,
  dx: number,
  dy: number,
  opts: {
    editable: (o: IsoPlacement) => boolean;
    nextId: (prefix: string, objects: readonly IsoPlacement[]) => string;
    detach?: boolean;
    route?: RouteOptions;
    /** Moving single-node parts, if the caller already knows (drag-start computes it once). */
    inline?: ReadonlySet<string>;
  },
): FollowFrame {
  if (dx === 0 && dy === 0) return { objects: [...base], blocked: [] };
  // Split pipes only exist while pipes follow; Alt-drags start from the real base.
  if (!opts.detach && plan.base) base = plan.base;
  const shift = new Set(plan.moving);
  if (!opts.detach) {
    for (const r of plan.runs) if (r.mode === 'translate') for (const id of [...r.run.ids, ...r.hosted]) shift.add(id);
  }
  let objects = base.map((o) => (shift.has(o.id) ? moveBy(o, dx, dy) : o));
  const blocked: BlockedRun[] = [];
  if (opts.detach) {
    // Alt: the part leaves its pipes behind; drop the records that named it.
    const freed = new Map<string, Array<'from' | 'to'>>();
    for (const a of plan.attached) if (a.attach.explicit) freed.set(a.pipe.id, [...(freed.get(a.pipe.id) ?? []), a.end]);
    objects = objects.map((o) => {
      const ends = freed.get(o.id);
      return ends ? ends.reduce((p, end) => withPipeAttach(p, end, null), o) : o;
    });
  } else {
    for (const r of plan.runs) {
      if (r.mode !== 'reroute') continue;
      const spec = (e: FollowEnd): RunEndSpec => ({
        point: e.moves ? { x: e.point.x + dx, y: e.point.y + dy } : e.point,
        heading: e.heading,
        attach: e.attach ? attachRecord(e.attach) : undefined,
      });
      const start = spec(r.start);
      const end = spec(r.end);
      const result = replanRun(objects, registry, r.run, {
        editable: opts.editable,
        ends: { start, end },
        keepIds: true,
        inferHosted: true,
        strict: true,
        route: { maxExpansions: FOLLOW_MAX_EXPANSIONS, ...opts.route },
        nextId: opts.nextId,
      });
      if (result.ok) {
        objects = result.objects;
      } else {
        const { pipes, elbow } = manhattanRoute(start.point, end.point);
        const points = pipes.length === 0 ? [] : elbow ? [start.point, elbow, end.point] : [start.point, end.point];
        blocked.push({ ids: r.run.ids, points, reason: result.reason, notice: result.notice });
      }
    }
  }
  // Moved inline parts re-attach to whatever pipe they now sit inside (as a plain drag does).
  const ids = opts.inline ?? new Set([...plan.moving].filter((id) => {
    const o = objects.find((p) => p.id === id);
    return o !== undefined && isInlinePart(o, registry);
  }));
  if (ids.size) {
    const settled = objects;
    objects = objects.map((o) => (ids.has(o.id) ? withAttachment(o, settled) : o));
  }
  return { objects, blocked };
}

/** Same placements, same order, same values? (A frame that changed nothing must not commit.) */
export function sameObjects(a: readonly IsoPlacement[], b: readonly IsoPlacement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((o, i) => o === b[i] || JSON.stringify(o) === JSON.stringify(b[i]));
}

export { sameCell };
