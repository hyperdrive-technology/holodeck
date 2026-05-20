/**
 * @starfleet/viewer-3d-react
 *
 * 3D React viewer for Starfleet infrastructure scenes.
 * Built on React Three Fiber v10 with an opt-in WebGPU renderer path.
 */

export { StarfleetCanvas } from './canvas/StarfleetCanvas';
export { SceneEdgeLine } from './components/SceneEdgeLine';
export { SceneGraph } from './components/SceneGraph';
export { SceneNodeMesh } from './components/SceneNodeMesh';
export { StarfleetViewer3D } from './components/StarfleetViewer3D';

export { DEFAULT_CAMERA, DEFAULT_LIGHTS, NODE_COLORS } from './constants';

export type {
  RendererBackend,
  SceneEdgeLineProps,
  SceneGraphProps,
  SceneNodeMeshProps,
  StarfleetCanvasProps,
  StarfleetViewer3DProps,
} from './types';

export {
  buildNodeMaterial,
  buildNodePositions,
  colorToHex,
  geometryArgs,
  resolveNodeColor,
  resolveNodePosition,
} from './utils/sceneToThree';
