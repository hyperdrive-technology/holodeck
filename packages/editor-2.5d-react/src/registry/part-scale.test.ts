import { describe, expect, it } from 'vitest';
import { partScale } from './part-scale';

describe('partScale', () => {
  it('defaults to 1', () => expect(partScale({})).toBe(1));
  it('returns a valid scale', () => expect(partScale({ scale: 1.6 })).toBe(1.6));
  it.each([0, -2, NaN, Infinity])('falls back to 1 for %s', (scale) => expect(partScale({ scale })).toBe(1));
});
