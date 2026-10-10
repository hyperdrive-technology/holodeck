import { Edges } from './Edges';
import type { Vector3Tuple } from 'three';
import { mergeFittingParams, type FittingParams } from './fitting-params';
import { elbowOffsetShift } from './pipe-math';
import { WhiteMesh } from './Shell';
import { useHolodeckStyle } from './style-context';

/**
 * Quarter-torus 90° bend in the floor plane (manhattan corners): tube radius
 * = pipe radius, ELBOW_SWEEP faceted sweep steps, centred (via elbowOffset)
 * so the mouths land where `trimRun` ends the adjoining pipes.
 * Knuckles are pipe-to-tank blobs, not 90° corners.
 */
export function Elbow({
  position,
  rotationY = 0,
  knuckle = false,
  params,
}: {
  position: Vector3Tuple;
  rotationY?: number;
  knuckle?: boolean;
  params?: Partial<FittingParams>;
}) {
  const style = useHolodeckStyle();
  const p = mergeFittingParams(params);
  const radial = Math.max(3, Math.round(p.elbowRadial));
  const tubular = Math.max(4, Math.round(p.elbowTubular));
  const knuckleSides = Math.max(3, Math.round(p.knuckleSides));
  if (knuckle) {
    const alongX = rotationY !== 0;
    return (
      <WhiteMesh
        position={position}
        rotation={alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[p.knuckleRadius, p.knuckleRadius, p.knuckleLen, knuckleSides]} />
        <Edges threshold={style.edges.thresholds.pipe} lineWidth={p.pipeWireWidth} />
      </WhiteMesh>
    );
  }
  const [ox, oz] = elbowOffsetShift(0, p.elbowOffset);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Local +X/+Z is the mouth bisector; parent yaw maps it onto the L. */}
      <WhiteMesh
        position={[ox, 0, oz]}
        rotation={[Math.PI / 2, 0, (p.elbowCapDeg * Math.PI) / 180]}
      >
        <torusGeometry args={[p.elbowMajor, p.pipeRadius, radial, tubular, Math.PI / 2]} />
        {p.elbowShowWire ? (
          <Edges threshold={p.elbowEdgeThreshold} lineWidth={p.pipeWireWidth} />
        ) : null}
      </WhiteMesh>
    </group>
  );
}
