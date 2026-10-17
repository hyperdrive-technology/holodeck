import { describe, expect, it } from 'vitest';
import {
  dashPattern,
  MAX_DASHES,
  pointAt,
  polylineLength,
  rectPolyline,
  simplifyPolyline,
  slicePolyline,
  strokePolyline,
  tipLength,
  type Vec2,
} from './stroke';

/** Sum of triangle areas (absolute), for coverage checks. */
function area(positions: Float32Array): number {
  let total = 0;
  for (let i = 0; i < positions.length; i += 6) {
    const [ax, az, bx, bz, cx, cz] = positions.slice(i, i + 6) as unknown as number[];
    total += Math.abs((bx! - ax!) * (cz! - az!) - (cx! - ax!) * (bz! - az!)) / 2;
  }
  return total;
}

function bounds(positions: Float32Array) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 2) {
    minX = Math.min(minX, positions[i]!);
    maxX = Math.max(maxX, positions[i]!);
    minZ = Math.min(minZ, positions[i + 1]!);
    maxZ = Math.max(maxZ, positions[i + 1]!);
  }
  return { minX, minZ, maxX, maxZ };
}

describe('polyline helpers', () => {
  const L: Vec2[] = [[0, 0], [4, 0], [4, 3]];
  it('measures length and walks arc length', () => {
    expect(polylineLength(L)).toBe(7);
    expect(pointAt(L, 2)).toEqual({ p: [2, 0], dir: [1, 0] });
    expect(pointAt(L, 5)).toEqual({ p: [4, 1], dir: [0, 1] });
    expect(pointAt(L, 99)?.p).toEqual([4, 3]);
    expect(pointAt(L, -3)?.p).toEqual([0, 0]);
    expect(pointAt([[1, 1]], 0)).toBeNull();
    expect(pointAt([[1, 1], [1, 1]], 0)).toBeNull();
  });
  it('simplifies duplicates and collinear interior points, keeping corners and U-turns', () => {
    expect(simplifyPolyline([[0, 0], [0, 0], [1, 0], [2, 0], [2, 1], [2, 2]])).toEqual([[0, 0], [2, 0], [2, 2]]);
    // A reversal is a real corner, not a straight continuation.
    expect(simplifyPolyline([[0, 0], [2, 0], [1, 0]])).toEqual([[0, 0], [2, 0], [1, 0]]);
  });
  it('slices by arc length across corners', () => {
    expect(slicePolyline(L, 3, 5)).toEqual([[3, 0], [4, 0], [4, 1]]);
    expect(slicePolyline(L, 5, 5)).toEqual([]);
    expect(slicePolyline(L, 0, 7)).toEqual(L);
  });
  it('closes a rectangle outline', () => {
    const r = rectPolyline(1, 2, 4, 2);
    expect(r[0]).toEqual(r[r.length - 1]);
    expect(polylineLength(r)).toBe(12);
  });
});

describe('strokePolyline', () => {
  it('a solid straight ribbon covers length x width', () => {
    const m = strokePolyline([[0, 0], [10, 0]], { width: 0.5 });
    expect(m.triangles).toBe(2);
    expect(area(m.positions)).toBeCloseTo(5, 6);
    expect(bounds(m.positions)).toEqual({ minX: 0, minZ: -0.25, maxX: 10, maxZ: 0.25 });
  });

  it('fills the outside of a 90 degree corner', () => {
    const m = strokePolyline([[0, 0], [4, 0], [4, 4]], { width: 1 });
    const b = bounds(m.positions);
    // The outer corner (4.5, -0.5) is covered.
    expect(b.maxX).toBeCloseTo(4.5);
    expect(b.minZ).toBeCloseTo(-0.5);
  });

  it('arrow tips shorten the ribbon and add a triangle pointing along the line', () => {
    const plain = strokePolyline([[0, 0], [10, 0]], { width: 0.1 });
    const arrowed = strokePolyline([[0, 0], [10, 0]], { width: 0.1, endTip: 'arrow' });
    expect(arrowed.triangles).toBe(plain.triangles + 1);
    // The tip apex is the end point; nothing sticks out past it.
    expect(bounds(arrowed.positions).maxX).toBeCloseTo(10);
    const len = tipLength(0.1);
    // The arrowhead is wider than the line.
    expect(bounds(arrowed.positions).maxZ).toBeCloseTo(len * 0.45);
  });

  it('start tips point backwards and dot tips are discs', () => {
    const m = strokePolyline([[0, 0], [10, 0]], { width: 0.1, startTip: 'arrow', endTip: 'dot' });
    const b = bounds(m.positions);
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxX).toBeGreaterThan(10); // dot radius beyond the end
  });

  it('dashed and dotted strokes cover less than solid, with gaps', () => {
    const line: Vec2[] = [[0, 0], [10, 0]];
    const solid = area(strokePolyline(line, { width: 0.1 }).positions);
    const dashed = area(strokePolyline(line, { width: 0.1, dash: 'dashed' }).positions);
    const dotted = area(strokePolyline(line, { width: 0.1, dash: 'dotted' }).positions);
    expect(dashed).toBeLessThan(solid * 0.75);
    expect(dashed).toBeGreaterThan(solid * 0.4);
    expect(dotted).toBeLessThan(dashed);
    expect(dotted).toBeGreaterThan(0);
  });

  it('caps the dash count on absurdly long lines', () => {
    const p = dashPattern('dotted', 0.01, 30000)!;
    expect(30000 / (p.on + p.off)).toBeLessThanOrEqual(MAX_DASHES + 1e-6);
    const m = strokePolyline([[-15000, 0], [15000, 0]], { width: 0.01, dash: 'dotted' });
    expect(m.triangles).toBeLessThanOrEqual(MAX_DASHES * 2 + 2);
    expect(dashPattern('solid', 1, 10)).toBeNull();
  });

  it('returns an empty mesh for degenerate or non-finite input', () => {
    for (const [pts, width] of [
      [[[0, 0]], 1],
      [[[0, 0], [0, 0]], 1],
      [[[0, 0], [1, 0]], 0],
      [[[0, 0], [1, 0]], -1],
      [[[0, 0], [1, 0]], NaN],
      [[[0, 0], [Infinity, 0]], 1],
      [[[NaN, 0], [1, 0]], 1],
    ] as Array<[Vec2[], number]>) {
      expect(strokePolyline(pts, { width }).triangles).toBe(0);
    }
  });

  it('every emitted coordinate is finite', () => {
    const m = strokePolyline([[0, 0], [3, 0], [3, 3], [0, 3]], { width: 0.2, dash: 'dashed', startTip: 'dot', endTip: 'arrow' });
    expect(m.positions.every(Number.isFinite)).toBe(true);
  });

  it('a line shorter than its arrows still draws both tips without inverting', () => {
    const m = strokePolyline([[0, 0], [0.2, 0]], { width: 0.1, startTip: 'arrow', endTip: 'arrow' });
    expect(m.triangles).toBeGreaterThanOrEqual(2);
    expect(m.positions.every(Number.isFinite)).toBe(true);
  });
});
