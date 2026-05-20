/**
 * Constants for the 3D React viewer
 */

import type { Color } from '@starfleet/sdk';

/** Default node colors by infrastructure type */
export const NODE_COLORS: Record<string, Color> = {
  server: { r: 0.2, g: 0.8, b: 0.2, a: 1 },
  database: { r: 0.2, g: 0.4, b: 0.9, a: 1 },
  loadbalancer: { r: 0.9, g: 0.6, b: 0.1, a: 1 },
  network: { r: 0.5, g: 0.5, b: 0.9, a: 1 },
  storage: { r: 0.7, g: 0.3, b: 0.8, a: 1 },
  default: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
};

/** Default camera position */
export const DEFAULT_CAMERA = {
  position: [12, 10, 12] as [number, number, number],
  fov: 50,
  near: 0.1,
  far: 1000,
};

/** Scene ambient + directional light defaults */
export const DEFAULT_LIGHTS = {
  ambientIntensity: 0.4,
  directionalIntensity: 1.2,
  directionalPosition: [10, 15, 10] as [number, number, number],
};
