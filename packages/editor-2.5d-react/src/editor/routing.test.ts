import { describe, expect, it } from 'vitest';
import { getDefaultIsoRegistry } from '../registry/default';
import { nextId } from './editor-state';
import { footprint, manhattanRoute, routeToPlacements } from './routing';

const registry = getDefaultIsoRegistry();

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

  it('emits pipe + elbow placements with ids (routed on an empty scene)', () => {
    const { placements: placed, fallback } = routeToPlacements(
      { objects: [] },
      registry,
      { cell: { x: 0, y: 0 } },
      { cell: { x: 1, y: 1 } },
      nextId,
    );
    expect(fallback).toBe(false);
    expect(placed.map((p) => p.object)).toEqual(['pipe', 'pipe', 'elbow']);
    expect(placed.map((p) => p.id)).toEqual(['pipe-1', 'pipe-2', 'elbow-1']);
  });

  it('falls back to the manhattan L (flagged) when walled in', () => {
    const wall = [-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].map((dy) => ({ id: `v${dx}${dy}`, object: 'valve', x: 10 + dx, y: dy })),
    ).filter((o) => !(o.x === 10 && o.y === 0));
    const out = routeToPlacements({ objects: wall }, registry, { cell: { x: 10, y: 0 } }, { cell: { x: 14, y: 3 } }, nextId);
    expect(out.fallback).toBe(true);
    expect(out.noRoute).toBe(true);
    expect(out.placements.map((p) => p.object)).toEqual(['pipe', 'pipe', 'elbow']);
    expect(out.placements[2]).toMatchObject({ x: 14, y: 0 });
  });

  it('skips the router for half-cell clicks (not noRoute)', () => {
    const out = routeToPlacements({ objects: [] }, registry, { cell: { x: 0, y: 0 } }, { cell: { x: 1.5, y: 1 } }, nextId);
    expect(out).toMatchObject({ fallback: true, noRoute: false });
  });
});

describe('footprint', () => {

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
