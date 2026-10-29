import { useEffect, useMemo } from 'react';
import type { Vector3Tuple } from 'three';
import { Edges } from './Edges';
import { nozzleStubGeometry, type NozzleStubSpec } from './flange';
import { ShadedFill } from './Shell';

/** Crease threshold: the 16-gon tube facets (22.5°) stay smooth, the flange's 90° steps outline. */
export const NOZZLE_EDGE_THRESHOLD = 30;

/**
 * A short nozzle stub with a flange ring at its free end (flange.ts
 * `nozzleStubGeometry`), placed at `position` (its shell end) and turned so
 * local +Y runs along the stub (`quaternion`, e.g. from `tankNozzlePose`).
 */
export function NozzleStub({
  position,
  quaternion,
  edgeColor,
  lineWidth,
  shade,
  ...spec
}: NozzleStubSpec & {
  position: Vector3Tuple;
  quaternion: [number, number, number, number];
  edgeColor: string;
  lineWidth: number;
  /** Iso shade (the vessel's): a round white tube has no creases to outline, so shading gives it form. */
  shade: { shadeMin: number; shadeMax: number; hubWhite: number };
}) {
  const geometry = useMemo(
    () => nozzleStubGeometry(spec),
    [spec.length, spec.radius, spec.sides, spec.flangeScale, spec.flangeThickness],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh position={position} quaternion={quaternion} geometry={geometry}>
      <ShadedFill radius={spec.radius} {...shade} />
      <Edges threshold={NOZZLE_EDGE_THRESHOLD} color={edgeColor} lineWidth={lineWidth} />
    </mesh>
  );
}
