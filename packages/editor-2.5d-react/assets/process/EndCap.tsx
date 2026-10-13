import { Edges } from './Edges';
import type { Vector3Tuple } from 'three';
import { WhiteMesh } from './Shell';
import { HOLODECK_STYLE } from './style';

export const STEAM_NUT_R = 0.40;
export const STEAM_NUT_INNER = 0.22;
export const STEAM_NUT_LEN = 0.50;
/** Hex nut: 6-gon shell, round bore. 6-gon bore read as a faceted hole on o-steam2 vs r-steam’s round. */
export const STEAM_NUT_BORE_SIDES = 16;
/** Alias of `HOLODECK_STYLE.edges.thresholds.steamNut` (style.ts has the why).
 *  Do not retouch R/LEN/ROT. */
export const STEAM_NUT_EDGE_THRESHOLD = HOLODECK_STYLE.edges.thresholds.steamNut;
/**
 * Cylinder +Y → world +X (steam-out run). Camera-facing Y→(1,1,1) read as a
 * flat hex on overlay-50.png; reference-canvas.png is an isometric boxed
 * coupling (hex end + side faces). Shader isoAxis follows instance Y, so
 * this rotation shades around the pipe bore.
 * 0.54 read slightly large vs r-steam; 0.40 is the radius floor vs INNER.
 * 0.56 along-pipe read as a long bolt when the stub ended at the nut
 * (toX 11.44). Stub now runs through to 12.9, so 0.50 can show side faces
 * without eating the outgoing tube. 0.42 stacked as a camera-facing hex.
 * Iso shade (ShadedMesh) read as a grey plate on overlay-50 vs Arcentry’s
 * white boxed coupling; pipes/elbows/valves are unlit WhiteFill.
 * Yaw 0 around the cylinder axis (local Y) put a hex face camera-on.
 * Intended: Y = π/6 (half a 60° hex step) then world Z = −π/2 to lay the
 * prism on +X with an edge toward the iso camera so two faces read boxed.
 * Default Euler XYZ applies world Z first, then world Y — that yaws the
 * already-laid nut 30° off the pipe toward the camera (face hex on
 * overlay-50). ZYX with the same tuple is world Y then world Z.
 * π/6 roll after ZYX put an edge toward the iso camera — o-steam2 read
 * as a cube (three parallelograms, rectangular bore) vs r-steam’s hex
 * end + round hole. Y = 0 ZYX keeps axis on +X; still an iso cube.
 * XYZ π/6 after lay-down was a face pancake. XYZ π/12 is the middle:
 * 15° yaw toward the (D,D,D) camera so the hex end can show without
 * leaving the pipe. Y = 0 with X = π/6 (tick 90) still read as an iso
 * cube on s-steam2 — keep π/12. Default 6-gon vertex maps to −Y after
 * Z = −π/2 (vertex-up in iso). World X = π/6 after that yaw is one hex
 * step so a face sits iso-up like r-steam’s flat-top. Do not put π/6 on
 * Y (that was the pancake) or on ZYX roll (that was the cube).
 */
export const STEAM_NUT_ROT: Vector3Tuple = [Math.PI / 6, Math.PI / 12, -Math.PI / 2];
export const STEAM_NUT_ROT_ORDER = 'XYZ' as const;

/**
 * Short hex coupling on the steam stub plus a dark bore. A long solid prism
 * read as a bolt; a camera-facing pancake read as a plate
 * (steam crop vs reference-canvas.png).
 */
export function EndCap({
  position,
}: {
  position: Vector3Tuple;
  rotationY?: number;
}) {
  return (
    <group position={position}>
      <WhiteMesh rotation={STEAM_NUT_ROT} rotationOrder={STEAM_NUT_ROT_ORDER}>
        <cylinderGeometry args={[STEAM_NUT_R, STEAM_NUT_R, STEAM_NUT_LEN, 6]} />
        <Edges threshold={STEAM_NUT_EDGE_THRESHOLD} />
      </WhiteMesh>
      <mesh rotation={STEAM_NUT_ROT} rotation-order={STEAM_NUT_ROT_ORDER}>
        <cylinderGeometry args={[STEAM_NUT_INNER, STEAM_NUT_INNER, STEAM_NUT_LEN * 1.02, STEAM_NUT_BORE_SIDES]} />
        <meshBasicMaterial color={HOLODECK_STYLE.colors.bore} toneMapped={false} />
      </mesh>
    </group>
  );
}
