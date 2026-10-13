/** holodeck#8: parseSceneFile must reject non-finite / out-of-range geometry. */
import { describe, expect, it } from 'vitest';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { planRoute } from '../editor/routing';
import { MAX_CELL_COORD, MAX_GRID_COORD } from '../routing/grid';
import { buildOccupancy } from '../routing/occupancy';
import { createIsoRegistryWithBuiltins, getDefaultIsoRegistry } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { parseSceneFile, type IsoPlacement } from './scene';

const scene = (obj: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 's',
  name: 's',
  gridCellSize: 1,
  objects: [{ id: 'o', object: 'pipe', x: 0, y: 0, ...obj }],
  ...extra,
});

describe('parseSceneFile geometry bounds', () => {
  const sizedRegistry = createIsoRegistryWithBuiltins();
  const tankDef = sizedRegistry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, 'tank')!;
  const sizedDef: IsoPartDefinition = {
    ...tankDef, id: 'sized',
    footprintOf: (p: IsoPlacement) => ({
      w: Number(p.params?.w ?? 2), h: Number(p.params?.h ?? 2),
    }),
  };
  sizedRegistry.install({
    id: 'geometry-test', version: '1',
    contributions: { [HOLODECK_KINDS.isoPart]: [sizedDef] },
  });

  it.each([
    [MAX_GRID_COORD, 0], [-MAX_GRID_COORD, 0],
    [0, MAX_GRID_COORD], [0, -MAX_GRID_COORD],
  ])('a normal tank at (%s, %s) blocks its full footprint and routes around it', (x, y) => {
    const registry = getDefaultIsoRegistry();
    const parsed = parseSceneFile(scene({ object: 'tank', x, y }));
    const occ = buildOccupancy(parsed, registry);
    expect(occ.skipped).toEqual([]);
    expect(occ.blocked.size).toBe(9);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) expect(occ.isBlocked(x + dx, y + dy)).toBe(true);
    }
    const from = { cell: { x, y: y - 2 } };
    const to = { cell: { x, y: y + 2 } };
    const plan = planRoute(parsed, registry, from, to);
    expect(plan).toMatchObject({ fallback: false, noRoute: false });
    expect(plan.points[0]).toEqual(from.cell);
    expect(plan.points[plan.points.length - 1]).toEqual(to.cell);
    expect(plan.points.every((c) => !occ.isBlocked(c.x, c.y))).toBe(true);
  });

  it.each([Infinity, NaN, -1, 256])('rejects an effective footprint size of %s', (size) => {
    expect(() => parseSceneFile(scene({ object: 'sized', params: { w: size, h: size } }), sizedRegistry))
      .toThrow(/placement o: footprint/);
  });

  it('validates the rotated, param-sized footprint against the safe cell-key range', () => {
    const raw = scene({ object: 'sized', x: MAX_GRID_COORD, params: { w: 0, h: 32768 } });
    const parsed = parseSceneFile(raw, sizedRegistry);
    expect(buildOccupancy(parsed, sizedRegistry).skipped).toEqual([]);
    expect(() => parseSceneFile(scene({ ...raw.objects[0], rotation: Math.PI / 2 }), sizedRegistry))
      .toThrow(/footprint x .* outside \+-32767/);
  });

  it.each([
    [MAX_GRID_COORD, 0, 32766, 0], [-MAX_GRID_COORD, 0, 32766, 0],
    [0, MAX_GRID_COORD, 0, 32766], [0, -MAX_GRID_COORD, 0, 32766],
  ])('allows footprint nodes at the safe key boundary from (%s, %s), size %s x %s', (x, y, w, h) => {
    const parsed = parseSceneFile(scene({
      object: 'sized', x, y, params: { w, h },
    }), sizedRegistry);
    const occ = buildOccupancy(parsed, sizedRegistry);
    const edgeX = Math.sign(x) * MAX_CELL_COORD;
    const edgeY = Math.sign(y) * MAX_CELL_COORD;
    expect(occ.skipped).toEqual([]);
    expect(occ.isBlocked(edgeX, edgeY)).toBe(true);
    expect(occ.isNearVessel(edgeX + (x === 0 ? 1 : 0), edgeY + (y === 0 ? 1 : 0))).toBe(true);
    expect(occ.isNearVessel(edgeX + Math.sign(x), edgeY + Math.sign(y))).toBe(false);
  });

  it('the original repro: JSON 1e400 parses to Infinity and is rejected', () => {
    const raw = JSON.parse('{"id":"s","name":"s","gridCellSize":1,"objects":[{"id":"t","object":"tank","x":1e400,"y":0}]}');
    expect(raw.objects[0].x).toBe(Infinity);
    expect(() => parseSceneFile(raw)).toThrow(/placement t: x must be a finite number within \+-16384, got Infinity/);
  });

  const BAD = [Infinity, -Infinity, MAX_GRID_COORD + 1, -(MAX_GRID_COORD + 0.5), 1e300];
  for (const field of ['x', 'y', 'toX', 'toY', 'width', 'height', 'size']) {
    it.each(BAD)(`rejects ${field} = %s`, (v) => {
      expect(() => parseSceneFile(scene({ toX: 3, toY: 0, [field]: v }))).toThrow(new RegExp(`placement o: ${field} must be`));
    });
  }
  for (const field of ['toX', 'toY', 'width', 'height', 'size']) {
    it.each([NaN, '3', null, true])(`rejects non-number ${field} = %s`, (v) => {
      expect(() => parseSceneFile(scene({ [field]: v }))).toThrow(new RegExp(`placement o: ${field} must be`));
    });
  }
  for (const field of ['rotation', 'nudgeX', 'nudgeY', 'screenX', 'screenY']) {
    it.each([Infinity, NaN, '1'])(`rejects ${field} = %s`, (v) => {
      expect(() => parseSceneFile(scene({ [field]: v }))).toThrow(new RegExp(`placement o: ${field} must be a finite number`));
    });
  }
  it('NaN x keeps the original message', () => {
    expect(() => parseSceneFile(scene({ x: NaN }))).toThrow(/missing numeric x,y/);
  });

  it('accepts the bounds themselves, negative and fractional values, and omitted optionals', () => {
    const ok = parseSceneFile(scene({ x: MAX_GRID_COORD, y: -MAX_GRID_COORD, toX: MAX_GRID_COORD, toY: 2.5, rotation: -Math.PI }));
    expect(ok.objects[0]).toMatchObject({ x: MAX_GRID_COORD, toY: 2.5 });
    expect(() => parseSceneFile(scene({}))).not.toThrow();
  });

  it.each([0, -1, Infinity, NaN, '1'])('rejects gridCellSize %s', (g) => {
    expect(() => parseSceneFile(scene({}, { gridCellSize: g }))).toThrow(/scene.gridCellSize must be a finite number > 0/);
  });

  it('every accepted scene builds occupancy without skipping (parse bounds imply routable runs)', () => {
    const parsed = parseSceneFile(scene({ x: -MAX_GRID_COORD, toX: MAX_GRID_COORD, toY: 0 }));
    const occ = buildOccupancy(parsed, getDefaultIsoRegistry());
    expect(occ.skipped).toEqual([]);
    expect(occ.blocked.size).toBe(2 * MAX_GRID_COORD + 1);
  });
});
