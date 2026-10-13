import { Edges } from './Edges';
import { GROUND_CONTACT_EPSILON } from './style';
import { useHolodeckStyle } from './style-context';
import type { Vector3Tuple } from 'three';

/**
 * Top of the supply slab: one contact gap BELOW y = 0, where every part's
 * base, legs and skid sit. It used to be +0.02, which buried the bottom
 * 0.02 of every part standing on an area (the pump skid's and the tank
 * feet's contact outline vanished: about one pixel at zoom 80). Below the
 * parts, their bottom edges always win the depth test; the floor grid (-0.06)
 * does not write depth, so parts on bare floor were never affected.
 * Labels use LABEL_PLANE_Y above y = 0.
 */
export const AREA_Y = -GROUND_CONTACT_EPSILON;

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
