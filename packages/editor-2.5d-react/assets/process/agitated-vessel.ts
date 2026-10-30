/**
 * Pure layout for the GLB-backed agitated vessel (Mixer palette part, mash
 * tun preset, any Tank with `agitator: true`): `assets/models/mixer.glb`
 * from holodeck/blender/parts/mixer.py, scaled onto the Tank's radius and
 * straight-wall height. No React / three imports.
 *
 * mixer.glb dimensions (mixer.py header, pinned by src/models/mixer-glb.test.ts):
 * R 0.45, floor at y 0, straight wall 0..1.45, head to 1.75, housing lid rim
 * 2.024 (2.01 before the round-5 collar seat on the head);
 * window 100° centred on theta 45° (the default iso camera); `anim.liquid`
 * at the dish pole, liquid mesh 0..1.39 at full scale; `anim.agitator` spins about Y.
 */
export const MIXER_GLB = {
  model: 'mixer',
  radius: 0.45,
  wallHeight: 1.45,
  topY: 2.024,
  apexY: 1.75,
  windowYawDeg: 45,
  windowDeg: 100,
} as const;

/**
 * Scale (x = z, y) that maps mixer.glb onto a Tank of `radius` and straight
 * wall `height`: the GLB's outer radius onto `radius` (footprint, ports), its
 * straight wall onto `height`. Revolved shapes stay round under a different
 * Y scale; only the proportions follow the Tank params. Degenerate inputs
 * fall back to 1 so a bad param cannot make the part vanish.
 */
export function agitatedVesselScale(radius: number, height: number): { xz: number; y: number } {
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  return {
    xz: ok(radius) ? radius / MIXER_GLB.radius : 1,
    y: ok(height) ? height / MIXER_GLB.wallHeight : 1,
  };
}

/** World height of the scaled vessel's apex / top above its floor (resize handles, labels). */
export function agitatedVesselTop(height: number): number {
  return MIXER_GLB.topY * agitatedVesselScale(1, height).y;
}
