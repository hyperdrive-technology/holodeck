/**
 * Renders a connection between two scene nodes
 */

import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { SceneEdgeLineProps } from '../types';
import { edgeColorToHex } from '../utils/sceneToThree';

export function SceneEdgeLine({
  edge,
  nodePositions,
  selected = false,
  onSelect,
}: SceneEdgeLineProps) {
  const lineObject = useMemo(() => {
    const source = nodePositions.get(edge.source);
    const target = nodePositions.get(edge.target);
    if (!source || !target) {
      return null;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...source, ...target],
        3
      )
    );

    const material = new THREE.LineBasicMaterial({
      color: edgeColorToHex(edge),
      transparent: true,
      opacity: selected ? 1 : 0.75,
    });

    return new THREE.Line(geometry, material);
  }, [edge, nodePositions, selected]);

  if (!lineObject) {
    return null;
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect?.(edge);
  };

  return <primitive object={lineObject} onClick={handleClick} />;
}
