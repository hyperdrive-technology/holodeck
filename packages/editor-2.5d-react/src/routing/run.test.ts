import { describe, expect, it } from 'vitest';
import type { IsoPlacement } from '../iso/scene';
import { findRun } from './run';
import { pipe } from './test-helpers';

const elbow = (id: string, x: number, y: number): IsoPlacement => ({ id, object: 'elbow', x, y });

describe('findRun', () => {
  const objs = [pipe('a', 0, 0, 3, 0), elbow('e1', 3, 0), pipe('b', 3, 0, 3, 4), pipe('far', 20, 20, 25, 20)];

  it('walks pipes and elbows from a pipe or an elbow', () => {
    for (const id of ['a', 'b', 'e1']) {
      const run = findRun(objs, id)!;
      expect(new Set(run.ids)).toEqual(new Set(['a', 'e1', 'b']));
      const ends = [run.start, run.end].map((c) => `${c.x},${c.y}`).sort();
      expect(ends).toEqual(['0,0', '3,4']);
    }
  });

  it('stops at a junction (tee) and at non-pipe parts', () => {
    const tee = [...objs, pipe('branch', 3, 0, 6, 0)];
    const run = findRun(tee, 'a')!;
    expect(new Set(run.ids)).toEqual(new Set(['a']));
    expect(run.end).toEqual({ x: 3, y: 0 });
  });

  it('returns null for non-pipe selections and survives closed loops', () => {
    expect(findRun([{ id: 't', object: 'tank', x: 0, y: 0 }], 't')).toBeNull();
    expect(findRun(objs, 'missing')).toBeNull();
    const loop = [pipe('l1', 0, 0, 2, 0), pipe('l2', 2, 0, 2, 2), pipe('l3', 2, 2, 0, 2), pipe('l4', 0, 2, 0, 0)];
    expect(findRun(loop, 'l1')).not.toBeNull();
  });
});
