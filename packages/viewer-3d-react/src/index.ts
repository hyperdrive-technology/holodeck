/**
 * @holodeck/viewer-3d-react — read-only 3D scene viewer (R3F).
 */

export { HolodeckViewer3D } from './components/HolodeckViewer3D';
export { SceneNodeMesh } from './components/SceneNodeMesh';
export type { SceneNodeMeshProps } from './components/SceneNodeMesh';
export { AnimationRunner } from './components/AnimationRunner';
export type { AnimationRunnerProps } from './components/AnimationRunner';
export {
  applyBeltStripe,
  beltStripePositionX,
  BELT_STRIPE_WRAP,
  resolveUvOffsetRate,
} from './components/belt-stripe';
export type { BeltStripeHost, BeltStripeObject } from './components/belt-stripe';
export { liveOverlayCopy } from './live-overlay';
export type { HolodeckViewer3DProps } from './types';
export type { HolodeckLiveConnection, HolodeckLiveConnectionState } from '@holodeck/sdk';

export {
  ISA101_GREY,
  ISA101_WARNING,
  ISA101_CRITICAL,
  colorForStatus,
  resolveNodeColor,
  colorToRgb,
  resolveOpacity,
} from './utils/materials';

export {
  applyEasing,
  interpolateKeyframes,
  animationLocalTime,
  evaluateAnimation,
  applyPropertyPath,
} from './utils/animation';
