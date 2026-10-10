import { describe, expect, it } from 'vitest';
import { pointerToGrid, snapHalf, snapPoint } from './snap';

describe('snap', () => {
  it('rounds to half cells', () => {
    expect(snapHalf(0)).toBe(0);
    expect(snapHalf(0.24)).toBe(0);
    expect(snapHalf(0.25)).toBe(0.5);
    expect(snapHalf(1.76)).toBe(2);
  });

  it('snaps a point', () => {
    expect(snapPoint(1.2, -0.8)).toEqual({ x: 1, y: -1 });
  });

  it('maps a floor hit through the cell center then snaps', () => {
    expect(pointerToGrid(0.5, 0.5)).toEqual({ x: 0, y: 0 });
    expect(pointerToGrid(1.5, 2.5)).toEqual({ x: 1, y: 2 });
    expect(pointerToGrid(1.2, 2.3)).toEqual({ x: 0.5, y: 2 });
  });
});
