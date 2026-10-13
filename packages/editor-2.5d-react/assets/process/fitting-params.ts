import {
  ELBOW_OFFSET,
  ELBOW_RADIAL,
  ELBOW_RADIUS,
  ELBOW_SWEEP,
  KNUCKLE_LEN,
  KNUCKLE_RADIUS,
  KNUCKLE_SIDES,
  PIPE_FLANGE_LEN,
  PIPE_FLANGE_SCALE,
  PIPE_RADIUS,
  PIPE_SIDES,
  PIPE_WIRE_WIDTH,
} from './pipe-math';
import { LABEL_BASE_DEG } from './Label';
import { HOLODECK_STYLE } from './style';

/**
 * NOTE: the `valve*` geometry fields below still describe the Blender
 * valve.glb contract (valve-glb.test.ts pins them). The code-built valve
 * (valve-geometry.ts) no longer reads them; only `valveHandwheel` applies.
 *
 * Tuner-facing knobs for unique-mesh Pipe / Valve / Elbow.
 * Instanced scene pools still read the exported constants; copy JSON
 * from the tuner when a value should land in those constants.
 */
export type FittingParams = {
  pipeRadius: number;
  pipeSides: number;
  pipeShowFill: boolean;
  pipeShowWire: boolean;
  pipeShowFlanges: boolean;
  pipeShowBand: boolean;
  flangeScale: number;
  flangeLen: number;
  bandScale: number;
  bandLen: number;
  bandAlong: number;
  pipeWireColor: string;
  pipeWireWidth: number;
  pipeBandColor: string;
  elbowMajor: number;
  elbowRadial: number;
  elbowTubular: number;
  elbowShowWire: boolean;
  elbowEdgeThreshold: number;
  elbowCapDeg: number;
  elbowOffset: number;
  knuckleRadius: number;
  knuckleLen: number;
  knuckleSides: number;
  valveGlobe: number;
  valveGlobeW: number;
  valveGlobeH: number;
  valveBarrelR: number;
  valveBarrelLen: number;
  valveBarrelSides: number;
  valveStemR: number;
  valveStemH: number;
  valveStemY: number;
  valveWheelR: number;
  valveDiscH: number;
  valveSpokeY: number;
  valveTorusTube: number;
  valveSpokeR: number;
  valveSpokeCount: number;
  valveWheelSegs: number;
  valveTorusRadial: number;
  valveTorusTubular: number;
  valveShowGlobe: boolean;
  valveShowBarrel: boolean;
  valveShowStem: boolean;
  valveShowDisc: boolean;
  valveShowTorus: boolean;
  valveShowSpokes: boolean;
  valveShowWire: boolean;
  valveHandwheel: string;
  labelAngleDeg: number;
};

export const DEFAULT_FITTING_PARAMS: FittingParams = {
  pipeRadius: PIPE_RADIUS,
  pipeSides: PIPE_SIDES,
  pipeShowFill: true,
  pipeShowWire: true,
  pipeShowFlanges: true,
  pipeShowBand: true,
  flangeScale: PIPE_FLANGE_SCALE,
  flangeLen: PIPE_FLANGE_LEN,
  bandScale: 1.18,
  bandLen: 0.07,
  bandAlong: 0.22,
  pipeWireColor: HOLODECK_STYLE.colors.pipeWire,
  pipeWireWidth: PIPE_WIRE_WIDTH,
  pipeBandColor: HOLODECK_STYLE.colors.band,
  elbowMajor: ELBOW_RADIUS,
  elbowRadial: ELBOW_RADIAL,
  elbowTubular: ELBOW_SWEEP,
  elbowShowWire: true,
  elbowEdgeThreshold: HOLODECK_STYLE.edges.thresholds.elbow,
  elbowCapDeg: 0,
  elbowOffset: ELBOW_OFFSET,
  knuckleRadius: KNUCKLE_RADIUS,
  knuckleLen: KNUCKLE_LEN,
  knuckleSides: KNUCKLE_SIDES,
  valveGlobe: 0.2,
  valveGlobeW: 16,
  valveGlobeH: 12,
  valveBarrelR: 0.08,
  valveBarrelLen: 0.42,
  valveBarrelSides: 10,
  valveStemR: 0.024,
  valveStemH: 0.16,
  valveStemY: 0.27,
  valveWheelR: 0.33,
  valveDiscH: 0.06,
  valveSpokeY: 0.35,
  valveTorusTube: 0.07,
  valveSpokeR: 0.012,
  valveSpokeCount: 4,
  valveWheelSegs: 24,
  valveTorusRadial: 8,
  valveTorusTubular: 24,
  valveShowGlobe: true,
  valveShowBarrel: true,
  valveShowStem: true,
  valveShowDisc: false,
  valveShowTorus: true,
  valveShowSpokes: true,
  valveShowWire: false,
  valveHandwheel: HOLODECK_STYLE.colors.accent,
  labelAngleDeg: LABEL_BASE_DEG,
};

export function mergeFittingParams(partial?: Partial<FittingParams>): FittingParams {
  return { ...DEFAULT_FITTING_PARAMS, ...partial };
}
