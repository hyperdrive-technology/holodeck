/**
 * Main 3D viewer for Starfleet scenes — React Three Fiber with WebGPU upgrade path
 */

import { OrbitControls } from '@react-three/drei';
import { Suspense } from 'react';
import { StarfleetCanvas } from '../canvas/StarfleetCanvas';
import { DEFAULT_CAMERA, DEFAULT_LIGHTS } from '../constants';
import type { StarfleetViewer3DProps } from '../types';
import { SceneGraph } from './SceneGraph';

function SceneLights() {
  return (
    <>
      <ambientLight intensity={DEFAULT_LIGHTS.ambientIntensity} />
      <directionalLight
        position={DEFAULT_LIGHTS.directionalPosition}
        intensity={DEFAULT_LIGHTS.directionalIntensity}
        castShadow
      />
    </>
  );
}

function ViewerFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#94a3b8" wireframe />
    </mesh>
  );
}

export function StarfleetViewer3D({
  scene,
  width = '100%',
  height = '600px',
  backend = 'auto',
  enableControls = true,
  showGrid = true,
  onNodeSelect,
  onEdgeSelect,
  className,
  style,
  canvasProps,
}: StarfleetViewer3DProps) {
  return (
    <div
      className={className}
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '8px',
        background: '#0f172a',
        ...style,
      }}
    >
      <StarfleetCanvas
        backend={backend}
        camera={{
          position: DEFAULT_CAMERA.position,
          fov: DEFAULT_CAMERA.fov,
          near: DEFAULT_CAMERA.near,
          far: DEFAULT_CAMERA.far,
        }}
        shadows
        {...canvasProps}
        style={{ width: '100%', height: '100%' }}
      >
        <color attach="background" args={['#0f172a']} />
        <SceneLights />
        {showGrid && (
          <gridHelper args={[40, 40, '#334155', '#475569']} />
        )}
        <Suspense fallback={<ViewerFallback />}>
          <SceneGraph
            scene={scene}
            {...(onNodeSelect ? { onNodeSelect } : {})}
            {...(onEdgeSelect ? { onEdgeSelect } : {})}
          />
        </Suspense>
        {enableControls && <OrbitControls makeDefault />}
      </StarfleetCanvas>
    </div>
  );
}
