import {
  MIXER_CAP_LID_THICKNESS,
  MIXER_LIQUID_OPACITY,
  MIXER_IMPELLER_RADIUS,
  MIXER_IMPELLER_SPAN,
  MIXER_SHAFT_LENGTH,
  MIXER_SHAFT_RADIUS,
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

/** Agitator sizing shared by every agitated preset (the mixer's hat / shaft / impeller). */
export const AGITATOR_PRESET: Partial<TankParams> = {
  agitator: true,
  // Slightly translucent (the mixer's value) so the impeller reads through the liquid; the
  // flask still writes depth, so nothing behind it prints through the cutout.
  liquidOpacity: MIXER_LIQUID_OPACITY,
  capHeightRatio: 0.12,
  capRadiusRatio: 0.32,
  capLidThickness: MIXER_CAP_LID_THICKNESS,
  shaftLength: MIXER_SHAFT_LENGTH,
  shaftRadius: MIXER_SHAFT_RADIUS,
  impellerSpan: MIXER_IMPELLER_SPAN * 2.2,
  impellerRadius: MIXER_IMPELLER_RADIUS,
};

export const HLT_PRESET: TankPreset = {
  height: 3.0,
  radius: 1.0,
  params: { top: 'dome', bottom: 'flat', support: 'none' },
};

export const MASH_TUN_PRESET: TankPreset = {
  height: 1.7,
  radius: 1.0,
  params: {
    top: 'dome',
    bottom: 'dish',
    support: 'legs',
    standHeight: 0.4,
    dishBottomHeight: 0.12,
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
