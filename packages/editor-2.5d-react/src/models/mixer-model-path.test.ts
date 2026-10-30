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
