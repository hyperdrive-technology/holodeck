/**
 * Review of #228 (finding 4): Tank drew ANY vessel with `agitator: true` as
 * the fixed mixer.glb, and core's brewery pack exposes `agitator` on every
 * vessel -- a fermenter with an agitator lost its cone, legs and window. The
 * GLB path is now an explicit preset-level flag (`mixerModel`: the Mixer part
 * and the mash tun preset); `agitator` alone keeps the vessel's own body and
 * adds the procedural agitator, as on main. `showLiquid: false` is honoured on
 * the GLB path too.
 */
import { describe, expect, it } from 'vitest';
import { mixerModelFill, usesMixerModel } from '../../assets/process/agitated-vessel';
import { mergeTankParams } from '../../assets/process/tank-params';
import { TANK_PRESETS } from '../../assets/process/tank-presets';

describe('which vessels draw as mixer.glb', () => {
  it('the mash tun preset does (with its agitator)', () => {
    expect(usesMixerModel(mergeTankParams(TANK_PRESETS['mash-tun'].params))).toBe(true);
  });

  it('a fermenter, kettle or plain tank with agitator on keeps its own body', () => {
    for (const id of ['fermenter', 'kettle', 'hlt', 'whirlpool', 'brite-tank'] as const) {
      const p = mergeTankParams({ ...TANK_PRESETS[id].params, agitator: true });
      expect(usesMixerModel(p), id).toBe(false);
    }
    expect(usesMixerModel(mergeTankParams({ agitator: true }))).toBe(false);
    expect(usesMixerModel(mergeTankParams({}))).toBe(false);
  });

  it('the mash tun with its agitator switched off is still the mixer body', () => {
    expect(usesMixerModel(mergeTankParams({ ...TANK_PRESETS['mash-tun'].params, agitator: false }))).toBe(true);
  });
});

describe('mixer.glb liquid', () => {
  it('shows the level, none when empty, none when showLiquid is off', () => {
    expect(mixerModelFill({ showLiquid: true }, 0.5, false)).toBe(0.5);
    expect(mixerModelFill({ showLiquid: true }, 0.5, true)).toBe(0);
    expect(mixerModelFill({ showLiquid: false }, 0.5, false)).toBe(0);
  });
});

describe('mixer.glb only while the shape matches it (second review of #228)', () => {
  const mash = TANK_PRESETS['mash-tun'].params;
  it.each([
    ['top', { top: 'flat' as const }],
    ['bottom', { bottom: 'cone' as const }],
    ['support', { support: 'skirt' as const }],
    ['windowDeg', { windowDeg: 120 }],
    ['windowYawDeg', { windowYawDeg: 0 }],
  ])('a mash tun with %s overridden falls back to the procedural body', (_k, o) => {
    expect(usesMixerModel(mergeTankParams({ ...mash, ...o }))).toBe(false);
  });
  it('restating the preset values keeps the GLB', () => {
    expect(usesMixerModel(mergeTankParams({ ...mash, top: 'dome', bottom: 'flat', support: 'none', windowDeg: 100, windowYawDeg: 45 }))).toBe(true);
  });
});
