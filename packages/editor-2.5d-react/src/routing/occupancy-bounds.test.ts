/**
 * holodeck#8: `{"x": 1e400}` parses to Infinity; `footprintCells` then looped
 * forever (`Infinity + 1 === Infinity`). These tests must finish instantly:
 * a regression shows up as a test timeout, not a wrong answer.
 */
import { describe, expect, it } from 'vitest';
import type { IsoPlacement } from '../iso/scene';
import { MAX_GRID_COORD } from './grid';
import {
  buildOccupancy,
  footprintCells,
  footprintContains,
  GeometryRangeError,
  MAX_FOOTPRINT_CELLS,
  runCells,
} from './occupancy';
import { resolveRouteEnd } from './ports';
import { occOf, pipe, registry, tank } from './test-helpers';

const BAD = [Infinity, -Infinity, NaN, MAX_GRID_COORD + 1, -(MAX_GRID_COORD + 1), 1e300];

describe('footprintCells / runCells refuse unbounded geometry', () => {
  it.each(BAD)('footprintCells centre x=%s throws GeometryRangeError', (v) => {
    expect(() => footprintCells(v, 0, 2, 2)).toThrow(GeometryRangeError);
    expect(() => footprintCells(0, v, 2, 2)).toThrow(GeometryRangeError);
  });
  it.each([Infinity, NaN])('footprintCells size %s throws', (v) => {
    expect(() => footprintCells(0, 0, v, 2)).toThrow(GeometryRangeError);
    expect(() => footprintCells(0, 0, 2, v)).toThrow(GeometryRangeError);
  });
  it('caps the footprint area', () => {
    expect(footprintCells(0.5, 0.5, 255, 255)).toHaveLength(256 * 256); // exactly at the cap
    expect(256 * 256).toBe(MAX_FOOTPRINT_CELLS);
    expect(() => footprintCells(0, 0, 256, 256)).toThrow(/66049 nodes \(max 65536\)/);
  });
  it('still accepts the largest legal coordinate', () => {
    expect(footprintCells(MAX_GRID_COORD, -MAX_GRID_COORD, 0, 0)).toEqual([{ x: MAX_GRID_COORD, y: -MAX_GRID_COORD }]);
  });
  it.each(BAD)('runCells with an endpoint of %s throws (axis-aligned and diagonal)', (v) => {
    expect(() => runCells({ x: 0, y: 0, toX: v, toY: 0 })).toThrow(GeometryRangeError);
    expect(() => runCells({ x: 0, y: 0, toX: 0, toY: v })).toThrow(GeometryRangeError);
    expect(() => runCells({ x: v, y: 0, toX: 0, toY: 0 })).toThrow(GeometryRangeError);
    expect(() => runCells({ x: 0, y: 0, toX: v, toY: 3 })).toThrow(GeometryRangeError);
  });
  it('a full-width legal run is enumerated, not refused', () => {
    expect(runCells({ x: -MAX_GRID_COORD, y: 0, toX: MAX_GRID_COORD, toY: 0 })).toHaveLength(2 * MAX_GRID_COORD + 1);
  });
});

describe('footprintContains', () => {
  it('agrees with footprintCells on a normal box', () => {
    const cells = footprintCells(5, 5, 2, 2);
    for (let x = 2; x <= 8; x += 1) {
      for (let y = 2; y <= 8; y += 1) {
        expect(footprintContains(5, 5, 2, 2, { x, y }), `${x},${y}`).toBe(cells.some((c) => c.x === x && c.y === y));
      }
    }
  });
  it('is O(1) and false for NaN geometry, true inside an infinite box', () => {
    expect(footprintContains(NaN, 0, 2, 2, { x: 0, y: 0 })).toBe(false);
    expect(footprintContains(0, 0, Infinity, Infinity, { x: 5, y: 5 })).toBe(true);
  });
});

describe('buildOccupancy skips bad placements instead of hanging', () => {
  it.each(BAD)('tank at x=%s is skipped and reported; the rest still blocks', (v) => {
    const occ = occOf([tank('bad', v, 0), tank('good', 5, 5)]);
    expect(occ.skipped).toEqual(['bad']);
    expect(occ.isBlocked(5, 5)).toBe(true);
    expect(occ.bounds).toEqual({ minX: 4, minY: 4, maxX: 6, maxY: 6 });
  });
  it.each(BAD)('pipe ending at toX=%s is skipped', (v) => {
    const occ = occOf([pipe('p', 0, 0, v, 0), pipe('q', 0, 2, 3, 2)]);
    expect(occ.skipped).toEqual(['p']);
    expect(occ.isBlocked(3, 2)).toBe(true);
  });
  it('a param-sized vessel (footprintOf) with an Infinity radius is skipped', () => {
    const tankDef = registry.get('holodeck.iso.part', 'tank')!;
    const def = { ...tankDef, id: 'sized', footprintOf: (p: IsoPlacement) => ({ w: 2 * Number(p.params?.radius), h: 2 * Number(p.params?.radius) }) };
    const custom = { get: (_k: string, id: string) => (id === 'sized' ? def : registry.get('holodeck.iso.part', id)) } as typeof registry;
    const occ = buildOccupancy({ objects: [{ id: 's', object: 'sized', x: 0, y: 0, params: { radius: Infinity } }] }, custom);
    expect(occ.skipped).toEqual(['s']);
    expect(occ.blocked.size).toBe(0);
    expect(occ.bounds).toBeNull();
  });
  it('a clean scene skips nothing', () => {
    expect(occOf([tank('t', 0, 0), pipe('p', 2, 0, 6, 0)]).skipped).toEqual([]);
  });
  it.each([Infinity, -1, 1.5, NaN])('rejects margin %s', (margin) => {
    expect(() => occOf([tank('t', 0, 0)], { margin })).toThrow(RangeError);
  });
});

describe('resolveRouteEnd with bad geometry', () => {
  it('does not enumerate an Infinity-sized footprint (no hang) and ignores a NaN-placed part', () => {
    const objects = [tank('nan', NaN, 0), tank('t', 0, 0)];
    const end = resolveRouteEnd({ objects }, registry, { x: 1, y: 0 });
    expect(end.partId).toBe('t');
  });
});

// holodeck#56: nodeRange checked the ROUNDED integer bounds, so an endpoint a
// fraction past the scene limit (rounds back inside) was accepted although
// scene validation rejects it. The original coordinates must be validated.
describe('runCells validates the original (unrounded) endpoints', () => {
  const over = MAX_GRID_COORD + 0.5;
  it.each([
    ['axis-aligned toX', { x: 0, y: 0, toX: over, toY: 0 }],
    ['axis-aligned toY', { x: 0, y: 0, toX: 0, toY: -over }],
    ['axis-aligned origin', { x: -over, y: 1, toX: 0, toY: 1 }],
    ['diagonal toX', { x: 0, y: 0, toX: over, toY: 1 }],
    ['diagonal origin y', { x: 0, y: over, toX: 3, toY: 1 }],
    ['just past the limit', { x: 0, y: 0, toX: MAX_GRID_COORD + 1e-4, toY: 0 }],
  ])('%s just past the limit throws GeometryRangeError', (_name, run) => {
    expect(() => runCells(run)).toThrow(GeometryRangeError);
  });
  it('accepts fractional endpoints inside the limit, axis-aligned and diagonal', () => {
    expect(runCells({ x: MAX_GRID_COORD - 0.5, y: 0, toX: MAX_GRID_COORD, toY: 0 })).toEqual([{ x: MAX_GRID_COORD, y: 0 }]);
    expect(runCells({ x: 0, y: 0, toX: -(MAX_GRID_COORD - 0.5), toY: 1 })).toHaveLength(2);
  });
  it('buildOccupancy reports the out-of-range run as skipped (the GPT repro)', () => {
    expect(occOf([pipe('p', 0, 0, 16384.5, 1)]).skipped).toEqual(['p']);
    expect(occOf([pipe('p', 0, 0, 16384.5, 0)]).skipped).toEqual(['p']);
  });
});
