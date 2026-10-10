import type { Vector3Tuple } from 'three';
import { HOLODECK_STYLE } from './style';

/**
 * Arcentry tubes are fat: ~0.4 of a grid cell across (round 2: r = 0.2, the reference still read slightly fatter than 0.18;
 * 0.15 read thin), low-poly 8-gons so EdgesGeometry draws the longitudinal facets as the wire mesh.
 * (Was 0.11, which read as a thin double line.)
 */
export const PIPE_RADIUS = 0.2;
/** Pre-fat-pipe radius. West nipple ring multiples were tuned against it. */
export const LEGACY_PIPE_RADIUS = 0.11;
export const PIPE_SIDES = 6; // round 3 trial: 8 -> 6
/** Interior joint rings sit about this far apart (grid cells): the periodic segment joints in the reference. */
export const PIPE_RING_SPACING = 1;
/**
 * Joint bump radius as a multiple of the pipe radius. Round 2: the reference joints are a single wire crease
 * barely proud of the tube, so the step is only 3% (was 1.12 / 0.05). Round 3: the bump is a bi-conical swell in
 * the pipe surface (no 90° end caps), so exactly one crest line draws per joint.
 */
export const PIPE_RING_SCALE = 1.03;
export const PIPE_RING_LEN = 0.03;
/**
 * Crease angle (degrees) at the foot and crest of the bi-conical joint bump built by buildPipeGeometry.
 * The pipe threshold must sit between them (foot < threshold < crest) so one line draws per joint.
 */
export const PIPE_RING_FOOT_DEG = (Math.atan((PIPE_RADIUS * (PIPE_RING_SCALE - 1)) / (PIPE_RING_LEN / 2)) * 180) / Math.PI;
export const PIPE_RING_CREST_DEG = 2 * PIPE_RING_FOOT_DEG;
/** End flange ring (the stub-end collar), multiple of pipe radius / absolute length. */
export const PIPE_FLANGE_SCALE = 1.32;
export const PIPE_FLANGE_LEN = 0.07;
/** Elbow tube cross-section sides (match PIPE_SIDES so facets line up with the pipe) and sweep steps. */
export const ELBOW_RADIAL = 8;
/**
 * 90° / 8 = 11.25° per sweep step (round 2; was 6 steps = 15°). The sweep
 * joints only show as outline creases when style.edges.thresholds.elbow is
 * below 11.25°.
 */
export const ELBOW_SWEEP = 8;
/** West packaging mouth (`pipe-packaging-end`). r-west is a hex nipple, not an 8-gon sleeve. */
export const WEST_NIPPLE_ID = 'pipe-packaging-end';
export const WEST_NIPPLE_SIDES = 6;
/** Local-Y roll after pipe YXZ lay-down so a hex face sits iso-up (one 60° step). */
export const WEST_NIPPLE_ROLL = Math.PI / 6;
/**
 * West mouth hex nut (r-west ridges). Scaled 8-gon washers and thin 6-gon
 * pancakes both read as round discs at REFERENCE_ZOOM; a short prism shows
 * side faces like the steam coupling without the rejected 0.40 sleeve barrel.
 * 0.30×0.36 read as a bolt in o-west vs r-west’s compact ridge stack.
 */
export const WEST_NUT_R = 0.24;
export const WEST_NUT_LEN = 0.26;
/** Hex ridges around the west nut. 2.9–3.4 flared into a trumpet in o-west. */
export const WEST_RING_RADIAL = [2.28, 2.42, 2.52].map(
  (m) => (m * LEGACY_PIPE_RADIUS) / PIPE_RADIUS,
) as unknown as readonly [number, number, number]; // keep the absolute ring size when the pipe got fatter
/** Along-pipe length. 0.08–0.10 pancakes aliased to round discs vs r-west hex ridge stack. */
export const WEST_RING_LEN = [0.11, 0.12, 0.13] as const;
/** Alias of `HOLODECK_STYLE.edges.thresholds.westRing` (style.ts has the why). */
export const WEST_RING_EDGE_THRESHOLD = HOLODECK_STYLE.edges.thresholds.westRing;
/** Tank-end flange on the west stub. [1.5, 0.1, 1.5] sat fat vs r-west modest collar. */
export const WEST_TANK_END = [1.28, 0.07, 1.28] as const;
/** Alias of `HOLODECK_STYLE.edges.wireWidth` (Line2 CSS px). */
export const PIPE_WIRE_WIDTH = HOLODECK_STYLE.edges.wireWidth;
/**
 * Bend (sweep) radius. Round 2: 0.58 (was 0.45) = 2.9 tube radii, the smoother reference sweep; inner wall radius
 * 0.38 stays open at r = 0.2. Two bends on a 1-cell run would need 1.16 > 1 of trim: trimRun then leaves that run
 * untrimmed (see its a + b >= len guard), so keep elbows >= 1.2 cells apart in scene.json.
 */
export const ELBOW_RADIUS = 0.58;
/**
 * Slide the quarter torus along the L bisector. + toward the arc, − into the corner.
 *
 * The torus is centred on its own sweep axis, so for tangent-continuous joins
 * (pipe ends exactly at the bend mouths, which `trimRun` places ELBOW_RADIUS
 * from the corner) the centre must sit at (−R, −R) from the corner on the
 * inside of the L, i.e. R·√2 back along the bisector. With offset 0 the
 * old torus sat in the outer quadrant, its mouths pointing the wrong way and
 * 2R away from the trimmed pipe ends.
 */
export const ELBOW_OFFSET = -ELBOW_RADIUS * Math.SQRT2;
export const KNUCKLE_RADIUS = 0.2;
export const KNUCKLE_LEN = 0.14;
export const KNUCKLE_SIDES = 8;
/** Plain (non-steam) end cap: short flange disc, radius as multiple of pipe radius. */
export const CAP_SCALE = 1.32;
export const CAP_LEN = 0.1;
/** Keep the bore above y=0 so the tube does not z-fight the grid. Round 2: 0.12 (was 0.05) gives the reference's short-riser feel at tank nozzles; RMSE vs reference 0.1013 at 0.12 vs 0.1023 at 0.05 (marginal, so kept modest). */
export const PIPE_GRID_GAP = 0.12;

export function pipeWorldY(radius = PIPE_RADIUS): number {
  return radius + PIPE_GRID_GAP;
}

/**
 * Floor-plane shift of a yawed quarter torus. Local +X/+Z is the default
 * mouth bisector; parent yaw maps that onto the L.
 */
export function elbowOffsetShift(yaw: number, offset: number): [number, number] {
  const s = offset / Math.SQRT2;
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  return [s * c + s * n, -s * n + s * c];
}

/** Unit cylinder is Y-up height 1; YXZ euler = parent yaw then pitch onto the run. */
export function pipePose(
  from: [number, number],
  to: [number, number],
  radius = PIPE_RADIUS,
): {
  length: number;
  yaw: number;
  mid: Vector3Tuple;
  rotation: [number, number, number];
  rotationOrder: 'YXZ';
} {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const mid: Vector3Tuple = [(from[0] + to[0]) / 2, pipeWorldY(radius), (from[1] + to[1]) / 2];
  return {
    length,
    yaw,
    mid,
    rotation: [Math.PI / 2, yaw, 0],
    rotationOrder: 'YXZ',
  };
}

export function alongPipe(mid: Vector3Tuple, yaw: number, z: number): Vector3Tuple {
  return [mid[0] + Math.sin(yaw) * z, mid[1], mid[2] + Math.cos(yaw) * z];
}

/**
 * Pull a run's endpoints off a 90° torus so the cylinder stops at the
 * tube, not the corner. `amount` is the torus major radius in world units.
 */
export function trimRun(
  from: [number, number],
  to: [number, number],
  trimFrom: boolean,
  trimTo: boolean,
  amount = ELBOW_RADIUS,
): { from: [number, number]; to: [number, number] } {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    return { from, to };
  }
  const ux = dx / len;
  const uz = dz / len;
  const a = trimFrom ? amount : 0;
  const b = trimTo ? amount : 0;
  if (a + b >= len - 1e-4) {
    return { from, to };
  }
  return {
    from: [from[0] + ux * a, from[1] + uz * a],
    to: [to[0] - ux * b, to[1] - uz * b],
  };
}

function snapDir(n: number): number {
  if (n > 1e-6) {
    return 1;
  }
  if (n < -1e-6) {
    return -1;
  }
  return 0;
}

/** Default quarter torus after Rx(π/2): mouths at grid +X and +Y. Then Ry(yaw). */
function mouthAfterYaw(gx: number, gy: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [Math.round(gx * c + gy * s), Math.round(-gx * s + gy * c)];
}

function sameDirSet(
  a: readonly [number, number],
  b: readonly [number, number],
  x: readonly [number, number],
  y: readonly [number, number],
): boolean {
  return (a[0] === x[0] && a[1] === x[1] && b[0] === y[0] && b[1] === y[1])
    || (a[0] === y[0] && a[1] === y[1] && b[0] === x[0] && b[1] === x[1]);
}

function wrapRightAngle(yaw: number): number {
  const t = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  if (Math.abs(t) < 1e-9) {
    return 0;
  }
  if (Math.abs(t - Math.PI) < 1e-9 || Math.abs(t + Math.PI) < 1e-9) {
    return Math.PI;
  }
  if (Math.abs(t - Math.PI / 2) < 1e-9) {
    return Math.PI / 2;
  }
  if (Math.abs(t + Math.PI / 2) < 1e-9) {
    return -Math.PI / 2;
  }
  return t;
}

/**
 * Yaw so the quarter torus meets two axis-aligned runs leaving a corner.
 * Instanced elbows must use Euler XYZ [π/2, yaw, 0] — YXZ was 180° off
 * at ±90°. Then +π: the inner wedge from this formula sat on the
 * outside of each L in the process-line snapshot. Exception: the
 * green-valve steam-out corner (+X/−Y) is 180° off with that +π —
 * author +π/2 in scene.json (inner wedge, no extra π).
 */
export function elbowYawForDirs(ax: number, ay: number, bx: number, by: number): number {
  const a: [number, number] = [snapDir(ax), snapDir(ay)];
  const b: [number, number] = [snapDir(bx), snapDir(by)];
  for (const inner of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const m0 = mouthAfterYaw(1, 0, inner);
    const m1 = mouthAfterYaw(0, 1, inner);
    if (sameDirSet(m0, m1, a, b)) {
      return wrapRightAngle(inner + Math.PI);
    }
  }
  return 0;
}
