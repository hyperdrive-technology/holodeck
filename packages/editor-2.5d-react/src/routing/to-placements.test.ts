import { describe, expect, it } from 'vitest';
import { trimRun } from '../../assets/process/pipe-math';
import { elbowRotationForArms, headingOf } from './elbows';
import { nextId } from '../editor/editor-state';
import type { IsoPlacement } from '../iso/scene';
import { routePipe } from './astar';
import { collapsePath, pathToPlacements } from './to-placements';
import { last, occOf, tank } from './test-helpers';

const p = (x: number, y: number) => ({ x, y });

describe('collapsePath', () => {
  it('merges collinear cells into one run', () => {
    expect(collapsePath([p(0, 0), p(1, 0), p(2, 0), p(3, 0)])).toEqual({
      pipes: [{ x: 0, y: 0, toX: 3, toY: 0 }],
      bends: [],
    });
  });
  it('splits at bends and yaws the elbow from its two arms', () => {
    const c = collapsePath([p(0, 0), p(1, 0), p(2, 0), p(2, 1), p(2, 2)]);
    expect(c.pipes).toEqual([
      { x: 0, y: 0, toX: 2, toY: 0 },
      { x: 2, y: 0, toX: 2, toY: 2 },
    ]);
    // Arms: back toward (0,0) is w, ahead toward (2,2) is s => s+w = +pi/2.
    expect(c.bends).toEqual([{ x: 2, y: 0, rotation: Math.PI / 2 }]);
  });
  it('yaws every corner of a zig-zag by the arms table (elbows.ts)', () => {
    const c = collapsePath([p(0, 0), p(2, 0), p(2, 2), p(0, 2), p(0, 4)]);
    expect(c.bends).toEqual([
      { x: 2, y: 0, rotation: Math.PI / 2 }, // back w, ahead s
      { x: 2, y: 2, rotation: 0 }, // back n, ahead w
      { x: 0, y: 2, rotation: Math.PI }, // back e, ahead s
    ]);
  });
  it('emits no elbow for a U-turn (no 90 degree fitting joins it)', () => {
    const c = collapsePath([p(0, 0), p(2, 0), p(1, 0)]);
    expect(c.pipes).toHaveLength(2);
    expect(c.bends).toEqual([]);
  });
  it('returns nothing for fewer than two distinct points', () => {
    expect(collapsePath([p(1, 1)])).toEqual({ pipes: [], bends: [] });
    expect(collapsePath([p(1, 1), p(1, 1)])).toEqual({ pipes: [], bends: [] });
  });
});

describe('pathToPlacements on a routed detour', () => {
  const occ = occOf([tank('t', 5, 0)]);
  const path = routePipe({ cell: p(0, 0) }, { cell: p(10, 0) }, occ)!;
  const existing: IsoPlacement[] = [tank('t', 5, 0)];
  const out = pathToPlacements(path.cells, existing, nextId);
  const pipes = out.filter((o) => o.object === 'pipe');
  const elbows = out.filter((o) => o.object === 'elbow');

  it('emits pipes then elbows with unique ids', () => {
    expect(new Set(out.map((o) => o.id)).size).toBe(out.length);
    expect(out.map((o) => o.object)).toEqual([...pipes.map(() => 'pipe'), ...elbows.map(() => 'elbow')]);
    expect(pipes.every((o) => o.band === '#e74c3c')).toBe(true);
    expect(elbows).toHaveLength(path.bends);
    expect(pipes).toHaveLength(path.bends + 1);
  });

  it('puts every elbow where two pipe ends meet, yawed to those two directions', () => {
    for (const e of elbows) {
      const ends = pipes.filter((q) => (q.x === e.x && q.y === e.y) || (q.toX === e.x && q.toY === e.y));
      expect(ends).toHaveLength(2);
      const dir = (q: IsoPlacement) =>
        q.x === e.x && q.y === e.y
          ? [Math.sign(q.toX! - q.x), Math.sign(q.toY! - q.y)]
          : [Math.sign(q.x - q.toX!), Math.sign(q.y - q.toY!)];
      const [a, b] = ends.map(dir) as [number[], number[]];
      expect(e.rotation).toBe(elbowRotationForArms(headingOf(a[0]!, a[1]!)!, headingOf(b[0]!, b[1]!)!));
    }
  });

  it('chains pipes end to end from start to goal', () => {
    expect(pipes[0]).toMatchObject({ x: 0, y: 0 });
    expect(last(pipes)).toMatchObject({ toX: 10, toY: 0 });
    for (let i = 1; i < pipes.length; i += 1) {
      expect(pipes[i]).toMatchObject({ x: pipes[i - 1]!.toX, y: pipes[i - 1]!.toY });
    }
  });

  it('never leaves a run untrimmed: every bent end really trims (bends far enough apart for trimRun)', () => {
    const bendKeys = new Set(elbows.map((e) => `${e.x},${e.y}`));
    for (const q of pipes) {
      const from: [number, number] = [q.x, q.y];
      const to: [number, number] = [q.toX!, q.toY!];
      const t = trimRun(from, to, bendKeys.has(`${q.x},${q.y}`), bendKeys.has(`${q.toX},${q.toY}`));
      const trimmed = t.from[0] !== from[0] || t.from[1] !== from[1] || t.to[0] !== to[0] || t.to[1] !== to[1];
      expect(trimmed).toBe(bendKeys.has(`${q.x},${q.y}`) || bendKeys.has(`${q.toX},${q.toY}`));
    }
  });

  it('allocates ids after existing ones', () => {
    const withPipe: IsoPlacement[] = [{ id: 'pipe-1', object: 'pipe', x: 0, y: 0, toX: 1, toY: 0 }];
    const ids = pathToPlacements([p(5, 5), p(7, 5), p(7, 8)], withPipe, nextId).map((o) => o.id);
    expect(ids).toEqual(['pipe-2', 'pipe-3', 'elbow-1']);
  });
});
