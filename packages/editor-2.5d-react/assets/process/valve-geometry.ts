import { BoxGeometry, BufferGeometry, CylinderGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIPE_RADIUS } from './pipe-math';

/**
 * Arcentry-style in-line valve, code-built so it can be instanced: a fat
 * barrel on the pipe axis (local X) with a flange at each end, a vertical
 * bonnet + thin stem, and a coloured handwheel disc on top. Origin = pipe
 * axis, so a valve placed at pipeWorldY() sits on the run.
 *
 * Split in two geometries: `body` (white, merged) and `wheel` (the one
 * tintable element). The Blender valve.glb (assets/models) is a different,
 * older shape; its contract lives in FittingParams and valve-glb.test.ts.
 */
export const VALVE_SIDES = 8;
// Round 2 proportions (reference.jpg): barrel + flanges are subtle (barely
// proud of the 0.2 pipe), the bonnet is a short blocky stub just above the
// pipe top (y = 0.2), a long thin stem rises from it, and the wheel sits high
// enough to read above the pipe at iso angle.
export const VALVE_BODY_R = PIPE_RADIUS * 1.2;
export const VALVE_BODY_LEN = 0.6;
export const VALVE_FLANGE_R = PIPE_RADIUS * 1.35;
export const VALVE_FLANGE_LEN = 0.05;
export const VALVE_BONNET_R = 0.15;
export const VALVE_BONNET_TOP = 0.34;
export const VALVE_STEM_R = 0.035;
// Round 3: valves read taller than the reference (wheel top sat ~0.1 above it), so the wheel drops 0.82 -> 0.74
// and shrinks 0.28 -> 0.25. The stem is derived from VALVE_WHEEL_Y so it shortens with it.
export const VALVE_WHEEL_Y = 0.74;
export const VALVE_WHEEL_R = 0.25;
export const VALVE_WHEEL_H = 0.05;
/** Inner raised ring (radius as a fraction of the rim) so the wheel reads as a double ring, plus a small hub. */
export const VALVE_WHEEL_INNER = 0.55;
/** 12 sides: enough that the disc reads round, few enough that the rim facets outline. */
export const VALVE_WHEEL_SIDES = 12;
/**
 * Wheel wire width as a fraction of the pipe wire width. The wheel is ~16 px across at REFERENCE_ZOOM; full-width
 * grey wire over its ~40 outline segments buried the tint (reference wheels are a solid colour with a few light marks).
 */
export const VALVE_WHEEL_WIRE_SCALE = 0.5;
/** Spoke thickness (world units). Thin enough that the rim and hub still read, thick enough to draw as a box outline at zoom 32. */
export const VALVE_SPOKE_W = 0.035;

function merge(parts: BufferGeometry[], what: string): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) {
    throw new Error(`valve-geometry: merging ${what} failed`);
  }
  return merged;
}

function cyl(r: number, h: number, sides: number, y = 0): CylinderGeometry {
  const g = new CylinderGeometry(r, r, h, sides);
  g.translate(0, y, 0);
  return g;
}

export function buildValveBodyGeometry(): BufferGeometry {
  const barrel = cyl(VALVE_BODY_R, VALVE_BODY_LEN, VALVE_SIDES);
  barrel.rotateZ(Math.PI / 2); // cylinder +Y -> pipe axis +X
  const flangeX = VALVE_BODY_LEN / 2;
  const flangeA = cyl(VALVE_FLANGE_R, VALVE_FLANGE_LEN, VALVE_SIDES);
  flangeA.rotateZ(Math.PI / 2);
  flangeA.translate(-flangeX, 0, 0);
  const flangeB = cyl(VALVE_FLANGE_R, VALVE_FLANGE_LEN, VALVE_SIDES);
  flangeB.rotateZ(Math.PI / 2);
  flangeB.translate(flangeX, 0, 0);
  const bonnetH = VALVE_BONNET_TOP;
  const bonnet = cyl(VALVE_BONNET_R, bonnetH, VALVE_SIDES, bonnetH / 2);
  const stemH = VALVE_WHEEL_Y - VALVE_BONNET_TOP;
  const stem = cyl(VALVE_STEM_R, stemH, VALVE_SIDES, VALVE_BONNET_TOP + stemH / 2);
  return merge([barrel, flangeA, flangeB, bonnet, stem], 'valve body');
}

export function buildValveWheelGeometry(): BufferGeometry {
  // Rim disc + a taller inner ring (double-ring look) + hub. One merged mesh, so the tint stays a single material.
  const rim = cyl(VALVE_WHEEL_R, VALVE_WHEEL_H, VALVE_WHEEL_SIDES, VALVE_WHEEL_Y);
  const inner = cyl(VALVE_WHEEL_R * VALVE_WHEEL_INNER, VALVE_WHEEL_H * 1.8, VALVE_WHEEL_SIDES, VALVE_WHEEL_Y + VALVE_WHEEL_H * 0.4);
  const hub = cyl(0.05, VALVE_WHEEL_H * 2.6, 6, VALVE_WHEEL_Y + VALVE_WHEEL_H * 0.8);
  // Round 3: 4 spokes hub -> rim (reference wheels show a cross). Two boxes crossing at the hub give exactly 4
  // arms; each is a diameter long, so it reaches the rim. Merged into the same geometry, so the wheel stays ONE
  // tinted mesh. Spoke height sits between rim and inner-ring height so the cross is visible against the inner disc.
  const spokeLen = VALVE_WHEEL_R * 2 * 0.96;
  const spokeH = VALVE_WHEEL_H * 1.3;
  const spokeA = new BoxGeometry(spokeLen, spokeH, VALVE_SPOKE_W);
  spokeA.translate(0, VALVE_WHEEL_Y + VALVE_WHEEL_H * 0.9, 0);
  const spokeB = new BoxGeometry(VALVE_SPOKE_W, spokeH, spokeLen);
  spokeB.translate(0, VALVE_WHEEL_Y + VALVE_WHEEL_H * 0.9, 0);
  return merge([rim, inner, hub, spokeA, spokeB], 'valve wheel');
}

let bodyCache: BufferGeometry | undefined;
let wheelCache: BufferGeometry | undefined;
/**
 * Process-wide singletons for the instanced pool (every valve shares them).
 * Never disposed on purpose: they live as long as the page.
 */
export function sharedValveBody(): BufferGeometry {
  bodyCache ??= buildValveBodyGeometry();
  return bodyCache;
}
export function sharedValveWheel(): BufferGeometry {
  wheelCache ??= buildValveWheelGeometry();
  return wheelCache;
}
