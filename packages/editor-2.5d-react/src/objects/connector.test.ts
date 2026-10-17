import { describe, expect, it } from 'vitest';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPlacement } from '../iso/scene';
import { buildOccupancy } from '../routing/occupancy';
import {
  connectorExtent,
  DEFAULT_CONNECTOR_LENGTH,
  exitFraction,
  freeConnectorPath,
  resolveConnectorPath,
  resolveConnectorPaths,
  resolveLinkEnd,
} from './connector';

const registry = createIsoRegistryWithBuiltins();
const tank = (id: string, x: number, y: number, rotation?: number): IsoPlacement => ({ id, object: 'tank', x, y, rotation });
const conn = (patch: Partial<IsoPlacement>): IsoPlacement => ({ id: 'c', object: 'connector', x: 0, y: 0, ...patch });

describe('resolveLinkEnd', () => {
  const byId = new Map([['t', tank('t', 4, 2)], ['r', tank('r', 0, 0, Math.PI / 2)]]);
  it('free ends: absent -> fallback, point -> that point', () => {
    expect(resolveLinkEnd(undefined, { x: 1, y: 2 }, byId, registry)).toEqual({ point: { x: 1, y: 2 } });
    expect(resolveLinkEnd({ x: 5, y: 6 }, { x: 1, y: 2 }, byId, registry)).toEqual({ point: { x: 5, y: 6 } });
  });
  it('object anchors: centre plus a clip box of the rotated footprint', () => {
    expect(resolveLinkEnd({ object: 't' }, { x: 0, y: 0 }, byId, registry)).toEqual({
      point: { x: 4, y: 2 },
      objectId: 't',
      clip: { cx: 4, cy: 2, w: 2, h: 2 },
    });
  });
  it('port anchors: the rotated port cell and outward heading', () => {
    expect(resolveLinkEnd({ object: 't', port: 'east' }, { x: 0, y: 0 }, byId, registry)).toEqual({
      point: { x: 5, y: 2 },
      heading: 'e',
      objectId: 't',
    });
    const rotated = resolveLinkEnd({ object: 'r', port: 'east' }, { x: 0, y: 0 }, byId, registry)!;
    expect(rotated.heading).not.toBe('e');
    expect(Math.abs(rotated.point.x) + Math.abs(rotated.point.y)).toBeCloseTo(1);
  });
  it('an unknown port falls back to the centre anchor; a missing object resolves to null', () => {
    expect(resolveLinkEnd({ object: 't', port: 'nope' }, { x: 0, y: 0 }, byId, registry)?.clip).toBeDefined();
    expect(resolveLinkEnd({ object: 'gone' }, { x: 0, y: 0 }, byId, registry)).toBeNull();
  });
});

describe('exitFraction', () => {
  const box = { cx: 0, cy: 0, w: 2, h: 2 };
  it('finds where a segment from the centre leaves the box', () => {
    expect(exitFraction([0, 0], [4, 0], box)).toBeCloseTo(0.25);
    expect(exitFraction([0, 0], [0, -2], box)).toBeCloseTo(0.5);
    expect(exitFraction([0, 0], [2, 2], box)).toBeCloseTo(0.5);
  });
  it('0 when the start is outside, 1 when the whole segment is inside', () => {
    expect(exitFraction([5, 5], [6, 6], box)).toBe(0);
    expect(exitFraction([0, 0], [0.5, 0], box)).toBe(1);
  });
});

describe('resolveConnectorPath', () => {
  it('a free connector defaults to 3 cells along +x', () => {
    const path = resolveConnectorPath(conn({ params: { route: 'straight' } }), [], registry)!;
    expect(path.points).toEqual([[0, 0], [DEFAULT_CONNECTOR_LENGTH, 0]]);
  });

  it('straight route draws one (diagonal) segment between free ends', () => {
    const c = conn({ x: 1, y: 1, toX: 5, toY: 4, params: { route: 'straight' } });
    expect(resolveConnectorPath(c, [c], registry)!.points).toEqual([[1, 1], [5, 4]]);
  });

  it('via waypoints make a fixed polyline, collinear points simplified', () => {
    const c = conn({ toX: 6, toY: 6, link: { via: [{ x: 3, y: 0 }, { x: 3, y: 3 }, { x: 3, y: 6 }] } });
    expect(resolveConnectorPath(c, [c], registry)!.points).toEqual([[0, 0], [3, 0], [3, 6], [6, 6]]);
  });

  it('centre anchors are clipped at both footprints', () => {
    const objects = [tank('a', 0, 0), tank('b', 8, 0)];
    const c = conn({ link: { from: { object: 'a' }, to: { object: 'b' } }, params: { route: 'straight' } });
    expect(resolveConnectorPath(c, [...objects, c], registry)!.points).toEqual([[1, 0], [7, 0]]);
  });

  it('auto routes around an obstacle with the pipe router and never enters it', () => {
    const blocker = tank('blk', 4, 0);
    const c = conn({ x: 0, y: 0, toX: 8, toY: 0 });
    const objects = [blocker, c];
    const path = resolveConnectorPath(c, objects, registry)!;
    expect(path.fallback).toBe(false);
    expect(path.points.length).toBeGreaterThan(2);
    expect(path.points[0]).toEqual([0, 0]);
    expect(path.points[path.points.length - 1]).toEqual([8, 0]);
    // Walk every cell of the polyline: none is blocked by the tank.
    const occ = buildOccupancy({ objects: [blocker] }, registry);
    for (let i = 1; i < path.points.length; i += 1) {
      const [ax, ay] = path.points[i - 1]!;
      const [bx, by] = path.points[i]!;
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      for (let s = 0; s <= steps; s += 1) {
        const x = ax + ((bx - ax) * s) / steps;
        const y = ay + ((by - ay) * s) / steps;
        expect(occ.isBlocked(x, y), `${x},${y}`).toBe(false);
      }
    }
  });

  it('auto ignores the anchored parts, floor annotations and other connectors', () => {
    const objects: IsoPlacement[] = [
      tank('a', 0, 0),
      tank('b', 8, 0),
      { id: 'lab', object: 'label', x: 4, y: 0 },
      { id: 'area', object: 'area', x: 4, y: 0, width: 4, height: 4 },
      conn({ id: 'other', x: 4, y: -2, toX: 4, toY: 2 }),
    ];
    const c = conn({ link: { from: { object: 'a', port: 'east' }, to: { object: 'b', port: 'west' } } });
    const path = resolveConnectorPath(c, [...objects, c], registry)!;
    expect(path.points).toEqual([[1, 0], [7, 0]]);
    expect(path.fallback).toBe(false);
  });

  it('falls back to the manhattan L when no clear route exists', () => {
    // Surround the far end with a ring of tanks.
    const ring = [tank('n', 10, -2), tank('s', 10, 2), tank('e', 12, 0), tank('w', 8, 0)];
    const c = conn({ toX: 10, toY: 0 });
    const path = resolveConnectorPath(c, [...ring, c], registry)!;
    expect(path.fallback).toBe(true);
    expect(path.points[path.points.length - 1]).toEqual([10, 0]);
  });

  it('draws nothing when an anchor names a missing placement', () => {
    const c = conn({ link: { to: { object: 'deleted' } } });
    expect(resolveConnectorPath(c, [c], registry)).toBeNull();
  });

  it('resolveConnectorPaths maps every resolvable connector by id', () => {
    const objects: IsoPlacement[] = [
      tank('a', 0, 0),
      conn({ id: 'c1', params: { route: 'straight' } }),
      conn({ id: 'c2', link: { from: { object: 'gone' } } }),
    ];
    const paths = resolveConnectorPaths(objects, registry);
    expect([...paths.keys()]).toEqual(['c1']);
  });
});

describe('freeConnectorPath / connectorExtent', () => {
  it('free path without the scene; object anchors draw nothing', () => {
    expect(freeConnectorPath(conn({ toX: 2, toY: 2 }))!.points).toEqual([[0, 0], [2, 2]]);
    expect(freeConnectorPath(conn({ link: { from: { object: 'x' } } }))).toBeNull();
    expect(freeConnectorPath(conn({ link: { from: { x: 1, y: 1 }, to: { x: 1, y: 1 } } }))).toBeNull();
  });
  it('extent covers ends, free anchors and waypoints', () => {
    expect(connectorExtent(conn({ toX: -2, toY: 5, link: { via: [{ x: 9, y: -1 }] } }))).toEqual({ minX: -2, minY: -1, maxX: 9, maxY: 5 });
    expect(connectorExtent(conn({}))).toEqual({ minX: 0, minY: 0, maxX: DEFAULT_CONNECTOR_LENGTH, maxY: 0 });
  });
});
