import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { liquidShades } from './tank-params';

describe('liquidShades', () => {
  it('lightens the free surface and darkens the side so a low fill reads as a column', () => {
    const base = new Color('#4aa3d9');
    const { surface, side } = liquidShades('#4aa3d9');
    const lum = (c: Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    expect(lum(new Color(surface))).toBeGreaterThan(lum(base));
    expect(lum(new Color(side))).toBeLessThan(lum(base));
  });

  it('keeps the hue family (blue stays blue-dominant, amber stays red-dominant)', () => {
    const blue = new Color(liquidShades('#4aa3d9').side);
    expect(blue.b).toBeGreaterThan(blue.r);
    const amber = new Color(liquidShades('#c8792a').surface);
    expect(amber.r).toBeGreaterThan(amber.b);
  });

  it('keeps white white on the surface', () => {
    expect(liquidShades('#ffffff').surface).toBe('#ffffff');
  });
});

import { waterlineRing } from './tank-params';
describe('waterlineRing', () => {
  it('is a closed loop of equal-radius segments at the given height', () => {
    const r = waterlineRing(2, 0.5, 12);
    expect(r.length).toBe(12 * 6);
    for (let i = 0; i < 12; i++) {
      const [x0, y0, z0, x1, y1, z1] = Array.from(r.slice(i * 6, i * 6 + 6));
      expect(y0).toBeCloseTo(0.5);
      expect(y1).toBeCloseTo(0.5);
      expect(Math.hypot(x0, z0)).toBeCloseTo(2);
      expect(Math.hypot(x1, z1)).toBeCloseTo(2);
    }
    // last segment ends where the first starts
    expect(r[12 * 6 - 3]).toBeCloseTo(r[0]);
    expect(r[12 * 6 - 1]).toBeCloseTo(r[2]);
  });
});
