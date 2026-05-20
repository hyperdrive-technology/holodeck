/**
 * Ambient types for @starfleet/sdk when the package is not linked locally.
 * Consumers should install @starfleet/sdk; these declarations enable builds in the monorepo.
 */
declare module '@starfleet/sdk' {
  export interface Vector3 {
    x: number;
    y: number;
    z: number;
  }

  export interface Color {
    r: number;
    g: number;
    b: number;
    a?: number;
  }

  export interface Transform {
    position: Vector3;
    rotation: Vector3;
    scale: Vector3;
  }

  export interface Geometry {
    type: string;
    parameters?: Record<string, number>;
  }

  export interface Material {
    color?: Color;
    metalness?: number;
    roughness?: number;
    opacity?: number;
  }

  export interface SceneNode {
    id: string;
    type: string;
    name: string;
    transform: Transform;
    geometry?: Geometry;
    material?: Material;
    status?: string;
    metrics?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }

  export interface SceneEdge {
    id: string;
    source: string;
    target: string;
    type?: string;
    color?: Color;
    metrics?: Record<string, unknown>;
  }

  export interface SceneFile {
    version: string;
    metadata: {
      name: string;
      description?: string;
      author?: string;
      created?: string;
      tags?: string[];
    };
    scene: {
      nodes: SceneNode[];
      edges: SceneEdge[];
    };
  }
}
