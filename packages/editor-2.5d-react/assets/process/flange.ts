import { BufferGeometry, CylinderGeometry, LatheGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Flange rings and nozzle stubs: the one ring shape shared by routed pipes
 * (pipe-geometry.ts end flanges), valves (valve-geometry.ts barrel flanges)
 * and vessel nozzles (NozzleStub.tsx).
 *
 * Everything is built along local +Y so the ring plane is perpendicular to
 * the run by construction; the caller rotates +Y onto the run axis
 * (flange-orientation.test.ts checks every caller). Pure geometry: no React.
 */

export type FlangeRingSpec = {
  /** Pipe radius the flange sits on. */
  radius: number;
  /** Flange radius / pipe radius. */
  scale: number;
  /** Ring thickness along the run. */
  length: number;
  sides: number;
  /** Ring centre along local Y. */
  y?: number;
};

/** One flange ring: a short fat cylinder centred at `y` on the local Y axis. */
export function flangeRingGeometry({ radius, scale, length, sides, y = 0 }: FlangeRingSpec): CylinderGeometry {
  const g = new CylinderGeometry(radius * scale, radius * scale, Math.max(1e-4, length), Math.max(3, Math.round(sides)));
  g.translate(0, y, 0);
  return g;
}

/**
 * Vessel nozzle flange proportions. Round (16 sides) so the ring reads as a
 * ring at iso angles; the routed pipes' 6-gon flange read as a hex nut on a
 * nozzle that points toward the camera (Des 2026-10-29). 1.45x the stub
 * radius, 0.35x thick: a thin collar like reference.jpg's pipe rings.
 */
export const NOZZLE_SIDES = 16;
export const NOZZLE_FLANGE_SCALE = 1.45;
export const NOZZLE_FLANGE_THICKNESS = 0.35;

export type NozzleStubSpec = {
  /** Stub length along +Y (from the shell to the flange face). */
  length: number;
  radius: number;
  sides?: number;
  flangeScale?: number;
  /** Flange thickness as a fraction of `radius`. */
  flangeThickness?: number;
};

/**
 * A vessel nozzle: a tube from y = 0 (buried in the shell) to y = length,
 * closed at the free end, with a flange ring flush with the free end.
 * Origin at the shell end so a pose only has to place one point.
 */
export function nozzleStubGeometry({
  length,
  radius,
  sides = NOZZLE_SIDES,
  flangeScale = NOZZLE_FLANGE_SCALE,
  flangeThickness = NOZZLE_FLANGE_THICKNESS,
}: NozzleStubSpec): BufferGeometry {
  const len = Math.max(1e-3, length);
  const n = Math.max(3, Math.round(sides));
  // Lathe profile: open at the shell end (it is inside the wall), closed disc at the free end.
  const tube = new LatheGeometry([new Vector2(radius, 0), new Vector2(radius, len), new Vector2(0, len)], n);
  const t = Math.min(len, radius * flangeThickness);
  const ring = flangeRingGeometry({ radius, scale: flangeScale, length: t, sides: n, y: len - t / 2 });
  const merged = mergeGeometries([tube.toNonIndexed(), ring.toNonIndexed()], false);
  tube.dispose();
  ring.dispose();
  if (!merged) throw new Error('nozzleStubGeometry: merge failed');
  return merged;
}
