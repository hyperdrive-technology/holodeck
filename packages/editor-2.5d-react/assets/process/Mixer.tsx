import type { Vector3Tuple } from 'three';
import { Tank } from './Tank';
import type { TankParams } from './tank-params';

/**
 * The agitated vessel: the base `Tank` with `agitator: true`, so the Mixer
 * palette part and agitated presets (mash tun) share one code path. Since
 * 2026-10-30 Tank draws it as the Blender mixer.glb (`AgitatedVessel`),
 * scaled to `radius` x `height`, liquid from `fill`, `anim.agitator` spun by
 * the part's `rpm` binding.
 *
 * Before 2026-10-29 the Mixer drew its own `TankAgitator` next to the Tank;
 * now an `agitator: false` in `params` is honoured instead of doubled.
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
  return (
    <Tank
      position={position}
      fill={fill}
      fillColor={fillColor}
      height={height}
      alarm={alarm}
      cap="dome"
      params={{ agitator: true, mixerModel: true, ...params }}
    />
  );
}
