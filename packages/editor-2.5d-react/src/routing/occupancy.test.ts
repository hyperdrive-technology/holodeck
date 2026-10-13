import { describe, expect, it } from 'vitest';
import type { IsoPlacement } from '../iso/scene';
import { footprintCells } from './occupancy';
import { occOf, pipe, registry, tank } from './test-helpers';
import { buildOccupancy } from './occupancy';

describe('footprintCells (centre-anchored, closed box)', () => {
  it('a 2x2 part at (0,0) blocks the 3x3 nodes [-1,1]^2', () => {
    const cells = footprintCells(0, 0, 2, 2);
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual({ x: -1, y: -1 });
    expect(cells).toContainEqual({ x: 1, y: 1 });
  });
  it('a 1x1 part blocks only its own node', () => {
    expect(footprintCells(3, 4, 1, 1)).toEqual([{ x: 3, y: 4 }]);
  });
});

describe('buildOccupancy', () => {
  it('blocks tank edge nodes but not the node beyond', () => {
    const occ = occOf([tank('t', 5, 5)]);
    expect(occ.isBlocked(6, 5)).toBe(true);
    expect(occ.isBlocked(4, 4)).toBe(true);
    expect(occ.isBlocked(7, 5)).toBe(false);
  });

  it('sizes a part from its placement when the part declares footprintOf (resized vessel)', () => {
    const reg = registry;
    const def = {
      ...reg.get('holodeck.iso.part', 'tank')!,
      id: 'sized',
      footprintOf: (p: IsoPlacement) => {
        const r = Number(p.params?.radius ?? 1);
        return { w: 2 * r, h: 2 * r };
      },
    };
    const custom = { get: (_k: string, id: string) => (id === 'sized' ? def : reg.get('holodeck.iso.part', id)) } as typeof reg;
    const occ = buildOccupancy({ objects: [{ id: 's', object: 'sized', x: 0, y: 0, params: { radius: 2 } }] }, custom);
    expect(occ.isBlocked(2, 2)).toBe(true);
    expect(occ.isBlocked(3, 0)).toBe(false);
  });

  it('swaps w and h for 90 and 270 degree rotations', () => {
    const wide: IsoPlacement = { id: 'a', object: 'tank', x: 0, y: 0 };
    // Make a 4x2 part by registering nothing new: use the 8x6 area is a non-obstacle, so
    // exercise the swap through a custom definition instead.
    const reg = registry;
    const def = { ...reg.get('holodeck.iso.part', 'tank')!, id: 'slab', footprint: { w: 4, h: 2 } };
    const custom = { get: (_k: string, id: string) => (id === 'slab' ? def : reg.get('holodeck.iso.part', id)) } as typeof reg;
    const at = (rotation: number) =>
      buildOccupancy({ objects: [{ ...wide, object: 'slab', rotation }] }, custom);
    const flat = at(0);
    expect(flat.isBlocked(2, 0)).toBe(true);
    expect(flat.isBlocked(0, 2)).toBe(false);
    for (const r of [Math.PI / 2, (3 * Math.PI) / 2, -Math.PI / 2]) {
      const turned = at(r);
      expect(turned.isBlocked(0, 2)).toBe(true);
      expect(turned.isBlocked(2, 0)).toBe(false);
    }
    expect(at(Math.PI).isBlocked(2, 0)).toBe(true);
  });

  it('does not block area or label parts', () => {
    const occ = occOf([
      { id: 'a', object: 'area', x: 0, y: 0 },
      { id: 'l', object: 'label', x: 5, y: 5 },
    ]);
    expect(occ.blocked.size).toBe(0);
    expect(occ.bounds).toBeNull();
  });

  it('blocks every node of an existing pipe run, ends included', () => {
    const occ = occOf([pipe('p', 0, 0, 3, 0)]);
    for (const x of [0, 1, 2, 3]) expect(occ.isBlocked(x, 0)).toBe(true);
    expect(occ.isBlocked(4, 0)).toBe(false);
    expect(occ.isBlocked(1, 1)).toBe(false);
  });

  it('blocks elbows, valves and end caps', () => {
    const occ = occOf([
      { id: 'e', object: 'elbow', x: 0, y: 0 },
      { id: 'v', object: 'valve', x: 2, y: 0 },
      { id: 'c', object: 'end-cap', x: 4, y: 0 },
    ]);
    expect([0, 2, 4].every((x) => occ.isBlocked(x, 0))).toBe(true);
    expect(occ.blocked.size).toBe(3);
  });

  it('exclude leaves listed placements out', () => {
    const objs = [pipe('p', 0, 0, 3, 0), tank('t', 8, 8)];
    const occ = occOf(objs, { exclude: new Set(['p']) });
    expect(occ.isBlocked(1, 0)).toBe(false);
    expect(occ.isBlocked(8, 8)).toBe(true);
  });

  it('puts a clearance ring around vessels as cost, not block; 1x1 parts get none', () => {
    const occ = occOf([tank('t', 0, 0), { id: 'v', object: 'valve', x: 10, y: 0 }]);
    expect(occ.isNearVessel(2, 0)).toBe(true);
    expect(occ.isBlocked(2, 0)).toBe(false);
    expect(occ.isNearVessel(3, 0)).toBe(false);
    expect(occ.isNearVessel(11, 0)).toBe(false);
    expect(occOf([tank('t', 0, 0)], { margin: 2 }).isNearVessel(3, 0)).toBe(true);
    expect(occOf([tank('t', 0, 0)], { margin: 0 }).near.size).toBe(0);
  });

  it('reports bounds of blocked nodes', () => {
    expect(occOf([tank('t', 0, 0), pipe('p', 5, 5, 5, 9)]).bounds).toEqual({ minX: -1, minY: -1, maxX: 5, maxY: 9 });
  });

  it('treats an unknown part as 1x1', () => {
    expect(occOf([{ id: 'x', object: 'uninstalled', x: 1, y: 1 }]).blocked.size).toBe(1);
  });
});
