import { Edges } from './Edges';
import { useHolodeckStyle } from './style-context';
import type { Vector3Tuple } from 'three';

/** Top of the supply slab. Labels use LABEL_PLANE_Y just above this. */
export const AREA_Y = 0.02;

export function Area({
  position,
  size,
}: {
  position: Vector3Tuple;
  size: [number, number];
}) {
  const style = useHolodeckStyle();
  return (
    <mesh position={[position[0], AREA_Y, position[2]]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial color={style.colors.areaFill} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      <Edges threshold={style.edges.thresholds.area} color={style.colors.areaEdge} />
    </mesh>
  );
}
