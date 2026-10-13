import { describe, expect, it } from 'vitest';
import { defaultMinBendSpacing, routePipe, type RoutePath } from './astar';
import { HEADING_VECTOR, type GridPoint } from './grid';
import { last, occOf, pipe, tank } from './test-helpers';
import { ELBOW_RADIUS } from '../../assets/process/pipe-math';

const at = (x: number, y: number) => ({ cell: { x, y } });

/** Indices (into cells) of the cells where the path turns. */
function bendIndices(cells: GridPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < cells.length - 1; i += 1) {
    const a = cells[i - 1]!;
    const b = cells[i]!;
    const c = cells[i + 1]!;
    if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) out.push(i);
  }
  return out;
}

function expectUnitSteps(path: RoutePath) {
  for (let i = 1; i < path.cells.length; i += 1) {
    const d = Math.abs(path.cells[i]!.x - path.cells[i - 1]!.x) + Math.abs(path.cells[i]!.y - path.cells[i - 1]!.y);
    expect(d).toBe(1);
  }
}

describe('routePipe', () => {
  it('derives minBendSpacing from ELBOW_RADIUS (two bends need 2R of straight run)', () => {
    expect(2 * ELBOW_RADIUS).toBeGreaterThan(1);
    expect(defaultMinBendSpacing()).toBe(2);
    expect(defaultMinBendSpacing(0.25)).toBe(5);
  });

  it('goes straight with no bends when aligned', () => {
    const r = routePipe(at(0, 0), at(5, 0), occOf([]))!;
    expect(r.bends).toBe(0);
    expect(r.cells).toHaveLength(6);
    expect(r.cost).toBe(5);
    expectUnitSteps(r);
  });

  it('is a single-bend L when unobstructed', () => {
    const r = routePipe(at(0, 0), at(4, 3), occOf([]))!;
    expect(r.bends).toBe(1);
    expect(r.cost).toBe(7 + 4);
    expect(r.cells[0]).toEqual({ x: 0, y: 0 });
    expect(last(r.cells)).toEqual({ x: 4, y: 3 });
  });

  it('handles start === end', () => {
    expect(routePipe(at(2, 2), at(2, 2), occOf([]))).toMatchObject({ cells: [{ x: 2, y: 2 }], bends: 0, cost: 0 });
  });

  it('detours around a 2x2 tank in the way', () => {
    const occ = occOf([tank('t', 5, 0)]);
    const r = routePipe(at(0, 0), at(10, 0), occ)!;
    expect(r).not.toBeNull();
    expectUnitSteps(r);
    expect(r.bends).toBeGreaterThanOrEqual(2);
    expect(r.cells.some((c) => occ.isBlocked(c.x, c.y))).toBe(false);
  });

  it('prefers cells away from the vessel (clearance is a cost)', () => {
    const occ = occOf([tank('t', 5, 0)]);
    const r = routePipe(at(0, 0), at(10, 0), occ)!;
    // Cheapest detour: row y=+-2 would sit in the clearance ring; row y=+-3 costs two extra bends-free steps.
    const nearCount = r.cells.filter((c) => occ.isNearVessel(c.x, c.y)).length;
    const hugging = routePipe(at(0, 0), at(10, 0), occ, { clearancePenalty: 0 })!;
    expect(hugging.cells.filter((c) => occ.isNearVessel(c.x, c.y)).length).toBeGreaterThanOrEqual(nearCount);
    expect(r.cost).toBeGreaterThanOrEqual(hugging.cost);
  });

  it('honours a required start heading', () => {
    // Target is to the east, but the port faces north: first step must go north.
    const r = routePipe({ cell: { x: 0, y: 0 }, heading: 'n' }, at(6, 0), occOf([]))!;
    expect(r.cells[1]).toEqual({ x: 0, y: -1 });
    const w = routePipe({ cell: { x: 0, y: 0 }, heading: 'w' }, at(6, 0), occOf([]))!;
    expect(w.cells[1]).toEqual({ x: -1, y: 0 });
  });

  it('honours a required end heading (arrive moving opposite to the outward direction)', () => {
    // End port faces east (outward +x): the pipe must arrive moving west.
    const r = routePipe(at(0, 0), { cell: { x: 6, y: 3 }, heading: 'e' }, occOf([]))!;
    const prev = last(r.cells, 2);
    expect(prev).toEqual({ x: 7, y: 3 });
    for (const h of ['n', 'e', 's', 'w'] as const) {
      const rr = routePipe(at(0, 0), { cell: { x: 6, y: 3 }, heading: h }, occOf([]))!;
      const end = last(rr.cells);
      const before = last(rr.cells, 2);
      expect({ x: before.x - end.x, y: before.y - end.y }).toEqual(HEADING_VECTOR[h]);
    }
  });

  it('refuses to overlap or cross an existing pipe, going around its end instead', () => {
    const occ = occOf([pipe('p', 3, -3, 3, 3)]);
    const r = routePipe(at(0, 0), at(6, 0), occ)!;
    expect(r).not.toBeNull();
    expect(r.cells.some((c) => occ.isBlocked(c.x, c.y))).toBe(false);
    expect(r.cells.some((c) => c.y < -3 || c.y > 3)).toBe(true);
  });

  it('may end on the end of an existing pipe (join), but not on its interior', () => {
    const occ = occOf([pipe('p', 5, 0, 5, 4)]);
    const join = routePipe(at(0, 0), at(5, 0), occ)!;
    expect(join).not.toBeNull();
    expect(last(join.cells)).toEqual({ x: 5, y: 0 });
    // Interior node (5,2) is only reachable from side cells, never by sliding along the pipe.
    const tee = routePipe(at(0, 2), at(5, 2), occ)!;
    expect(last(tee.cells)).toEqual({ x: 5, y: 2 });
    expect(tee.cells.slice(0, -1).some((c) => occ.isBlocked(c.x, c.y))).toBe(false);
  });

  it('may start on a pipe end', () => {
    const occ = occOf([pipe('p', 0, 0, 0, 4)]);
    const r = routePipe(at(0, 4), at(6, 4), occ)!;
    expect(r.cells[0]).toEqual({ x: 0, y: 4 });
    expect(r.cells[1]).toEqual({ x: 1, y: 4 });
  });

  it('keeps at least minBendSpacing cells between consecutive bends', () => {
    // A staircase target tempts zig-zags; the spacing rule must stop 1-cell stairs.
    for (const spacing of [2, 3]) {
      const r = routePipe(at(0, 0), at(7, 5), occOf([tank('t', 3, 2)]), { minBendSpacing: spacing })!;
      expect(r).not.toBeNull();
      const b = bendIndices(r.cells);
      for (let i = 1; i < b.length; i += 1) expect(b[i]! - b[i - 1]!).toBeGreaterThanOrEqual(spacing);
    }
    // And with spacing 1 a stair is allowed when it is cheaper (bendPenalty 0).
    const stair = routePipe(at(0, 0), at(3, 3), occOf([]), { minBendSpacing: 1, bendPenalty: 0, clearancePenalty: 0 })!;
    expect(stair.cost).toBe(6);
  });

  it('returns null when walled in', () => {
    const ring = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => ({ id: `v${dx}${dy}`, object: 'valve', x: dx, y: dy })))
      .filter((o) => !(o.x === 0 && o.y === 0));
    expect(routePipe(at(0, 0), at(8, 0), occOf(ring))).toBeNull();
  });

  it('gives up (null) once maxExpansions is exceeded', () => {
    expect(routePipe(at(0, 0), at(50, 50), occOf([]), { maxExpansions: 10 })).toBeNull();
  });

  it('is deterministic', () => {
    const occ = occOf([tank('a', 4, 0), tank('b', 4, 5), pipe('p', 8, -4, 8, 6)]);
    const run = () => routePipe(at(0, 2), at(12, 3), occ);
    const first = run();
    expect(first).not.toBeNull();
    for (let i = 0; i < 5; i += 1) expect(run()).toEqual(first);
  });

  it('bounds the search on a 200x200 empty grid (expanded-node cap) and is fast', () => {
    // Documented cap: an unobstructed far target needs ~one straight leg plus one
    // cheap turn, so a few hundred expansions. 5_000 leaves 10x headroom for
    // tie-break drift while still failing if the search ever floods the grid
    // (which would be 40_000+ cells x 4 headings).
    const EXPANSION_CAP = 5_000;
    const t0 = performance.now();
    const r = routePipe(at(0, 0), at(199, 199), occOf([]))!;
    const ms = performance.now() - t0;
    expect(r).not.toBeNull();
    expect(r.bends).toBe(1);
    expect(r.expanded).toBeLessThan(EXPANSION_CAP);
    expect(ms).toBeLessThan(50);
  });

  it('stays inside bbox(from, to, obstacles) + margin', () => {
    // The only way around a long wall is farther out than margin allows.
    const wall = Array.from({ length: 31 }, (_, i) => ({ id: `w${i}`, object: 'valve', x: 5, y: i - 15 }));
    expect(routePipe(at(0, 0), at(10, 0), occOf(wall), { margin: 1 })).not.toBeNull(); // bbox includes the wall ends
    const tall = occOf([pipe('p', 5, -2, 5, 2)]);
    expect(routePipe(at(0, 0), at(10, 0), tall, { margin: 0 })).toBeNull(); // no room beyond the pipe's ends
    expect(routePipe(at(0, 0), at(10, 0), tall, { margin: 1 })).not.toBeNull();
  });
});
