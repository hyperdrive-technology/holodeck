/**
 * Canvas wrapper with WebGL / WebGPU backend selection for React Three Fiber v10
 */

import { Canvas as CanvasDefault } from '@react-three/fiber';
import { Canvas as CanvasLegacy } from '@react-three/fiber/legacy';
import type { ComponentType } from 'react';
import type { StarfleetCanvasProps } from '../types';

type CanvasComponent = ComponentType<StarfleetCanvasProps>;

function resolveCanvas(backend: StarfleetCanvasProps['backend']): {
  Canvas: CanvasComponent;
  useWebGPU: boolean;
} {
  switch (backend) {
    case 'webgpu':
      return { Canvas: CanvasDefault as CanvasComponent, useWebGPU: true };
    case 'webgl':
      return { Canvas: CanvasLegacy as CanvasComponent, useWebGPU: false };
    case 'auto':
    default:
      return { Canvas: CanvasDefault as CanvasComponent, useWebGPU: true };
  }
}

/**
 * Starfleet-branded Canvas that supports the R3F v10 renderer protocol.
 *
 * - `webgl` — legacy WebGLRenderer only (`@react-three/fiber/legacy`)
 * - `webgpu` / `auto` — default R3F import with `renderer` prop for WebGPU when available
 */
export function StarfleetCanvas({
  backend = 'auto',
  children,
  className,
  style,
  ...canvasProps
}: StarfleetCanvasProps) {
  const { Canvas, useWebGPU } = resolveCanvas(backend);

  const rendererProp = useWebGPU
    ? (canvasProps.renderer ?? true)
    : canvasProps.renderer;

  return (
    <div className={className} style={{ width: '100%', height: '100%', ...style }}>
      <Canvas
        {...canvasProps}
        renderer={rendererProp}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
      </Canvas>
    </div>
  );
}
