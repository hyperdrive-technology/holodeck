import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance, parseHex } from './contrast';

describe('contrast helpers', () => {
  it('parses short and long hex, case-insensitively', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#18BAE6')).toEqual([0x18, 0xba, 0xe6]);
    expect(parseHex(' #000000 ')).toEqual([0, 0, 0]);
  });

  it('rejects non-hex input', () => {
    expect(() => parseHex('red')).toThrow();
    expect(() => parseHex('#ffff')).toThrow();
    expect(() => parseHex('rgb(0,0,0)')).toThrow();
  });

  it('matches WCAG reference values', () => {
    expect(luminance('#000')).toBe(0);
    expect(luminance('#fff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#fff', '#fff')).toBe(1);
    // Symmetric.
    expect(contrastRatio('#fff', '#767676')).toBeCloseTo(contrastRatio('#767676', '#fff'), 10);
    // #767676 on white is the well-known 4.54:1 AA threshold grey.
    expect(contrastRatio('#767676', '#fff')).toBeCloseTo(4.54, 2);
  });

  it('reproduces the holodeck#72 failure (#888 on #fafafa)', () => {
    expect(contrastRatio('#888', '#fafafa')).toBeCloseTo(3.39, 1);
  });
});
