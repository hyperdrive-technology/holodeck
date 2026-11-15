import { describe, expect, it } from 'vitest';
import { pipeWorldY, PIPE_RADIUS } from '../../assets/process/pipe-math';
import { HOLODECK_STYLE } from '../../assets/process/style';
import { partAccent, partOriginY, stateAccent } from './part-pose';

describe('partOriginY', () => {
  it('puts pipe-axis parts on the pipe axis and everything else on the floor', () => {
    expect(partOriginY({ origin: 'pipe-axis' })).toBeCloseTo(pipeWorldY(PIPE_RADIUS));
    expect(partOriginY({ origin: 'pipe-axis' })).toBeCloseTo(0.32);
    expect(partOriginY({ origin: 'pipe-axis' }, 0.11)).toBeCloseTo(pipeWorldY(0.11));
    expect(partOriginY({ origin: 'floor' })).toBe(0);
    expect(partOriginY({})).toBe(0);
  });

  it('adds the heightParam value per placement, ignoring non-numbers and undeclared lifts', () => {
    expect(partOriginY({ heightParam: 'mountHeight' }, undefined, { mountHeight: 0.2 })).toBeCloseTo(0.2);
    expect(partOriginY({ origin: 'pipe-axis', heightParam: 'mountHeight' }, undefined, { mountHeight: 0.1 })).toBeCloseTo(0.42);
    expect(partOriginY({ heightParam: 'mountHeight' }, undefined, { mountHeight: Number.NaN })).toBe(0);
    expect(partOriginY({ heightParam: 'mountHeight' }, undefined, { mountHeight: '3' })).toBe(0);
    expect(partOriginY({ heightParam: 'mountHeight' })).toBe(0);
    // No heightParam: a param that happens to be called mountHeight does nothing.
    expect(partOriginY({}, undefined, { mountHeight: 2 })).toBe(0);
  });
});

describe('partAccent', () => {
  const style = HOLODECK_STYLE;
  const def = { alarmParam: 'fault', colors: { accent: '#123456' } };

  it('uses the theme alarm colour while the alarm param is true, over every other colour', () => {
    expect(partAccent(def, { fault: true, color: '#00ff00' }, style, '#abcdef')).toBe(style.colors.alarm);
  });

  it('falls back to colour param, placement colour, then the definition accent', () => {
    expect(partAccent(def, { fault: false, color: '#00ff00' }, style, '#abcdef')).toBe('#00ff00');
    expect(partAccent(def, { fault: false, color: '' }, style, '#abcdef')).toBe('#abcdef');
    expect(partAccent(def, { fault: false }, style)).toBe('#123456');
    expect(partAccent({}, {}, style)).toBeUndefined();
  });

  it('only switches on for a real boolean true (a truthy string or 1 is not an alarm)', () => {
    expect(partAccent(def, { fault: 'yes' }, style)).toBe('#123456');
    expect(partAccent(def, { fault: 1 }, style)).toBe('#123456');
    expect(partAccent({ colors: {} }, { fault: true }, style)).toBeUndefined();
  });
});

describe('stateColors', () => {
  const style = HOLODECK_STYLE;
  const beacon = {
    alarmParam: 'fault',
    stateColors: [
      { param: 'red', color: '#ef4444' },
      { param: 'amber', color: '#f59e0b' },
      { param: 'green', color: '#22c55e' },
    ],
  };

  it('uses the first true state colour, after the alarm and before the colour param', () => {
    expect(stateAccent(beacon, { green: true, amber: true }, style)).toBe('#f59e0b');
    expect(stateAccent(beacon, { green: true }, style)).toBe('#22c55e');
    expect(stateAccent(beacon, { green: true, fault: true }, style)).toBe(style.colors.alarm);
    expect(stateAccent(beacon, { green: 'yes' }, style)).toBeUndefined();
    expect(partAccent(beacon, { green: true, color: '#000000' }, style, '#abcdef')).toBe('#22c55e');
    expect(partAccent(beacon, { green: false, color: '#000000' }, style, '#abcdef')).toBe('#000000');
  });
});
