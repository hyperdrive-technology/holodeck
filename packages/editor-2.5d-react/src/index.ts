/**
 * @holodeck/editor-2.5d-react
 *
 * Orthographic 2.5D process editor: a library of wireframe objects placed
 * by a scene JSON file.
 */

export { IsoCanvas, IsoCanvas as HolodeckEditor25D } from './iso/IsoCanvas';
export type { IsoCanvasProps, IsoCanvasProps as HolodeckEditor25DProps } from './iso/IsoCanvas';
export { PROCESS_SNAPSHOT, PROCESS_SNAPSHOT_METRICS, ProcessLineSketch, processMetrics } from './iso/ProcessLineSketch';
export { ProcessEditor } from './editor/ProcessEditor';
export type { ProcessEditorProps } from './editor/ProcessEditor';
export { PROCESS_SCENE, loadProcessScene } from './iso/load-process-scene';
export { SceneGraph } from './iso/SceneGraph';
export { SceneObjectView } from './iso/SceneObjectView';
export { INSTANCE_LIMIT, partitionByPart, partitionScene, poolCount } from './iso/partition-scene';
export {
  Area,
  Elbow,
  EndCap,
  Label,
  Mixer,
  Pipe,
  Shaft,
  Tank,
  Valve,
  HOLODECK_STYLE,
  FINISH_NAMES,
  applyHolodeckStyle,
  createEdgeLines,
  createFinishMaterial,
  findAnimNodes,
  findPorts,
  finishForMaterialName,
} from '../assets/process';
export { HolodeckStyleProvider, useHolodeckStyle } from '../assets/process/style-context';
export type { ApplyStyleOverrides, Finish, FinishName, HolodeckStyle } from '../assets/process';
export {
  ISO_VIEW_DISTANCE,
  initialIsoPose,
  lerpPose,
  posePosition,
  rotatePose,
  toggleTopDown,
} from './iso/pose';
export type { IsoPose } from './iso/pose';
export { GRID_CELL_SIZE, gridToWorld, parseSceneFile, sceneBounds, worldToGrid } from './iso/scene';
export type { IsoPlacement, IsoSceneFile, SceneFile, ScenePlacement } from './iso/scene';

// Extension model: kinds, registry, built-ins, themes, animators.
export * from './registry';
export {
  BOB_ANIMATOR,
  BUILTIN_ISO_ANIMATORS,
  FILL_ANIMATOR,
  PULSE_ANIMATOR,
  SPIN_ANIMATOR,
  VISIBLE_ANIMATOR,
} from './anim/animators';
export { applyAnimations, planAnimations, useIsoAnimators } from './anim/use-iso-animators';
export type { AnimationBinding } from './anim/use-iso-animators';
// Superset of the static component in assets/process: adds def / params / animation.
export { HolodeckModel } from './anim/HolodeckModel';
export type { EditorHostMode, EditorMode, EditorState } from './editor/editor-state';
export { BUILTIN_MODEL_URLS, modelUrl } from '../assets/models';
