/**
 * Type definitions for the 3D React viewer
 */

import type { SceneEdge, SceneFile, SceneNode } from '@starfleet/sdk';
import type { CSSProperties, ReactNode } from 'react';
import type { CanvasProps } from '@react-three/fiber';

/** Rendering backend for the Three.js canvas */
export type RendererBackend = 'webgl' | 'webgpu' | 'auto';

export interface StarfleetCanvasProps extends Omit<CanvasProps, 'children'> {
  /** WebGL (default), WebGPU, or auto-detect WebGPU when available */
  backend?: RendererBackend;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export interface StarfleetViewer3DProps {
  /** Scene file to render */
  scene: SceneFile;
  /** Width of the viewer container */
  width?: number | string;
  /** Height of the viewer container */
  height?: number | string;
  /** Renderer backend — use `webgpu` to opt into the WebGPU protocol */
  backend?: RendererBackend;
  /** Whether orbit controls are enabled */
  enableControls?: boolean;
  /** Whether to show a ground grid */
  showGrid?: boolean;
  /** Callback when nodes are selected */
  onNodeSelect?: (nodes: SceneNode[]) => void;
  /** Callback when edges are selected */
  onEdgeSelect?: (edges: SceneEdge[]) => void;
  /** Custom CSS class on the container */
  className?: string;
  /** Custom styles on the container */
  style?: CSSProperties;
  /** Additional Canvas props forwarded to StarfleetCanvas */
  canvasProps?: Omit<CanvasProps, 'children' | 'style' | 'className'>;
}

export interface SceneGraphProps {
  scene: SceneFile;
  onNodeSelect?: (nodes: SceneNode[]) => void;
  onEdgeSelect?: (edges: SceneEdge[]) => void;
}

export interface SceneNodeMeshProps {
  node: SceneNode;
  selected?: boolean;
  onSelect?: (node: SceneNode) => void;
}

export interface SceneEdgeLineProps {
  edge: SceneEdge;
  nodePositions: Map<string, [number, number, number]>;
  selected?: boolean;
  onSelect?: (edge: SceneEdge) => void;
}
