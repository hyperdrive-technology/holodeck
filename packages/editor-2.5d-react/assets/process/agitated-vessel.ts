/**
 * Pure layout for the GLB-backed agitated vessel (Mixer palette part, mash
 * tun preset: any Tank with `mixerModel: true`): `assets/models/mixer.glb`
 * from holodeck/blender/parts/mixer.py, scaled onto the Tank's radius and
 * straight-wall height. No React / three imports.
 *
 * mixer.glb dimensions (mixer.py header, pinned by src/models/mixer-glb.test.ts):
 * R 0.45, floor at y 0, straight wall 0..1.45, head to 1.75, housing lid rim
 * 2.024 (2.01 before the round-5 collar seat on the head);
 * window 100° centred on theta 45° (the default iso camera); `anim.liquid`
 * at the dish pole, liquid mesh 0..1.39 at full scale; `anim.agitator` spins about Y.
 */
import { mergeTankParams, type TankParams } from './tank-params';
import { MASH_TUN_PRESET } from './tank-presets';

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

/** The shape mixer.glb has baked in: a domed bottle standing flat on the floor, window 100° at 45°. */
export const MIXER_GLB_SHAPE = {
  top: 'dome',
  bottom: 'flat',
  support: 'none',
  windowDeg: MIXER_GLB.windowDeg,
  windowYawDeg: MIXER_GLB.windowYawDeg,
} as const;

/**
 * Params the mixer.glb path honours (size, liquid, colours, agitator on/off)
 * or that change nothing (deprecated `bodyRings`). Every OTHER param must
 * equal the mixer body's own value for the GLB to be drawn.
 */
export const MIXER_GLB_HONOURED = new Set<keyof TankParams>([
  'height',
  'radius',
  'fill',
  'fillColor',
  'liquidOpacity',
  'showLiquid',
  'edgeColor',
  'shadeMin',
  'shadeMax',
  'hubWhite',
  'agitator',
  'mixerModel',
  'bodyRings',
  'bodyRingWidth',
]);

let reference: Record<string, unknown> | null = null;
/** The mixer body's params (the mash tun preset over the defaults): what mixer.glb looks like. */
function mixerReference(): Record<string, unknown> {
  reference ??= mergeTankParams(MASH_TUN_PRESET.params) as unknown as Record<string, unknown>;
  return reference;
}

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;

/**
 * Does a Tank with these params draw as mixer.glb (`AgitatedVessel`)? Only
 * when `mixerModel` is set AND every param the GLB cannot show still has the
 * mixer body's value (`MIXER_GLB_HONOURED` lists the ones it can). Otherwise
 * the procedural agitated body draws the overrides, as on main: core passes
 * top / bottom / support / window over the mash tun preset (second review of
 * #228), and `<Mixer params={{ showWall: false, shaftLength: 0.3 }}>` was
 * honoured on main (holodeck#237). Routing's cutout / wall span follow the
 * same params, so they agree with what is drawn.
 */
export function usesMixerModel(p: Partial<TankParams>): boolean {
  if (p.mixerModel !== true) return false;
  const merged = mergeTankParams(p) as unknown as Record<string, unknown>;
  const ref = mixerReference();
  for (const key of Object.keys(ref)) {
    if (MIXER_GLB_HONOURED.has(key as keyof TankParams)) continue;
    if (!sameValue(merged[key], ref[key])) return false;
  }
  return true;
}

/** The fill mixer.glb shows: none for an empty vessel or one whose liquid is switched off (`showLiquid`). */
export function mixerModelFill(p: { showLiquid?: boolean }, level: number, empty: boolean): number {
  return empty || p.showLiquid === false ? 0 : level;
}
