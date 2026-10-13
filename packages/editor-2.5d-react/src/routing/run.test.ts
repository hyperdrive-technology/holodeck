import { describe, expect, it } from 'vitest';
import type { IsoPlacement } from '../iso/scene';
import { findRun } from './run';
import { pipe, registry } from './test-helpers';

const elbow = (id: string, x: number, y: number): IsoPlacement => ({ id, object: 'elbow', x, y });

describe('findRun', () => {
  const objs = [pipe('a', 0, 0, 3, 0), elbow('e1', 3, 0), pipe('b', 3, 0, 3, 4), pipe('far', 20, 20, 25, 20)];

  it('walks pipes and elbows from a pipe or an elbow', () => {
    for (const id of ['a', 'b', 'e1']) {
      const run = findRun(objs, id, registry)!;
      expect(new Set(run.ids)).toEqual(new Set(['a', 'e1', 'b']));
      const ends = [run.start, run.end].map((c) => `${c.x},${c.y}`).sort();
      expect(ends).toEqual(['0,0', '3,4']);
    }
  });

  it('stops at a junction (tee) and at non-pipe parts', () => {
    const tee = [...objs, pipe('branch', 3, 0, 6, 0)];
    const run = findRun(tee, 'a', registry)!;
    expect(new Set(run.ids)).toEqual(new Set(['a']));
    expect(run.end).toEqual({ x: 3, y: 0 });
  });

  // holodeck#10: the tee case above never exercised a part on the joint.
  describe('stops at a non-pipe part on a joint (inline valve)', () => {
    const valve = (id: string, x: number, y: number): IsoPlacement => ({ id, object: 'valve', x, y });
    const line = [pipe('a', 0, 0, 3, 0), valve('v', 3, 0), pipe('b', 3, 0, 6, 0)];

    it.each(['a', 'b'])('selecting %s yields only that pipe, ending at the valve', (id) => {
      const run = findRun(line, id, registry)!;
      expect(run.ids).toEqual([id]);
      const ends = [run.start, run.end].map((c) => `${c.x},${c.y}`).sort();
      expect(ends).toEqual(id === 'a' ? ['0,0', '3,0'] : ['3,0', '6,0']);
    });

    it('holds regardless of pipe direction and object order', () => {
      const flipped = [valve('v', 3, 0), pipe('b', 6, 0, 3, 0), pipe('a', 3, 0, 0, 0)];
      expect(findRun(flipped, 'a', registry)!.ids).toEqual(['a']);
      expect(findRun(flipped, 'b', registry)!.ids).toEqual(['b']);
    });

    it('stops at the valve but still walks through elbows elsewhere on the run', () => {
      const objs = [pipe('a', 0, 0, 3, 0), elbow('e', 3, 0), pipe('b', 3, 0, 3, 4), valve('v', 3, 4), pipe('c', 3, 4, 3, 8)];
      const run = findRun(objs, 'a', registry)!;
      expect(new Set(run.ids)).toEqual(new Set(['a', 'e', 'b']));
      expect([run.start, run.end]).toContainEqual({ x: 3, y: 4 });
      expect(findRun(objs, 'c', registry)!.ids).toEqual(['c']);
    });

    it.each(['valve', 'end-cap', 'shaft', 'brewery:pump'])('any single-node part (%s; uninstalled parts default to 1x1) on the joint stops the walk', (object) => {
      const objs = [pipe('a', 0, 0, 3, 0), { id: 'x', object, x: 3, y: 0 }, pipe('b', 3, 0, 6, 0)];
      expect(findRun(objs, 'a', registry)!.ids).toEqual(['a']);
    });

    it.each(['label', 'area', 'tank', 'mixer'])('a floor annotation or vessel (%s) centred on the joint does not', (object) => {
      const objs = [pipe('a', 0, 0, 3, 0), { id: 'x', object, x: 3, y: 0 }, pipe('b', 3, 0, 6, 0)];
      expect(new Set(findRun(objs, 'a', registry)!.ids)).toEqual(new Set(['a', 'b']));
    });

    it('a valve off the joint (beside the line) does not stop it', () => {
      const objs = [pipe('a', 0, 0, 3, 0), valve('v', 3, 1), pipe('b', 3, 0, 6, 0)];
      expect(new Set(findRun(objs, 'a', registry)!.ids)).toEqual(new Set(['a', 'b']));
    });
  });

  it('returns null for non-pipe selections and survives closed loops', () => {
    expect(findRun([{ id: 't', object: 'tank', x: 0, y: 0 }], 't', registry)).toBeNull();
    expect(findRun(objs, 'missing', registry)).toBeNull();
    const loop = [pipe('l1', 0, 0, 2, 0), pipe('l2', 2, 0, 2, 2), pipe('l3', 2, 2, 0, 2), pipe('l4', 0, 2, 0, 0)];
    expect(findRun(loop, 'l1', registry)).not.toBeNull();
  });
});
