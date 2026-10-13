/**
 * Elbow orientation: which two pipe directions a 90 degree elbow joins, and
 * the `rotation` that makes it do so. Pure: no React, no three.
 *
 * CONVENTION (derived from the geometry, pinned in elbows.test.ts):
 *
 * - Grid compass as in `grid.ts`: n = -y, e = +x, s = +y, w = -x. Grid x is
 *   world X and grid y is world Z.
 * - An elbow's `rotation` is a TRUE yaw about world +Y (three.js right-hand
 *   rule), the same yaw every other part uses. Elbow.tsx and InstancedElbows
 *   both lay the quarter torus flat first (Rx(pi/2): local +X/+Y mouths become
 *   world +X/+Z), slide it `ELBOW_OFFSET` toward the inside of the L, and then
 *   apply the yaw. At rotation 0 the bend's two arms point to grid w and n
 *   (the torus sits in the -X/-Z quadrant of the corner).
 * - Yaw turns grid headings like `rotateHeading`: +90 deg maps w -> s and
 *   n -> w. So, per quarter turn:
 *
 *   | rotation | arms   |
 *   | -------- | ------ |
 *   | 0        | n + w  |
 *   | +pi/2    | s + w  |
 *   | pi       | s + e  |
 *   | -pi/2    | n + e  |
 *
 * An elbow's arms are the directions its two pipes LEAVE the elbow cell in
 * (e.g. a pipe from (4,8) to the elbow at (7,8) leaves the elbow going w).
 *
 * Scenes can opt out of hand-typed rotations: `params.bend = "auto"` on an
 * elbow makes `resolveAutoElbows` derive the rotation from the pipes whose
 * ENDS touch its cell (see `inferElbowRotation`). Numeric rotations keep
 * working unchanged; an elbow with neither is the legacy pipe-to-tank
 * "knuckle" collar.
 */

import type { IsoPlacement } from '../iso/scene';
import { HEADINGS, quarterTurns, type GridPoint, type Heading } from './grid';

/** Distance under which two grid coordinates are the same node (scenes use decimals like 16.8). */
export const NODE_EPSILON = 1e-6;

/** Arms at rotation 0. Every other rotation is this pair yawed by `rotateHeading`. */
export const ELBOW_REST_ARMS: readonly [Heading, Heading] = ['n', 'w'];

/** The table above, keyed by the two arms in `HEADINGS` order (n, e, s, w). */
const ROTATION_BY_ARMS: Readonly<Record<string, number>> = {
  'n,w': 0,
  's,w': Math.PI / 2,
  'e,s': Math.PI,
  'n,e': -Math.PI / 2,
};

const armsKey = (a: Heading, b: Heading) =>
  HEADINGS.indexOf(a) <= HEADINGS.indexOf(b) ? `${a},${b}` : `${b},${a}`;

/**
 * Axis-aligned heading of a grid vector, or null when it is zero-length or
 * diagonal (pipes are axis-aligned; a diagonal one has no elbow orientation).
 */
export function headingOf(dx: number, dy: number, eps = NODE_EPSILON): Heading | null {
  const ax = Math.abs(dx) > eps;
  const ay = Math.abs(dy) > eps;
  if (ax === ay) return null; // zero-length (neither) or diagonal (both)
  if (ax) return dx > 0 ? 'e' : 'w';
  return dy > 0 ? 's' : 'n';
}

/**
 * Rotation of the elbow whose arms are `a` and `b` (order does not matter).
 * Null when the two headings are equal or opposite: a straight run (or a
 * doubled-back pipe) needs no elbow.
 */
export function elbowRotationForArms(a: Heading, b: Heading): number | null {
  return ROTATION_BY_ARMS[armsKey(a, b)] ?? null;
}

/**
 * Inverse of `elbowRotationForArms`: the two arms of an elbow at `rotation`,
 * in `HEADINGS` order. Throws for a yaw that is not a whole quarter turn,
 * because such an elbow cannot meet grid pipes at all.
 */
export function elbowArms(rotation: number): [Heading, Heading] {
  if (!isQuarterTurn(rotation)) {
    throw new RangeError(`elbow rotation ${rotation} is not a multiple of pi/2`);
  }
  const t = ((quarterTurns(rotation) % 4) + 4) % 4;
  const entry = Object.entries(ROTATION_BY_ARMS).find(
    ([, r]) => ((quarterTurns(r) % 4) + 4) % 4 === t,
  )!;
  return entry[0].split(',') as [Heading, Heading];
}

/** True when `rotation` is a whole number of quarter turns (within 1e-6 rad). */
export function isQuarterTurn(rotation: number): boolean {
  return Number.isFinite(rotation) && Math.abs(rotation - quarterTurns(rotation) * (Math.PI / 2)) < 1e-6;
}

/** Same orientation modulo a full turn (pi/2 and -3pi/2 are equal). */
export function sameElbowRotation(a: number, b: number): boolean {
  return ((((quarterTurns(a) - quarterTurns(b)) % 4) + 4) % 4) === 0 && isQuarterTurn(a) && isQuarterTurn(b);
}

const isPipe = (o: IsoPlacement): o is IsoPlacement & { toX: number; toY: number } =>
  o.object === 'pipe' && typeof o.toX === 'number' && typeof o.toY === 'number';

const near = (a: number, b: number) => Math.abs(a - b) <= NODE_EPSILON;

export interface PipeArm {
  pipeId: string;
  /** Direction the pipe leaves `cell` in; null for a zero-length or diagonal pipe. */
  heading: Heading | null;
}

/**
 * Every pipe END that sits on `cell`, with the direction the pipe leaves it
 * in. Pipes merely passing through the cell (a tee onto a run's middle) are
 * not arms: an elbow only ever sits on pipe ends.
 */
export function pipeArmsAt(objects: readonly IsoPlacement[], cell: GridPoint): PipeArm[] {
  const arms: PipeArm[] = [];
  for (const p of objects) {
    if (!isPipe(p)) continue;
    if (near(p.x, cell.x) && near(p.y, cell.y)) {
      arms.push({ pipeId: p.id, heading: headingOf(p.toX - p.x, p.toY - p.y) });
    } else if (near(p.toX, cell.x) && near(p.toY, cell.y)) {
      arms.push({ pipeId: p.id, heading: headingOf(p.x - p.toX, p.y - p.toY) });
    }
  }
  return arms;
}

export type ElbowInferenceFailure =
  /** No pipe ends on the cell. */
  | 'no-pipes'
  /** One pipe end: a dead end / tank collar, not a bend. */
  | 'one-pipe'
  /** Two ends in the same or opposite direction: a straight joint needs no elbow. */
  | 'straight'
  /** Three or more ends: a tee or cross, which a 90 degree elbow cannot be. */
  | 'junction'
  /** A touching pipe is diagonal or zero-length. */
  | 'not-axis-aligned';

export type ElbowInference =
  | { ok: true; rotation: number; arms: [Heading, Heading] }
  | { ok: false; reason: ElbowInferenceFailure; arms: PipeArm[] };

/** Rotation for an elbow at `cell`, from the pipes whose ends touch it. */
export function inferElbowRotation(objects: readonly IsoPlacement[], cell: GridPoint): ElbowInference {
  const arms = pipeArmsAt(objects, cell);
  if (arms.length === 0) return { ok: false, reason: 'no-pipes', arms };
  if (arms.some((a) => a.heading === null)) return { ok: false, reason: 'not-axis-aligned', arms };
  if (arms.length === 1) return { ok: false, reason: 'one-pipe', arms };
  if (arms.length > 2) return { ok: false, reason: 'junction', arms };
  const a = arms[0]!.heading!;
  const b = arms[1]!.heading!;
  const rotation = elbowRotationForArms(a, b);
  if (rotation === null) return { ok: false, reason: 'straight', arms };
  const sorted = armsKey(a, b).split(',') as [Heading, Heading];
  return { ok: true, rotation, arms: sorted };
}

/** `params.bend` on an elbow: `"auto"` derives the rotation from the touching pipes. */
export const ELBOW_BEND_PARAM = 'bend';
export type ElbowBendMode = 'manual' | 'auto';
export const ELBOW_BEND_MODES: readonly ElbowBendMode[] = ['manual', 'auto'];

export function isAutoElbow(o: IsoPlacement): boolean {
  return o.object === 'elbow' && o.params?.[ELBOW_BEND_PARAM] === 'auto';
}

/**
 * Copy of `objects` with every auto elbow's `rotation` filled in from its
 * pipes. An auto elbow whose cell is not a clean L (see `ElbowInferenceFailure`)
 * gets no rotation, so it renders as a knuckle collar and `checkElbows`
 * reports it. Returns the input array itself when it has no auto elbows, so
 * memoised renderers see a stable reference.
 */
export function resolveAutoElbows<T extends IsoPlacement>(objects: readonly T[]): readonly T[] {
  if (!objects.some(isAutoElbow)) return objects;
  return objects.map((o) => {
    if (!isAutoElbow(o)) return o;
    const inferred = inferElbowRotation(objects, o);
    const next: T = { ...o };
    if (inferred.ok) next.rotation = inferred.rotation;
    else delete next.rotation;
    return next;
  });
}

export type ElbowIssueKind =
  /** Numeric rotation disagrees with the pipes: the bend points the wrong way. */
  | 'mismatch'
  /** Numeric rotation is not a quarter turn. */
  | 'not-right-angle'
  /** The pipes at the cell do not form an L (auto elbows, or bends with numeric rotation). */
  | 'unresolved';

export interface ElbowIssue {
  id: string;
  kind: ElbowIssueKind;
  message: string;
  /** Rotation the pipes call for, when they form an L. */
  expected?: number;
  actual?: number | 'auto';
}

/**
 * Every bend elbow (numeric rotation or `bend: "auto"`) that does not join
 * its two pipes. Knuckles (no rotation, not auto) are collars, not bends, and
 * are skipped. Empty means every bend in the scene is drawn correctly.
 */
export function checkElbows(objects: readonly IsoPlacement[]): ElbowIssue[] {
  const issues: ElbowIssue[] = [];
  for (const o of objects) {
    if (o.object !== 'elbow') continue;
    const auto = isAutoElbow(o);
    if (!auto && typeof o.rotation !== 'number') continue;
    const actual = auto ? ('auto' as const) : o.rotation!;
    if (!auto && !isQuarterTurn(o.rotation!)) {
      issues.push({ id: o.id, kind: 'not-right-angle', actual, message: `${o.id}: rotation ${o.rotation} is not a quarter turn` });
      continue;
    }
    const inferred = inferElbowRotation(objects, o);
    if (!inferred.ok) {
      const seen = inferred.arms.map((a) => `${a.pipeId}:${a.heading ?? '?'}`).join(', ') || 'none';
      issues.push({ id: o.id, kind: 'unresolved', actual, message: `${o.id} at (${o.x}, ${o.y}): ${inferred.reason} (pipe ends: ${seen})` });
      continue;
    }
    if (!auto && !sameElbowRotation(o.rotation!, inferred.rotation)) {
      issues.push({
        id: o.id,
        kind: 'mismatch',
        expected: inferred.rotation,
        actual,
        message: `${o.id} at (${o.x}, ${o.y}): rotation ${o.rotation} joins ${elbowArms(o.rotation!).join('+')}, pipes leave ${inferred.arms.join('+')} (want ${inferred.rotation})`,
      });
    }
  }
  return issues;
}
