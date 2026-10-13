export { Area } from './Area';
export { Elbow } from './Elbow';
export { HolodeckModel } from './HolodeckModel';
export { EndCap } from './EndCap';
export { Label } from './Label';
export { Mixer } from './Mixer';
export { Pipe } from './Pipe';
export { Shaft } from './Shaft';
export { Tank } from './Tank';
export { TankAgitator, AGITATOR_ANIM_NODE } from './TankAgitator';
export { Valve } from './Valve';
export {
  DEFAULT_TANK_PARAMS,
  TANK_BOTTOMS,
  TANK_SUPPORTS,
  TANK_TOPS,
  TANK_WINDOW_DEG,
  TANK_WINDOW_YAW,
  mergeTankParams,
  tankLayout,
  tankWallSpan,
  tankWindow,
  vesselFootprint,
  vesselPorts,
} from './tank-params';
export type { TankBottom, TankCap, TankNozzle, TankParams, TankSupport, TankTop } from './tank-params';
export {
  AGITATOR_PRESET,
  BRITE_TANK_PRESET,
  FERMENTER_PRESET,
  HLT_PRESET,
  KETTLE_PRESET,
  MASH_TUN_PRESET,
  TANK_PRESETS,
  WHIRLPOOL_PRESET,
} from './tank-presets';
export type { TankPreset, TankPresetId } from './tank-presets';
export type { FittingParams } from './fitting-params';
export { DEFAULT_FITTING_PARAMS, mergeFittingParams } from './fitting-params';
export { FINISH_NAMES, HOLODECK_STYLE } from './style';
export type { Finish, FinishName, HolodeckStyle, IsoFinish, UnlitFinish } from './style';
export { createFinishMaterial, createIsoShadeMaterial, createUnlitMaterial, setIsoShade } from './materials';
export type { FinishMaterialOptions, IsoShadeParams } from './materials';
export { createEdgeLines, createEdgeMaterial, setEdgeLinesAppearance, setEdgeLinesSource } from './edge-lines';
export type { EdgeLineOptions } from './edge-lines';
export {
  applyHolodeckStyle,
  findAnimNodes,
  findPorts,
  finishForMaterialName,
  resetHolodeckStyleWarnings,
} from './apply-style';
export type { ApplyStyleOverrides } from './apply-style';

export const LIBRARY_OBJECTS = [
  'area',
  'elbow',
  'end-cap',
  'label',
  'mixer',
  'pipe',
  'shaft',
  'tank',
  'valve',
] as const;

export type LibraryObjectId = (typeof LIBRARY_OBJECTS)[number];
