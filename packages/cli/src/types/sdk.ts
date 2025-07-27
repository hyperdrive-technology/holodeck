/**
 * Starfleet SDK Types
 * Local implementation until the SDK package is available
 */

export interface SceneFile {
  metadata: SceneMetadata;
  scene: Scene;
}

export interface SceneMetadata {
  name: string;
  version: string;
  description?: string;
  created?: string;
  modified?: string;
  author?: string;
  tags?: string[];
}

export interface Scene {
  nodes: Node[];
  edges: Edge[];
  materials?: Record<string, Material>;
  camera?: Camera;
}

export interface Node {
  id: string;
  type: string;
  position: Position;
  properties?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  type?: string;
  properties?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface Position {
  x: number;
  y: number;
  z?: number;
}

export interface Material {
  type: string;
  properties: Record<string, any>;
}

export interface Camera {
  position: Position3D;
  target: Position3D;
  up?: Position3D;
}

export interface Position3D {
  x: number;
  y: number;
  z: number;
}