import { describe, expect, it } from 'vitest';
import { convertReading, convertTo, worstQuality, type FlowPortType, type FlowValue } from './values';

describe('worstQuality', () => {
  it('orders good < uncertain < bad, either way round', () => {
    expect(worstQuality('good', 'good')).toBe('good');
    expect(worstQuality('good', 'uncertain')).toBe('uncertain');
    expect(worstQuality('uncertain', 'good')).toBe('uncertain');
    expect(worstQuality('uncertain', 'bad')).toBe('bad');
    expect(worstQuality('bad', 'good')).toBe('bad');
  });
});

describe('convertReading', () => {
  const cases: Array<[FlowPortType, FlowValue, FlowValue, boolean]> = [
    // null is never silently a value: substituted, not exact.
    ['bool', null, false, false],
    ['number', null, 0, false],
    ['string', null, '', false],
    ['any', null, null, true],
    ['bool', true, true, true],
    ['bool', 0, false, true],
    ['bool', 2, true, true],
    ['bool', ' TRUE ', true, true],
    ['bool', 'false', false, true],
    ['bool', '0', false, true],
    ['bool', '1.5', true, true],
    ['bool', '', false, false],
    ['bool', 'maybe', false, false],
    ['number', true, 1, true],
    ['number', false, 0, true],
    ['number', ' 42 ', 42, true],
    ['number', '', 0, false],
    ['number', 'abc', 0, false],
    ['number', 'Infinity', 0, false],
    ['string', 5, '5', true],
    ['string', false, 'false', true],
    ['string', '', '', true],
  ];
  it.each(cases)('%s ← %j gives %j (exact: %s)', (type, input, value, exact) => {
    expect(convertReading(type, input)).toEqual({ value, exact });
    expect(convertTo(type, input)).toBe(value);
  });
});
