import { useMemo } from 'react';
import { DoubleSide } from 'three';
import { Edges } from './Edges';
import { annotationStyle, GROUND_CONTACT_EPSILON } from './style';
import { useHolodeckStyle } from './style-context';
import type { Vector3Tuple } from 'three';
import { rectPolyline, type DashStyle } from '../../src/objects/stroke';
import { StrokeMeshView } from '../../src/objects/StrokeMeshView';

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

/** Area border: `solid` is the original 1 px outline; dashed / dotted are world-width floor ribbons. */
export type AreaOutline = DashStyle | 'none';

/** Shadow offset per level, world units toward screen-bottom (+x, +z). */
export const AREA_SHADOW_STEP = 0.12;
/** Highest shadow level (Arcentry offers 0..3). */
export const AREA_MAX_SHADOW = 3;

export function Area({
  position,
  size,
  fill,
  outline,
  outlineStyle = 'solid',
  shadow = 0,
  walled = false,
  wallHeight,
}: {
  position: Vector3Tuple;
  size: [number, number];
  /** Fill colour; default the theme's `areaFill`. */
  fill?: string;
  /** Border colour; default the theme's `areaEdge`. */
  outline?: string;
  outlineStyle?: AreaOutline;
  /** 0 (none) .. 3: a soft offset shadow under the slab. */
  shadow?: number;
  /** Arcentry's walled ("VPN") area: translucent walls around the border. */
  walled?: boolean;
  /** Wall height in world units; default the theme's `areaWallHeight`. */
  wallHeight?: number;
}) {
  const style = useHolodeckStyle();
  const tokens = annotationStyle(style);
  const edge = outline || style.colors.areaEdge;
  const [w, h] = size;
  const level = Math.max(0, Math.min(AREA_MAX_SHADOW, Math.round(shadow)));
  const border = useMemo(() => rectPolyline(0, 0, w, h), [w, h]);
  return (
    <group position={[position[0], 0, position[2]]}>
      <mesh position={[0, AREA_Y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={size} />
        <meshBasicMaterial color={fill || style.colors.areaFill} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
        {outlineStyle === 'solid' ? <Edges threshold={style.edges.thresholds.area} color={edge} /> : null}
      </mesh>
      {level > 0 ? (
        // Below the slab (one more contact gap down) and offset toward the viewer, so it peeks out bottom-right.
        <mesh
          position={[AREA_SHADOW_STEP * level, AREA_Y - GROUND_CONTACT_EPSILON / 2, AREA_SHADOW_STEP * level]}
          rotation={[-Math.PI / 2, 0, 0]}
          userData={{ hdAreaShadow: level }}
        >
          <planeGeometry args={size} />
          <meshBasicMaterial color={tokens.shadow} transparent opacity={tokens.shadowOpacity * level} depthWrite={false} />
        </mesh>
      ) : null}
      {outlineStyle === 'dashed' || outlineStyle === 'dotted' ? (
        <StrokeMeshView
          points={border}
          y={AREA_Y + GROUND_CONTACT_EPSILON / 2}
          color={edge}
          options={{ width: tokens.areaOutlineWidth, dash: outlineStyle }}
        />
      ) : null}
      {walled ? <AreaWalls w={w} h={h} height={wallHeight ?? tokens.areaWallHeight} color={tokens.areaWall} opacity={tokens.areaWallOpacity} edge={edge} /> : null}
    </group>
  );
}

/** Four translucent walls on the area border, each outlined. */
function AreaWalls({ w, h, height, color, opacity, edge }: { w: number; h: number; height: number; color: string; opacity: number; edge: string }) {
  const walls: Array<{ pos: Vector3Tuple; rotY: number; len: number }> = [
    { pos: [0, height / 2, -h / 2], rotY: 0, len: w },
    { pos: [0, height / 2, h / 2], rotY: 0, len: w },
    { pos: [-w / 2, height / 2, 0], rotY: Math.PI / 2, len: h },
    { pos: [w / 2, height / 2, 0], rotY: Math.PI / 2, len: h },
  ];
  return (
    <group userData={{ hdAreaWalls: true }}>
      {walls.map((wall, i) => (
        <mesh key={i} position={wall.pos} rotation={[0, wall.rotY, 0]} renderOrder={4}>
          <planeGeometry args={[wall.len, height]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} side={DoubleSide} depthWrite={false} toneMapped={false} />
          <Edges threshold={1} color={edge} />
        </mesh>
      ))}
    </group>
  );
}
