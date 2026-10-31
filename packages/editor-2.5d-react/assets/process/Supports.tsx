import { useMemo } from 'react';
import { Edges } from './Edges';
import { ShadedMesh, WhiteFill } from './Shell';
import { cylinderArcSegments, legPositions } from './tank-params';
import { LineSet } from './LineSet';

/**
 * Vessel stands: `legs` (thin 6-gon posts at LEG_RADIUS_RATIO of the tank
 * radius) or `skirt` (an iso-shaded open cylinder at 0.9 R with a floor rim).
 * Heights come from the caller (Tank works them out from the bottom closure
 * and the heel).
 */
export function Supports({
  kind,
  tankR,
  floorY,
  top,
  legCount,
  legRadius,
  segs,
  edgeColor,
  lineWidth,
  edgeThreshold,
  shade,
}: {
  kind: 'none' | 'legs' | 'skirt';
  tankR: number;
  /** Ground level in the tank frame. */
  floorY: number;
  /** Where the legs / skirt meet the vessel. */
  top: number;
  legCount: number;
  legRadius: number;
  segs: number;
  edgeColor: string;
  lineWidth: number;
  edgeThreshold: number;
  shade: { shadeMin: number; shadeMax: number; hubWhite: number };
}) {
  const h = Math.max(0.01, top - floorY);
  const skirtR = tankR * SKIRT_RADIUS_RATIO;
  const skirtRim = useMemo(() => cylinderArcSegments(skirtR, floorY, 0, Math.PI * 2, segs), [skirtR, floorY, segs]);
  if (kind === 'legs') {
    return (
      <>
        {legPositions(tankR, legCount).map(([lx, lz], i) => (
          <mesh key={`leg-${i}`} position={[lx, floorY + h / 2, lz]}>
            <cylinderGeometry args={[legRadius, legRadius, h, 6]} />
            <WhiteFill />
            <Edges threshold={edgeThreshold} color={edgeColor} lineWidth={lineWidth} />
          </mesh>
        ))}
      </>
    );
  }
  if (kind === 'skirt') {
    return (
      <>
        <ShadedMesh radius={skirtR} {...shade} position={[0, floorY + h / 2, 0]}>
          <cylinderGeometry args={[skirtR, skirtR, h, segs, 1, true]} />
        </ShadedMesh>
        <LineSet color={edgeColor} width={lineWidth} positions={skirtRim} />
      </>
    );
  }
  return null;
}

/** Skirt radius / tank radius. */
export const SKIRT_RADIUS_RATIO = 0.9;
