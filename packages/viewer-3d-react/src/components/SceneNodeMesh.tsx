/**
 * Renders a single Starfleet scene node as a Three.js mesh
 */

import { useMemo } from 'react';
import type { SceneNodeMeshProps } from '../types';
import {
  buildNodeMaterial,
  geometryArgs,
  resolveNodePosition,
  resolveNodeRotation,
  resolveNodeScale,
} from '../utils/sceneToThree';

export function SceneNodeMesh({
  node,
  selected = false,
  onSelect,
}: SceneNodeMeshProps) {
  const position = resolveNodePosition(node);
  const rotation = resolveNodeRotation(node);
  const scale = resolveNodeScale(node);
  const { type, args } = geometryArgs(node.geometry);
  const material = useMemo(() => buildNodeMaterial(node), [node]);

  const handleClick = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onSelect?.(node);
  };

  const outlineScale = selected ? 1.08 : 1;
  const meshScale: [number, number, number] = [
    scale[0] * outlineScale,
    scale[1] * outlineScale,
    scale[2] * outlineScale,
  ];

  return (
    <group>
      <mesh
        position={position}
        rotation={rotation}
        scale={meshScale}
        onClick={handleClick}
        castShadow
        receiveShadow
      >
        {type === 'box' && <boxGeometry args={args as [number, number, number]} />}
        {type === 'sphere' && <sphereGeometry args={args as [number, number, number]} />}
        {type === 'cylinder' && (
          <cylinderGeometry
            args={args as [number, number, number, number]}
          />
        )}
        {type === 'plane' && <planeGeometry args={args as [number, number]} />}
        <meshStandardMaterial
          color={material.color}
          metalness={material.metalness}
          roughness={material.roughness}
          transparent={material.transparent}
          opacity={material.opacity}
          emissive={selected ? '#4488ff' : '#000000'}
          emissiveIntensity={selected ? 0.35 : 0}
        />
      </mesh>
    </group>
  );
}
