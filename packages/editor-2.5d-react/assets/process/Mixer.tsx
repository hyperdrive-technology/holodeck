import type { Vector3Tuple } from 'three';
import { Tank } from './Tank';
import type { TankParams } from './tank-params';

/**
 * The agitated vessel: the base `Tank` with a dome and `agitator: true`, so
 * the Mixer palette part and agitated presets (mash tun) share one code path
 * (hat / shaft / impeller are `TankAgitator`, drawn by Tank). The bottle body
 * (shoulder, heel, window) comes from `params`; the registry passes
 * `MIXER_BODY_PRESET` + `AGITATOR_PRESET` (src/registry/builtin.tsx).
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
      params={{ agitator: true, ...params }}
    />
  );
}
