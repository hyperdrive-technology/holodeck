import { Edges } from './Edges';
import { ShadedMesh, WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';
import {
  mixerImpellerBladeLayout,
  mixerShaftLayout,
  MIXER_BLADE_PITCH,
  MIXER_IMPELLER_BLADES,
  MIXER_IMPELLER_YAW,
  MIXER_HAT_SIDES,
  MIXER_AGITATOR_DEPTH_TEST,
  MIXER_AGITATOR_COLOR,
  MIXER_IMPELLER_COLOR,
  MIXER_SHAFT_SIDES,
  type TankParams,
} from './tank-params';

/** Name of the spinning group; `findAnimNodes` + the `spin` animator drive it like a GLB `anim.*` node. */
export const AGITATOR_ANIM_NODE = 'anim.agitator';

/** Crease threshold (degrees) for the round hat: 15° facets of the 24-gon stay smooth, the 90° rims draw. */
const HAT_EDGE_THRESHOLD = 20;

/**
 * Agitator pieces shared by `Mixer` and the base `Tank` (`agitator` param):
 * a round drive hat (neck + drum + cover plate) on the top apex, a shaft from
 * the hat down into the liquid, and a hub with three pitched blades. The
 * shaft ends inside the hub (`mixerShaftLayout`), so the impeller can never
 * float off it. Shaft + hub + blades live in a group named `anim.agitator`
 * so a part can bind `agitatorRpm` to the built-in `spin` animator exactly
 * as the GLB parts do (the group spins about Y).
 *
 * `apexY` is where the hat sits (dome apex / lid top) in the tank's local
 * frame; without it the dome apex is derived from `params` (the Mixer).
 * `fill` is accepted for API compatibility and ignored: the impeller height
 * no longer follows the liquid level.
 */
export function TankAgitator({
  tankH,
  params: p,
  apexY,
}: {
  tankH: number;
  /** @deprecated Ignored since the impeller stopped riding the waterline (2026-10-29). */
  fill?: number;
  params: TankParams;
  apexY?: number;
}) {
  const style = useHolodeckStyle();
  const layout = mixerShaftLayout(tankH, p, apexY);
  const blades = mixerImpellerBladeLayout(p.impellerSpan, p.shaftRadius, p.impellerRadius);
  const shade = { shadeMin: p.shadeMin, shadeMax: p.shadeMax, hubWhite: p.hubWhite };
  return (
    <>
      <ShadedMesh radius={layout.neckR} {...shade} position={[0, layout.neckMidY, 0]}>
        <cylinderGeometry args={[layout.neckR, layout.neckR, layout.neckH, MIXER_HAT_SIDES, 1, true]} />
        <Edges threshold={HAT_EDGE_THRESHOLD} color={p.edgeColor} lineWidth={p.capLineWidth} />
      </ShadedMesh>
      <ShadedMesh radius={layout.capR} {...shade} position={[0, layout.drumMidY, 0]}>
        <cylinderGeometry args={[layout.capR, layout.capR, layout.drumH, MIXER_HAT_SIDES]} />
        <Edges threshold={HAT_EDGE_THRESHOLD} color={p.edgeColor} lineWidth={p.capLineWidth} />
      </ShadedMesh>
      <mesh position={[0, layout.lidMidY, 0]}>
        <cylinderGeometry args={[layout.capR * 1.04, layout.capR * 1.04, layout.lidH, MIXER_HAT_SIDES]} />
        <WhiteFill />
        <Edges threshold={HAT_EDGE_THRESHOLD} color={p.edgeColor} lineWidth={p.capLineWidth} />
      </mesh>
      <group name={AGITATOR_ANIM_NODE}>
        <mesh position={[0, layout.shaftY, 0]}>
          <cylinderGeometry args={[p.shaftRadius, p.shaftRadius, layout.shaftH, MIXER_SHAFT_SIDES]} />
          <meshBasicMaterial color={MIXER_AGITATOR_COLOR} toneMapped={false} depthTest={MIXER_AGITATOR_DEPTH_TEST} />
        </mesh>
        <mesh position={[0, layout.impellerY, 0]}>
          <cylinderGeometry args={[blades.hubR, blades.hubR, blades.hubH, 12]} />
          <meshBasicMaterial color={MIXER_IMPELLER_COLOR} toneMapped={false} depthTest={MIXER_AGITATOR_DEPTH_TEST} />
          <Edges threshold={40} color={p.edgeColor} lineWidth={p.capLineWidth} />
        </mesh>
        {Array.from({ length: MIXER_IMPELLER_BLADES }, (_, i) => (
          // Yaw the blade's arm around the shaft, then pitch the paddle about its own (radial) axis.
          <group
            key={`imp-${i}`}
            position={[0, layout.impellerY, 0]}
            rotation={[0, MIXER_IMPELLER_YAW + (i * Math.PI * 2) / MIXER_IMPELLER_BLADES, 0]}
          >
            <mesh position={[blades.radial, 0, 0]} rotation={[MIXER_BLADE_PITCH, 0, 0]}>
              <boxGeometry args={[blades.bladeLen, blades.thickness, blades.chord]} />
              <meshBasicMaterial color={MIXER_IMPELLER_COLOR} toneMapped={false} depthTest={MIXER_AGITATOR_DEPTH_TEST} />
              <Edges threshold={1} color={p.edgeColor} lineWidth={p.capLineWidth} />
            </mesh>
          </group>
        ))}
      </group>
    </>
  );
}
