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
export type { ProcessEditorChrome, ProcessEditorHandle, ProcessEditorProps } from './editor/ProcessEditor';
// Host helpers (holodeck#100) and the editing model (lane E3, holodeck#37).
export { nextId as nextPlacementId, stampPlacement, DEFAULT_LAYER_ID, DEFAULT_LAYER_NAME } from './editor/editor-state';
export type { EditorAction, LinkEndName } from './editor/editor-state';
export { CAMERA_CHANGE_DEBOUNCE_MS } from './editor/camera';
export type { EditorCamera } from './editor/camera';
export { expandGroups, isPlacementEditable, isPlacementHidden, layerIdOf, sceneLayers, visibleObjects } from './editor/layers';
export { CLIPBOARD_FORMAT, copyObjects, parseClipboard, pasteObjects, removeObjects, serializeClipboard } from './editor/clipboard';
export type { PasteResult } from './editor/clipboard';
export { alignObjects, distributeObjects, objectBounds, rotateObjectsAbout } from './editor/arrange';
export type { AlignEdge, DistributeAxis } from './editor/arrange';
export { anchorAt, anchorTargetAt } from './editor/connect';
export { SHORTCUTS, POINTER_GESTURES, formatCombo, matchShortcut } from './editor/shortcuts';
export type { ShortcutDef, ShortcutGroup, ShortcutId } from './editor/shortcuts';
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
  TankAgitator,
  AGITATOR_ANIM_NODE,
  Valve,
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
  AGITATOR_PRESET,
  BRITE_TANK_PRESET,
  FERMENTER_PRESET,
  HLT_PRESET,
  KETTLE_PRESET,
  MASH_TUN_PRESET,
  TANK_PRESETS,
  WHIRLPOOL_PRESET,
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
export { annotationStyle, HOLODECK_ANNOTATION_STYLE } from '../assets/process/style';
export type { AnnotationStyle } from '../assets/process/style';
export { FaceCamera, FloorText } from '../assets/process/Label';
export type { FloorTextStyle, LabelAlign, LabelOrient } from '../assets/process/Label';
export type { AreaOutline } from '../assets/process/Area';

// Arcentry-parity objects (holodeck#36): connectors, icons, images, metadata, opacity / z-order.
export * from './objects';
export type {
  ApplyStyleOverrides,
  Finish,
  FinishName,
  HolodeckStyle,
  TankBottom,
  TankCap,
  TankNozzle,
  TankParams,
  TankPreset,
  TankPresetId,
  TankSupport,
  TankTop,
} from '../assets/process';
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
export { AnimatedPartRoot } from './anim/AnimatedPartRoot';
export type { AnimationBinding } from './anim/use-iso-animators';
// Superset of the static component in assets/process: adds def / params / animation.
export { HolodeckModel } from './anim/HolodeckModel';
export type { EditorHostMode, EditorMode, EditorState } from './editor/editor-state';
export { BUILTIN_MODEL_URLS, modelUrl } from '../assets/models';

// Obstacle-avoiding pipe routing (pure; see docs/routing.md).
export { buildOccupancy, GeometryRangeError, isFloorPart, MAX_GRID_COORD, resolveRouteEnd, routePipe } from './routing';
export type { Occupancy, OccupancyOptions, ResolvedRouteEnd, RouteEnd, RouteOptions, RoutePath } from './routing';
// Elbow orientation (`params.bend: "auto"`) and vessel-window pipe clipping.
export {
  checkElbows,
  clipPipeEnd,
  cutoutFromWindow,
  elbowArms,
  elbowRotationForArms,
  findWindowConnections,
  inferElbowRotation,
  isAutoElbow,
  pipeAxisDistance,
  resolveAutoElbows,
  resolvePipeClips,
  vesselCutout,
  vesselWall,
  vesselWallSpan,
  vesselWalls,
  DEFAULT_TANK_CUTOUT,
  ELBOW_BEND_PARAM,
} from './routing';
export { resolvePipeRuns, pipeRunSpec, fittingInsideVessel } from './iso/pipe-runs';
export { PIPE_RADIUS, pipeWorldY } from '../assets/process/pipe-math';
export type { PipeRunSpec, ScenePipeRuns } from './iso/pipe-runs';
export type {
  ElbowIssue,
  PipeClip,
  PipeEndClip,
  PipeEndContact,
  VesselCutout,
  VesselWall,
  WallSpan,
  WindowConnection,
} from './routing';
export type { GridPoint, Heading } from './routing';

// Engine contract (@holodeck/sdk docs/PACKAGING.md): descriptor, document envelope, live values, package entry.
export * from './engine';
export { ISO_PACKAGE_MANIFEST, createIsoPackageExtension, isoPackage } from './holodeck-package';
