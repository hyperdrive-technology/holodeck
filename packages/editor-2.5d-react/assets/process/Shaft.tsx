import type { Vector3Tuple } from 'three';

export function Shaft({ position, height = 3 }: { position: Vector3Tuple; height?: number }) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[0.05, 0.05, height, 8]} />
      <meshPhongMaterial color="#9aa0a6" />
    </mesh>
  );
}
