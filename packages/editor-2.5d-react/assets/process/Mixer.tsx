import { Edges } from './Edges';
import type { Vector3Tuple } from 'three';
import { WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';
import { Tank } from './Tank';
import { mergeTankParams, mixerShaftLayout, mixerImpellerBladeLayout, MIXER_IMPELLER_BLADES, MIXER_IMPELLER_YAW, MIXER_IMPELLER_SIDES, MIXER_HAT_LID_RING, MIXER_HAT_YAW, MIXER_AGITATOR_DEPTH_TEST, MIXER_AGITATOR_COLOR, MIXER_SHAFT_SIDES, type TankParams } from './tank-params';

/**
 * Same cutaway cylinder + dome as Tank, plus mixer bottle shoulders
 * (cosine lathe into the dome), a rounded outer heel, a squat agitator hat
 * on the dome apex, and a shaft + 3-blade impeller in the window.
 * Through-center bars dualled as a 6-ray star vs r-mixer propeller.
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
  const layout = mixerShaftLayout(tankH, fill, p);
  const blades = mixerImpellerBladeLayout(p.impellerSpan, p.shaftRadius);
  const hatSegs = 8;
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
      <group rotation={[0, MIXER_HAT_YAW, 0]}>
        <mesh position={[0, layout.neckMidY, 0]}>
          <cylinderGeometry args={[layout.capR, layout.capR, layout.neckH, hatSegs, 1, true]} />
          <WhiteFill />
          <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
        </mesh>
        <mesh position={[0, layout.lidMidY, 0]}>
          <cylinderGeometry args={[layout.capR, layout.capR, layout.lidH, hatSegs]} />
          <WhiteFill />
          <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
        </mesh>
        {MIXER_HAT_LID_RING ? (
          <mesh position={[0, layout.lidTop, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[layout.capR * 0.92, layout.capR, hatSegs]} />
            <meshBasicMaterial color={p.edgeColor} toneMapped={false} />
          </mesh>
        ) : null}
      </group>
      <mesh position={[0, layout.shaftY, 0]} renderOrder={4}>
        <cylinderGeometry args={[p.shaftRadius, p.shaftRadius, layout.shaftH, MIXER_SHAFT_SIDES]} />
        <meshBasicMaterial color={MIXER_AGITATOR_COLOR} toneMapped={false} depthTest={MIXER_AGITATOR_DEPTH_TEST} />
      </mesh>
      {Array.from({ length: MIXER_IMPELLER_BLADES }, (_, i) => (
        <group
          key={`imp-${i}`}
          position={[0, layout.liquidY, 0]}
          rotation={[0, MIXER_IMPELLER_YAW + (i * Math.PI * 2) / MIXER_IMPELLER_BLADES, Math.PI / 2]}
        >
          <mesh position={[0, blades.radial, 0]} renderOrder={4}>
            <cylinderGeometry args={[p.impellerRadius, p.impellerRadius, blades.bladeLen, MIXER_IMPELLER_SIDES]} />
            <meshBasicMaterial color={MIXER_AGITATOR_COLOR} toneMapped={false} depthTest={MIXER_AGITATOR_DEPTH_TEST} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
