import {
  MIXER_BODY_RINGS,
  MIXER_CAP_HEIGHT_RATIO,
  MIXER_CAP_LID_THICKNESS,
  MIXER_CAP_RADIUS_RATIO,
  MIXER_INNER_RATIO,
  MIXER_LINER_COLOR,
  MIXER_LINER_RATIO,
  MIXER_IMPELLER_RADIUS,
  MIXER_IMPELLER_SPAN,
  MIXER_OUTER_BOWL,
  MIXER_RADIAL_SEGMENTS,
  MIXER_SHAFT_LENGTH,
  MIXER_SHAFT_RADIUS,
  MIXER_SHOULDER_RATIO,
  MIXER_SHOULDER_TOP,
  MIXER_WALL_THRESHOLD,
  MIXER_WINDOW_DEG,
  MIXER_WINDOW_YAW,
  type TankParams,
} from './tank-params';

/**
 * Shape presets for the base `Tank`: everything a vessel kind needs beyond
 * its radius and height. A preset is plain data (no React, no three) so
 * packs can register one as `{ ...preset, radius, height }` and tests can
 * check them without a renderer.
 *
 * Sizes are the brewery demo's current look (the GLBs they replace):
 * mash tun R 0.99 / wall 1.62 (x1.8 GLB), kettle R 0.63 / wall 1.65 (+ dome;
 * the old 3.9 included a steam stack that is gone), HLT R 1.0 / 3.0,
 * whirlpool wider than tall with a flat lid and a tangential inlet.
 */
export interface TankPreset {
  /** Default straight-wall height (world units). */
  height: number;
  /** Default radius (world units). */
  radius: number;
  /** Shape params layered over `DEFAULT_TANK_PARAMS`. */
  params: Partial<TankParams>;
}

/**
 * Agitator sizing shared by every agitated vessel: the Mixer palette part
 * (`mixerDefaults` in src/registry/builtin.tsx) and the mash tun preset draw
 * the same hat / shaft / impeller from these values (one code path:
 * `TankAgitator`).
 */
export const AGITATOR_PRESET: Partial<TankParams> = {
  agitator: true,
  capHeightRatio: MIXER_CAP_HEIGHT_RATIO,
  capRadiusRatio: MIXER_CAP_RADIUS_RATIO,
  capLidThickness: MIXER_CAP_LID_THICKNESS,
  shaftLength: MIXER_SHAFT_LENGTH,
  shaftRadius: MIXER_SHAFT_RADIUS,
  impellerSpan: MIXER_IMPELLER_SPAN,
  impellerRadius: MIXER_IMPELLER_RADIUS,
};

/**
 * The mixer's bottle body (reference.jpg's central mixer): rounded heel,
 * cosine shoulder into the dome, inset flask and a narrower window so the
 * right-hand wall survives. Shared by the Mixer part and the mash tun, so
 * an agitated vessel always reads as the same object. Shade (flask finish)
 * comes from the theme in `mixerDefaults`.
 */
export const MIXER_BODY_PRESET: Partial<TankParams> = {
  top: 'dome',
  radialSegments: MIXER_RADIAL_SEGMENTS,
  bodyRings: MIXER_BODY_RINGS,
  innerRatio: MIXER_INNER_RATIO,
  windowDeg: MIXER_WINDOW_DEG,
  windowYawDeg: MIXER_WINDOW_YAW,
  shoulderRatio: MIXER_SHOULDER_RATIO,
  shoulderTopRatio: MIXER_SHOULDER_TOP,
  outerBowlHeight: MIXER_OUTER_BOWL,
  linerRatio: MIXER_LINER_RATIO,
  linerColor: MIXER_LINER_COLOR,
  wallThreshold: MIXER_WALL_THRESHOLD,
};

export const HLT_PRESET: TankPreset = {
  height: 3.0,
  radius: 1.0,
  params: { top: 'dome', bottom: 'flat', support: 'none' },
};

/**
 * Mash tun = the agitated mixer (mixer.glb via AgitatedVessel since
 * 2026-10-30), scaled to R 1.0 (brewery footprint / ports) and a 2.5 straight
 * wall: reference.jpg's slim, tall mixer. mixer.glb stands flat on the floor,
 * so no stand / bottom closure (they would only shift the layout floor).
 */
export const MASH_TUN_PRESET: TankPreset = {
  height: 2.5,
  radius: 1.0,
  params: {
    ...MIXER_BODY_PRESET,
    bottom: 'flat',
    support: 'none',
    ...AGITATOR_PRESET,
  },
};

export const KETTLE_PRESET: TankPreset = {
  height: 2.2,
  radius: 0.65,
  params: {
    top: 'dome',
    bottom: 'dish',
    support: 'legs',
    standHeight: 0.45,
    dishBottomHeight: 0.1,
    domeHeight: 0.4,
  },
};

export const WHIRLPOOL_PRESET: TankPreset = {
  height: 1.5,
  radius: 1.1,
  params: {
    top: 'flat',
    bottom: 'flat',
    support: 'skirt',
    standHeight: 0.25,
    nozzle: 'tangential',
  },
};

/** Conical fermenter / unitank: cone bottom on legs, dome top. */
export const FERMENTER_PRESET: TankPreset = {
  height: 1.9,
  radius: 0.6,
  params: {
    top: 'dome',
    bottom: 'cone',
    support: 'legs',
    standHeight: 0.75,
    coneBottomHeight: 0.55,
    coneBottomRatio: 0.12,
    legRadius: 0.03,
  },
};

/** Brite (bright beer) tank: dish bottom on a skirt, dome top. */
export const BRITE_TANK_PRESET: TankPreset = {
  height: 2.1,
  radius: 0.7,
  params: { top: 'dome', bottom: 'dish', support: 'skirt', standHeight: 0.3, dishBottomHeight: 0.12 },
};

export const TANK_PRESETS = {
  hlt: HLT_PRESET,
  'mash-tun': MASH_TUN_PRESET,
  kettle: KETTLE_PRESET,
  whirlpool: WHIRLPOOL_PRESET,
  fermenter: FERMENTER_PRESET,
  'brite-tank': BRITE_TANK_PRESET,
} as const;

export type TankPresetId = keyof typeof TANK_PRESETS;
