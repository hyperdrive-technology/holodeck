import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';
import { strokePolyline, type StrokeOptions, type Vec2 } from './stroke';

/**
 * A flat stroke (stroke.ts) as one unlit mesh at height `y`. The geometry is
 * rebuilt only when the points or options change, and disposed with it.
 */
export function StrokeMeshView({
  points,
  y,
  color,
  options,
  opacity = 1,
  renderOrder = 5,
}: {
  /** World (x, z) pairs. */
  points: readonly Vec2[];
  y: number;
  color: string;
  options: StrokeOptions;
  opacity?: number;
  renderOrder?: number;
}) {
  const { width, dash, startTip, endTip } = options;
  const geometry = useMemo(() => {
    const mesh = strokePolyline(points, { width, dash, startTip, endTip });
    const positions = new Float32Array(mesh.triangles * 9);
    for (let v = 0; v < mesh.triangles * 3; v += 1) {
      positions[v * 3] = mesh.positions[v * 2]!;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = mesh.positions[v * 2 + 1]!;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    return g;
  }, [points, y, width, dash, startTip, endTip]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} renderOrder={renderOrder} userData={{ hdStroke: true }}>
      {/* Triangles wind both ways (tips, corner fills): draw both sides. */}
      <meshBasicMaterial color={color} side={2} transparent={opacity < 1} opacity={opacity} toneMapped={false} depthWrite={opacity >= 1} />
    </mesh>
  );
}
