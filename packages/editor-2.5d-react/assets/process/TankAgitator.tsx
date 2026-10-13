import { Edges } from './Edges';
import { WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';
import {
  mixerImpellerBladeLayout,
  mixerShaftLayout,
  MIXER_IMPELLER_BLADES,
  MIXER_IMPELLER_YAW,
  MIXER_IMPELLER_SIDES,
  MIXER_HAT_LID_RING,
  MIXER_HAT_YAW,
  MIXER_AGITATOR_DEPTH_TEST,
  MIXER_AGITATOR_COLOR,
  MIXER_SHAFT_SIDES,
  type TankParams,
} from './tank-params';

/** Name of the spinning group; `findAnimNodes` + the `spin` animator drive it like a GLB `anim.*` node. */
export const AGITATOR_ANIM_NODE = 'anim.agitator';

/**
 * Agitator pieces shared by `Mixer` and the base `Tank`: a squat 8-gon drive
 * hat on the top apex, a shaft from the hat down into the liquid, and a
 * 3-blade impeller. Shaft + blades live in a group named `anim.agitator` so
 * a part can bind `agitatorRpm` to the built-in `spin` animator exactly as
 * the GLB parts do (the group spins about Y).
 *
 * `apexY` is where the hat sits (dome apex / lid top) in the tank's local
 * frame; `mixerShaftLayout` already derives that from `params` for the
 * mixer, so callers pass it explicitly only when the vessel top differs.
 */
export function TankAgitator({
  tankH,
  fill,
  params: p,
  apexY,
}: {
  tankH: number;
  fill: number;
  params: TankParams;
  apexY?: number;
}) {
  const style = useHolodeckStyle();
  const base = mixerShaftLayout(tankH, fill, p);
  // Re-seat the hat on a different apex (flat / cone lids) without changing the mixer's maths.
  const shift = apexY === undefined ? 0 : apexY - base.domeApex;
  const layout = {
    ...base,
    neckMidY: base.neckMidY + shift,
    lidMidY: base.lidMidY + shift,
    lidTop: base.lidTop + shift,
    shaftTop: base.shaftTop + shift,
  };
  const shaftBot = Math.min(layout.shaftTop - Math.max(0.2, tankH * p.shaftLength), layout.liquidY);
  const shaftH = layout.shaftTop - shaftBot;
  const shaftY = (layout.shaftTop + shaftBot) / 2;
  const blades = mixerImpellerBladeLayout(p.impellerSpan, p.shaftRadius);
  const hatSegs = 8;
  return (
    <>
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
      <group name={AGITATOR_ANIM_NODE}>
        <mesh position={[0, shaftY, 0]} renderOrder={4}>
          <cylinderGeometry args={[p.shaftRadius, p.shaftRadius, shaftH, MIXER_SHAFT_SIDES]} />
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
    </>
  );
}
