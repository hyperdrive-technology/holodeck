import { describe, expect, it } from 'vitest';
import { getDefaultIsoRegistry } from '../registry/default';
import { footprint, manhattanRoute, routeToPlacements } from './routing';

describe('manhattanRoute', () => {
  it('returns nothing for a zero-length click', () => {
    expect(manhattanRoute({ x: 1, y: 1 }, { x: 1, y: 1 })).toEqual({ pipes: [], elbow: null });
  });

  it('keeps an axis-aligned run as one pipe', () => {
    expect(manhattanRoute({ x: 0, y: 0 }, { x: 4, y: 0 })).toEqual({
      pipes: [{ x: 0, y: 0, toX: 4, toY: 0 }],
      elbow: null,
    });
    expect(manhattanRoute({ x: 2, y: 1 }, { x: 2, y: -3 })).toEqual({
      pipes: [{ x: 2, y: 1, toX: 2, toY: -3 }],
      elbow: null,
    });
  });

  it('inserts an elbow on a diagonal (horizontal first)', () => {
    const route = manhattanRoute({ x: 0, y: 0 }, { x: 3, y: -2 });
    expect(route.elbow).toEqual({ x: 3, y: 0 });
    expect(route.pipes).toEqual([
      { x: 0, y: 0, toX: 3, toY: 0 },
      { x: 3, y: 0, toX: 3, toY: -2 },
    ]);
  });

  it('emits pipe + elbow placements with ids', () => {
    const placed = routeToPlacements({ x: 0, y: 0 }, { x: 1, y: 1 }, {
      pipeA: 'pipe-1',
      pipeB: 'pipe-2',
      elbow: 'elbow-1',
    });
    expect(placed.map((p) => p.object)).toEqual(['pipe', 'pipe', 'elbow']);
    expect(placed[2]).toMatchObject({ id: 'elbow-1', x: 1, y: 0 });
    expect(placed[2]?.rotation).toBeCloseTo(Math.PI / 2);
  });
});

describe('footprint', () => {
  const registry = getDefaultIsoRegistry();

  it('reads the footprint from the part definition', () => {
    expect(footprint(registry, 'tank')).toEqual({ w: 2, h: 2 });
    expect(footprint(registry, 'mixer')).toEqual({ w: 2, h: 2 });
    expect(footprint(registry, 'area')).toEqual({ w: 8, h: 6 });
    expect(footprint(registry, 'valve')).toEqual({ w: 1, h: 1 });
  });

  it('falls back to 1x1 for a part that is not installed', () => {
    expect(footprint(registry, 'uninstalled')).toEqual({ w: 1, h: 1 });
  });
});
