import { describe, expect, it } from 'vitest';
import { getDefaultIsoRegistry } from '../registry/default';
import { nextId } from './editor-state';
import { routePipe } from '../routing/astar';
import { buildOccupancy } from '../routing/occupancy';
import { MAX_GRID_COORD } from '../routing/grid';
import { parseSceneFile } from '../iso/scene';
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

  it.each([
    [16384, 0, 16384, -2, 16384, 2],
    [-16384, 0, -16384, -2, -16384, 2],
    [0, 16384, -2, 16384, 2, 16384],
    [0, -16384, -2, -16384, 2, -16384],
  ])('keeps routes around a boundary tank at (%s, %s) reopenable', (x, y, fromX, fromY, toX, toY) => {
    const scene = parseSceneFile({
      id: 'boundary', name: 'Boundary tank', gridCellSize: 1,
      objects: [{ id: 'tank-1', object: 'tank', x, y }],
    });
    const from = { cell: { x: fromX, y: fromY } };
    const to = { cell: { x: toX, y: toY } };
    const occ = buildOccupancy(scene, registry);
    expect(occ.skipped).toEqual([]);
    expect(occ.isBlocked(x + Math.sign(x), y + Math.sign(y))).toBe(true);
    const path = routePipe(from, to, occ)!;
    expect(path).not.toBeNull();
    expect(path.cells.every((c) => Math.abs(c.x) <= MAX_GRID_COORD && Math.abs(c.y) <= MAX_GRID_COORD)).toBe(true);
    expect(path.cells.some((c) => occ.isBlocked(c.x, c.y))).toBe(false);
    const out = routeToPlacements(scene, registry, from, to, nextId);
    expect(out).toMatchObject({ fallback: false, noRoute: false });
    expect(out.placements.some((p) => p.object === 'pipe')).toBe(true);
    expect(out.placements.some((p) => p.object === 'elbow')).toBe(true);
    const routed = { ...scene, objects: [...scene.objects, ...out.placements] };
    expect(parseSceneFile(JSON.parse(JSON.stringify(routed)))).toEqual(routed);
  });

  it('reports failure when the only escape around a boundary tank would leave the scene', () => {
    const scene = parseSceneFile({
      id: 'trapped', name: 'Trapped boundary route', gridCellSize: 1,
      objects: [
        { id: 'tank-1', object: 'tank', x: 16384, y: 0 },
        { id: 'valve-1', object: 'valve', x: 16383, y: -2 },
        { id: 'valve-2', object: 'valve', x: 16384, y: -3 },
      ],
    });
    const from = { cell: { x: 16384, y: -2 } };
    const to = { cell: { x: 16384, y: 2 } };
    expect(routePipe(from, to, buildOccupancy(scene, registry))).toBeNull();
    const out = routeToPlacements(scene, registry, from, to, nextId);
    expect(out).toMatchObject({ fallback: true, noRoute: true });
    const routed = { ...scene, objects: [...scene.objects, ...out.placements] };
    expect(parseSceneFile(JSON.parse(JSON.stringify(routed)))).toEqual(routed);
  });

  it.each([16385, -16385, 16384.5, Infinity, NaN])('emits no placements for an invalid endpoint x=%s', (x) => {
    const scene = { objects: [] };
    const valid = { cell: { x: 0, y: 0 } };
    const invalid = { cell: { x, y: 0 } };
    for (const [from, to] of [[valid, invalid], [invalid, valid], [invalid, invalid]] as const) {
      expect(routeToPlacements(scene, registry, from, to, nextId))
        .toEqual({ placements: [], fallback: true, noRoute: true });
    }
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

  it.each([0, 1.5, 4])('reports skipped obstacles as routing failure even when the destination x=%s', (x) => {
    const scene = { objects: [{ id: 'bad', object: 'tank', x: Infinity, y: 0 }] };
    const from = { cell: { x: 0, y: 0 } };
    const to = { cell: { x, y: 0 } };
    const occ = buildOccupancy(scene, registry);
    expect(occ.skipped).toEqual(['bad']);
    expect(routePipe(from, to, occ)).toBeNull();
    expect(routeToPlacements(scene, registry, from, to, nextId)).toMatchObject({ fallback: true, noRoute: true });
  });

  it('does not flag an explicitly excluded invalid placement as a skipped obstacle', () => {
    const scene = { objects: [{ id: 'bad', object: 'tank', x: Infinity, y: 0 }] };
    const out = routeToPlacements(scene, registry, { cell: { x: 0, y: 0 } }, { cell: { x: 4, y: 0 } }, nextId,
      { exclude: new Set(['bad']) });
    expect(out).toMatchObject({ fallback: false, noRoute: false });
  });

  it('cannot report success through a valid origin whose effective footprint was skipped', () => {
    // footprintOf: undefined -- the tank sizes itself from its radius; this fixture is about the static footprint.
    const def = { ...registry.get('holodeck.iso.part', 'tank')!, id: 'oversized', footprint: { w: 256, h: 256 }, footprintOf: undefined };
    const custom = { get: (_kind: string, id: string) => id === 'oversized' ? def : registry.get('holodeck.iso.part', id) } as typeof registry;
    const scene = { objects: [{ id: 'bad', object: 'oversized', x: 2, y: 0 }] };
    expect(buildOccupancy(scene, custom).skipped).toEqual(['bad']);
    expect(routeToPlacements(scene, custom, { cell: { x: 0, y: 0 } }, { cell: { x: 4, y: 0 } }, nextId))
      .toMatchObject({ fallback: true, noRoute: true });
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
