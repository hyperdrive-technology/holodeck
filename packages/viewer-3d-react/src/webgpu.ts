/**
 * WebGPU / TSL entry point — re-exports R3F v10 WebGPU hooks and Starfleet components.
 *
 * Import from `@starfleet/viewer-3d-react/webgpu` when building TSL shaders or
 * requiring the WebGPURenderer import path explicitly.
 */

export {
  Canvas,
  useFrame,
  useThree,
  useUniforms,
  useNodes,
  useLocalNodes,
} from '@react-three/fiber/webgpu';

export { StarfleetCanvas } from './canvas/StarfleetCanvas';
export { SceneGraph } from './components/SceneGraph';
export { StarfleetViewer3D } from './components/StarfleetViewer3D';
export type { RendererBackend, StarfleetCanvasProps, StarfleetViewer3DProps } from './types';
