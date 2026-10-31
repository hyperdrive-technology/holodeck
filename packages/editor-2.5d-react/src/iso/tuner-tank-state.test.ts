/**
 * The TankTuner hands parts exactly the params the user EDITED, whatever
 * their value (fourth review of #228). Diffing against the generic defaults
 * (changedTankParams) lost an edit back to a default value: the mash tun's
 * window slider 70 -> 91 resolved to the preset's 100 while it showed 91.
 */
import { describe, expect, it } from 'vitest';
import { editTankParam, initialTankTuning, resetTankTuning, tankTuningOverrides } from './tuner-tank-state';
import { tankPlacementShape } from '../registry/builtin';
import { usesMixerModel } from '../../assets/process/agitated-vessel';
import { DEFAULT_TANK_PARAMS, changedTankParams, mergeTankParams } from '../../assets/process/tank-params';

const mash = { params: { preset: 'mash-tun' } };
const resolved = (s: ReturnType<typeof initialTankTuning>) => mergeTankParams(tankPlacementShape(mash, tankTuningOverrides(s)).params);

describe('tuner tank state', () => {
  it('untouched: no overrides, the mash tun stays mixer.glb', () => {
    const s = initialTankTuning();
    expect(tankTuningOverrides(s)).toEqual({});
    expect(usesMixerModel(resolved(s))).toBe(true);
  });

  it('window 70 then back to the generic default 91 applies 91 (not the preset 100)', () => {
    let s = editTankParam(initialTankTuning(), 'windowDeg', 70);
    expect(resolved(s).windowDeg).toBe(70);
    s = editTankParam(s, 'windowDeg', DEFAULT_TANK_PARAMS.windowDeg);
    expect(s.params.windowDeg).toBe(91);
    expect(tankTuningOverrides(s)).toEqual({ windowDeg: 91 });
    // The old diff-against-defaults rule saw no edit here (the bug).
    expect(changedTankParams(s.params)).toEqual({});
    expect(resolved(s).windowDeg).toBe(91);
    expect(usesMixerModel(resolved(s))).toBe(false);
  });

  it('reset clears the edits', () => {
    const s = resetTankTuning();
    expect(tankTuningOverrides(editTankParam(s, 'radius', 2))).toEqual({ radius: 2 });
    expect(tankTuningOverrides(resetTankTuning())).toEqual({});
  });

  it('a stored state keeps its edited keys; an old one (no edit list) treats values off the defaults as edited', () => {
    const stored = initialTankTuning({ params: { windowDeg: 91, radius: 2 }, touched: ['windowDeg'] });
    expect(tankTuningOverrides(stored)).toEqual({ windowDeg: 91 });
    const legacy = initialTankTuning({ params: { windowDeg: 91, radius: 2 } });
    expect(tankTuningOverrides(legacy)).toEqual({ radius: 2 });
    expect(tankTuningOverrides(initialTankTuning({ params: {}, touched: ['nope', 'radius'] as never }))).toEqual({ radius: DEFAULT_TANK_PARAMS.radius });
  });
});
