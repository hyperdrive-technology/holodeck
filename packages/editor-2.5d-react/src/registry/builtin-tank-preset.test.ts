/**
 * The built-in `tank` part's `preset` param (round 5, 2026-10-30): a scene
 * `tank` can be any vessel preset (tank-presets.ts), drawn and routed like
 * core's brewery part of that preset.
 */
import { describe, expect, it } from 'vitest';
import { BUILTIN_ISO_PARTS, TANK_SHAPES, TANK_SHAPE_PLAIN, tankPlacementShape } from './builtin';
import { TANK_PRESETS } from '../../assets/process/tank-presets';
import { DEFAULT_TANK_PARAMS, MIXER_WINDOW_DEG, TANK_WINDOW_DEG, changedTankParams, mergeTankParams, type TankParams } from '../../assets/process/tank-params';
import { usesMixerModel } from '../../assets/process/agitated-vessel';
import { vesselCutout, vesselRadius, vesselWallSpan } from '../routing/vessel-ports';
import { placementFootprint, resolveParams } from './params';
import { createIsoRegistryWithBuiltins } from './default';
import type { IsoPlacement } from '../iso/scene';

const tankDef = BUILTIN_ISO_PARTS.find((p) => p.id === 'tank')!;
const tank = (params: Record<string, unknown> = {}, extra: Partial<IsoPlacement> = {}): IsoPlacement => ({
  id: 't',
  object: 'tank',
  x: 0,
  y: 0,
  params,
  ...extra,
});

describe('tank preset param', () => {
  it('offers plain plus every preset, defaulting to plain', () => {
    expect(TANK_SHAPES).toEqual([TANK_SHAPE_PLAIN, ...Object.keys(TANK_PRESETS)]);
    expect(tankDef.params.preset).toMatchObject({ type: 'enum', default: TANK_SHAPE_PLAIN, options: [...TANK_SHAPES] });
    expect(resolveParams(tankDef, tank()).preset).toBe(TANK_SHAPE_PLAIN);
    expect(resolveParams(tankDef, tank()).radius).toBeUndefined();
  });

  it('a plain tank keeps the original look: no preset params, radius 1, wall on the floor', () => {
    const s = tankPlacementShape({ height: 3.05, params: { preset: 'plain' } });
    expect(s.params).toEqual({});
    expect(s.radius).toBe(DEFAULT_TANK_PARAMS.radius);
    expect(s.height).toBe(3.05);
    expect(s.layout.floorY).toBeCloseTo(-3.05 / 2);
    // Unknown / prototype names are plain too.
    expect(tankPlacementShape({ params: { preset: 'toString' } }).params).toEqual({});
    expect(tankPlacementShape({ params: { preset: 'nope' } }).height).toBe(3.05);
  });

  it('the whirlpool preset draws a flat lid on a skirt at the preset size', () => {
    const s = tankPlacementShape({ params: { preset: 'whirlpool' } });
    expect(mergeTankParams(s.params)).toMatchObject({ top: 'flat', support: 'skirt', nozzle: 'tangential' });
    expect(s.radius).toBe(TANK_PRESETS.whirlpool.radius);
    expect(s.height).toBe(TANK_PRESETS.whirlpool.height);
    // The stand lifts the wall off the floor.
    expect(s.layout.y0 - s.layout.floorY).toBeCloseTo(TANK_PRESETS.whirlpool.params.standHeight ?? 0);
  });

  it('placement height and radius param win over the preset; tuner tankParams win over its shape', () => {
    const s = tankPlacementShape({ height: 1.5, params: { preset: 'whirlpool', radius: 1 } }, { top: 'dome' });
    expect(s.height).toBe(1.5);
    expect(s.radius).toBe(1);
    expect(s.params.top).toBe('dome');
  });

  it('the mash tun preset is the agitated vessel (mixer.glb path in Tank)', () => {
    expect(tankPlacementShape({ params: { preset: 'mash-tun' } }).params.agitator).toBe(true);
  });

  it('routing: a preset tank clips pipes on its own window, wall span and radius', () => {
    expect(vesselCutout(tankDef, tank())?.widthDeg).toBe(TANK_WINDOW_DEG);
    expect(vesselCutout(tankDef, tank({ preset: 'mash-tun' }))?.widthDeg).toBe(MIXER_WINDOW_DEG);
    // Explicit windowYaw / windowDeg params still win.
    expect(vesselCutout(tankDef, tank({ preset: 'mash-tun', windowYaw: 10, windowDeg: 30 }))).toEqual({ centerDeg: 10, widthDeg: 30 });
    expect(vesselWallSpan(tankDef, tank({}, { height: 2 }))).toEqual({ bottomY: 0, topY: 2 });
    const wp = vesselWallSpan(tankDef, tank({ preset: 'whirlpool' }));
    expect(wp.bottomY).toBeCloseTo(0.25);
    expect(wp.topY).toBeCloseTo(0.25 + TANK_PRESETS.whirlpool.height);
    expect(vesselRadius(tankDef, tank({ preset: 'kettle', radius: 0.65 }))).toBe(0.65);
  });
});

/** Review of #228, findings 1 and 2. */
describe('tank radius: one effective radius for drawing, tuning and routing', () => {
  it('the TankTuner Radius slider (tankParams.radius) resizes a plain tank', () => {
    expect(tankPlacementShape({ params: {} }, { radius: 2 }).radius).toBe(2);
    expect(tankPlacementShape({ params: { preset: 'plain' } }, { radius: 0.5 }).radius).toBe(0.5);
  });

  it('precedence: placement radius param, then tankParams.radius, then the preset, then the default', () => {
    expect(tankPlacementShape({ params: { preset: 'kettle', radius: 0.8 } }, { radius: 2 }).radius).toBe(0.8);
    expect(tankPlacementShape({ params: { preset: 'kettle' } }, { radius: 2 }).radius).toBe(2);
    expect(tankPlacementShape({ params: { preset: 'kettle' } }).radius).toBe(TANK_PRESETS.kettle.radius);
    expect(tankPlacementShape({ params: {} }).radius).toBe(DEFAULT_TANK_PARAMS.radius);
  });

  it('routing clips a preset tank with no radius param at the radius it is drawn with', () => {
    const kettle = tank({ preset: 'kettle' });
    expect(vesselRadius(tankDef, kettle)).toBe(TANK_PRESETS.kettle.radius);
    expect(vesselRadius(tankDef, kettle)).toBe(tankPlacementShape(kettle).radius);
    expect(vesselRadius(tankDef, tank({ preset: 'whirlpool' }))).toBe(TANK_PRESETS.whirlpool.radius);
    expect(vesselRadius(tankDef, tank())).toBe(1);
  });
});

describe('tank footprint follows the effective radius', () => {
  it('plain and kettle stay 2x2; the whirlpool preset (R 1.1) covers 3x3', () => {
    expect(placementFootprint(createIsoRegistryWithBuiltins(), tank())).toEqual({ w: 2, h: 2 });
    expect(tankDef.footprintOf?.(tank({ preset: 'kettle' }))).toEqual({ w: 2, h: 2 });
    expect(tankDef.footprintOf?.(tank({ preset: 'whirlpool' }))).toEqual({ w: 3, h: 3 });
    expect(tankDef.footprintOf?.(tank({ preset: 'whirlpool', radius: 1 }))).toEqual({ w: 2, h: 2 });
  });
});

/** holodeck#233: the TankTuner passes a FULL TankParams (mixerModel: false by default). */
describe('the tuner cannot switch mixerModel off', () => {
  it('a mash tun under the tuner defaults keeps mixerModel', () => {
    expect(tankPlacementShape({ params: { preset: 'mash-tun' } }, DEFAULT_TANK_PARAMS).params.mixerModel).toBe(true);
  });
  it('and a plain tank does not gain it', () => {
    expect(tankPlacementShape({ params: {} }, { ...DEFAULT_TANK_PARAMS, mixerModel: true }).params.mixerModel).toBeUndefined();
  });
});

/** holodeck#235: an open tuner (default state) must leave the mash tun on mixer.glb. */
describe('the TankTuner hands parts only what was changed', () => {
  const mash = tank({ preset: 'mash-tun' });
  const drawsGlb = (tankParams: Partial<TankParams>) => usesMixerModel(tankPlacementShape(mash, tankParams).params);

  it('default tuner state: the mash tun stays mixer.glb', () => {
    expect(drawsGlb(changedTankParams(DEFAULT_TANK_PARAMS))).toBe(true);
  });
  it('a moved window slider takes it to the procedural body', () => {
    expect(drawsGlb(changedTankParams({ ...DEFAULT_TANK_PARAMS, windowDeg: 70 }))).toBe(false);
  });
  it('changedTankParams keeps only the keys that differ from the defaults', () => {
    expect(changedTankParams(DEFAULT_TANK_PARAMS)).toEqual({});
    expect(changedTankParams({ ...DEFAULT_TANK_PARAMS, radius: 2, showWall: false })).toEqual({ radius: 2, showWall: false });
  });
});
