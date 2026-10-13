import type { Vector3Tuple } from 'three';
import { useHolodeckStyle } from './style-context';
import { Tank } from './Tank';
import { TankAgitator } from './TankAgitator';
import { mergeTankParams, type TankParams } from './tank-params';

/**
 * Same cutaway cylinder + dome as Tank, plus mixer bottle shoulders
 * (cosine lathe into the dome), a rounded outer heel, a squat agitator hat
 * on the dome apex, and a shaft + 3-blade impeller in the window.
 * The hat / shaft / impeller are `TankAgitator`, shared with the base
 * Tank's `agitator` param so both vessels draw the same agitator.
 */
export function Mixer({
  position,
  fill = 0.45,
  fillColor,
  height = 3.5,
  alarm,
  params,
}: {
  position: Vector3Tuple;
  fill?: number;
  fillColor?: string;
  height?: number;
  alarm?: boolean;
  params?: Partial<TankParams>;
}) {
  const style = useHolodeckStyle();
  const p = mergeTankParams({ edgeColor: style.colors.edge, ...params });
  const tankH = height ?? p.height;
  return (
    <group position={position}>
      <Tank
        position={[0, 0, 0]}
        fill={fill}
        fillColor={fillColor}
        height={tankH}
        alarm={alarm}
        cap="dome"
        params={params}
      />
      <TankAgitator tankH={tankH} fill={fill} params={p} />
    </group>
  );
}
