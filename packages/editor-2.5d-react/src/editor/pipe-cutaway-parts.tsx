/**
 * Brewery vessel parts mirrored for the pipe-cutaway render (see
 * pipe-cutaway-main.tsx for why they are mirrored, not imported). Shared by
 * the page and by pipe-cutaway-render.test.ts, which uses the same registry
 * to find the window entries it crops.
 */
import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { Tank } from '../../assets/process/Tank';
import { TANK_PRESETS, type TankPresetId } from '../../assets/process/tank-presets';
import { mergeTankParams, tankLayout, tankWallSpan, vesselFootprint } from '../../assets/process/tank-params';
import { gridToWorld } from '../iso/grid';
import type { IsoPlacement } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPartDefinition, IsoPartProps } from '../registry/types';

const COPPER = '#c8792a';
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function presetVessel(id: string, presetId: TankPresetId): IsoPartDefinition {
  const preset = TANK_PRESETS[presetId];
  const base = mergeTankParams(preset.params);
  const shapeOf = (placement: IsoPlacement) => {
    const radius = num(placement.params?.radius, preset.radius);
    const height = num(placement.params?.height, preset.height);
    const params = {
      ...preset.params,
      windowYawDeg: num(placement.params?.windowYaw, base.windowYawDeg),
      windowDeg: num(placement.params?.windowDeg, base.windowDeg),
    };
    return { radius, height, params, layout: tankLayout(height, radius, mergeTankParams(params)) };
  };
  function Part({ placement }: IsoPartProps) {
    const [wx, , wz] = gridToWorld(placement.x, placement.y);
    const s = shapeOf(placement);
    return (
      <Tank
        position={[wx, -s.layout.floorY, wz]}
        radius={s.radius}
        height={s.height}
        fill={Math.min(1, Math.max(0, num(placement.params?.level, 40) / 100))}
        fillColor={COPPER}
        params={s.params}
      />
    );
  }
  return {
    id: `brewery:${id}`,
    label: id,
    footprint: vesselFootprint(preset.radius),
    footprintOf: (p) => vesselFootprint(shapeOf(p).radius),
    params: {
      radius: { type: 'number', label: 'Radius', default: preset.radius },
      height: { type: 'number', label: 'Height', default: preset.height },
      windowYaw: { type: 'number', label: 'Cutout yaw', default: base.windowYawDeg },
      windowDeg: { type: 'number', label: 'Cutout width', default: base.windowDeg },
    },
    wallSpan: (p) => tankWallSpan(shapeOf(p).layout),
    component: Part,
  };
}

const VESSELS: Array<[string, TankPresetId]> = [
  ['hlt', 'hlt'],
  ['mash-tun', 'mash-tun'],
  ['kettle', 'kettle'],
  ['whirlpool', 'whirlpool'],
  ['fermenter', 'fermenter'],
  ['brite-tank', 'brite-tank'],
];

/** Built-ins plus the mirrored `brewery:*` vessels. */
export function createCutawayRegistry(): ContributionRegistry {
  const registry = createIsoRegistryWithBuiltins();
  registry.install({
    id: 'test.cutaway-vessels',
    version: '0.0.0',
    label: 'Brewery vessels (test mirror)',
    contributions: { [HOLODECK_KINDS.isoPart]: VESSELS.map(([id, preset]) => presetVessel(id, preset)) },
  });
  return registry;
}

/** Part ids the test keeps; other `brewery:*` parts (pumps, heat exchanger GLBs) are dropped. */
export const CUTAWAY_VESSEL_IDS: ReadonlySet<string> = new Set(VESSELS.map(([id]) => `brewery:${id}`));

