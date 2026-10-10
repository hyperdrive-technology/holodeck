import type { Vector3Tuple } from 'three';
import { Edges } from './Edges';
import { mergeFittingParams, type FittingParams } from './fitting-params';
import { useHolodeckStyle } from './style-context';
import { AccentFill, WhiteFill } from './Shell';
import { sharedValveBody, sharedValveWheel, VALVE_WHEEL_WIRE_SCALE } from './valve-geometry';

/**
 * In-line Arcentry valve: flanged barrel, bonnet + stem, tintable handwheel
 * disc (geometry in valve-geometry.ts, shared with the instanced pool).
 * Only `valveHandwheel` from FittingParams applies; the other valve* fields
 * describe the Blender valve.glb.
 */
export function Valve({
  position,
  rotationY = 0,
  handwheel,
  params,
}: {
  position: Vector3Tuple;
  rotationY?: number;
  handwheel?: string;
  params?: Partial<FittingParams>;
}) {
  const style = useHolodeckStyle();
  const p = mergeFittingParams({ valveHandwheel: style.colors.accent, ...params });
  const hw = handwheel ?? p.valveHandwheel;
  const threshold = style.edges.thresholds.valve;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={sharedValveBody()}>
        <WhiteFill />
        <Edges threshold={threshold} lineWidth={p.pipeWireWidth} />
      </mesh>
      <mesh geometry={sharedValveWheel()}>
        <AccentFill color={hw} />
        <Edges threshold={style.edges.thresholds.valveWheel} lineWidth={p.pipeWireWidth * VALVE_WHEEL_WIRE_SCALE} />
      </mesh>
    </group>
  );
}
