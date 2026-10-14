import { describe, expect, it } from 'vitest';
import type { IsoPlacement } from '../iso/scene';
import { ELBOW_RADIUS } from '../../assets/process/pipe-math';
import {
  carryHostedParts,
  chainFrom,
  detachFrom,
  findHostPipe,
  hostPipeOf,
  INLINE_PART_LENGTH,
  INLINE_PART_MARGIN,
  placeOnRoute,
  positionOnPipe,
  segOf,
  withAttachment,
  type PipeSeg,
} from './inline';
import { pipe } from './test-helpers';

const seg = (id: string, x: number, y: number, toX: number, toY: number): PipeSeg => segOf(pipe(id, x, y, toX, toY));
const valve = (id: string, x: number, y: number, extra: Partial<IsoPlacement> = {}): IsoPlacement => ({ id, object: 'valve', x, y, ...extra });

describe('positionOnPipe', () => {
  const s = seg('p', 0, 0, 10, 0);
  it('returns the fraction along the pipe for a point on it', () => {
    expect(positionOnPipe(s, 4, 0)).toBeCloseTo(0.4);
    expect(positionOnPipe(seg('r', 10, 0, 0, 0), 4, 0)).toBeCloseTo(0.6); // reversed pipe
    expect(positionOnPipe(seg('v', 2, 0, 2, 8), 2, 6)).toBeCloseTo(0.75);
  });
  it('is null off the pipe, past its ends, and at either joint', () => {
    expect(positionOnPipe(s, 4, 0.5)).toBeNull();
    expect(positionOnPipe(s, 11, 0)).toBeNull();
    expect(positionOnPipe(s, -1, 0)).toBeNull();
    expect(positionOnPipe(s, 0, 0)).toBeNull();
    expect(positionOnPipe(s, 10, 0)).toBeNull();
    expect(positionOnPipe(s, 0.0004, 0)).toBeNull(); // within eps of the joint = at the joint
  });
  it('is null for a zero-length pipe', () => {
    expect(positionOnPipe(seg('z', 3, 3, 3, 3), 3, 3)).toBeNull();
  });
  it('tolerates hand-authored 2-decimal coordinates', () => {
    expect(positionOnPipe(seg('h', 4, -5.42, 4, -9.72), 4, -7.57)).toBeCloseTo(0.5, 2);
  });
});

describe('findHostPipe / withAttachment', () => {
  const objects = [pipe('a', 0, 0, 10, 0), pipe('b', 0, 5, 0, 9), valve('v', 3, 0)];
  it('finds the pipe a point lies strictly inside', () => {
    expect(findHostPipe(objects, 3, 0)).toEqual({ onPipe: 'a', at: 0.3 });
    expect(findHostPipe(objects, 0, 7)).toEqual({ onPipe: 'b', at: 0.5 });
  });
  it('ignores joints, free space and the part itself being a pipe', () => {
    expect(findHostPipe(objects, 0, 5)).toBeNull();
    expect(findHostPipe(objects, 3, 2)).toBeNull();
    expect(findHostPipe(objects, 3, 0, 'a')).toBeNull(); // skipId
  });
  it('withAttachment sets, refreshes and clears the attachment without mutating', () => {
    const v = valve('v', 3, 0);
    const placed = withAttachment(v, objects);
    expect(placed).toMatchObject({ onPipe: 'a', at: 0.3 });
    expect(v).not.toHaveProperty('onPipe');
    const moved = withAttachment({ ...placed, x: 6 }, objects);
    expect(moved).toMatchObject({ onPipe: 'a', at: 0.6 });
    const off = withAttachment({ ...placed, y: 4 }, objects);
    expect(off).not.toHaveProperty('onPipe');
    expect(off).not.toHaveProperty('at');
  });
});

describe('hostPipeOf', () => {
  const objects = [pipe('a', 0, 0, 10, 0)];
  it('honours an attachment only while the part is on the pipe', () => {
    expect(hostPipeOf(valve('v', 5, 0, { onPipe: 'a', at: 0.5 }), objects)?.id).toBe('a');
    expect(hostPipeOf(valve('v', 5, 3, { onPipe: 'a', at: 0.5 }), objects)).toBeNull(); // dragged away
    expect(hostPipeOf(valve('v', 5, 0), objects)).toBeNull(); // geometry alone is not enough
    expect(hostPipeOf(valve('v', 5, 0, { onPipe: 'gone' }), objects)).toBeNull(); // dangling id
    expect(hostPipeOf(valve('v', 5, 0, { onPipe: 'tank' }), [{ id: 'tank', object: 'tank', x: 5, y: 0 }])).toBeNull(); // not a pipe
    expect(hostPipeOf(valve('v', 10, 0, { onPipe: 'a', at: 1 }), objects)).toBeNull(); // at a joint
  });
});

describe('detachFrom', () => {
  it('strips onPipe/at from parts hosted on the pipe only', () => {
    const out = detachFrom([valve('v', 1, 0, { onPipe: 'a', at: 0.1 }), valve('w', 2, 0, { onPipe: 'b', at: 0.2 })], 'a');
    expect(out[0]).toEqual(valve('v', 1, 0));
    expect(out[1]).toMatchObject({ onPipe: 'b', at: 0.2 });
  });
});

describe('chainFrom', () => {
  it('orders and orients pipes along travel from the start', () => {
    const pipes = [seg('c', 3, 4, 3, 8), seg('a', 0, 0, 3, 0), seg('b', 3, 4, 3, 0)];
    expect(chainFrom(pipes, { x: 0, y: 0 }).map((s) => [s.id, s.from, s.to])).toEqual([
      ['a', { x: 0, y: 0 }, { x: 3, y: 0 }],
      ['b', { x: 3, y: 0 }, { x: 3, y: 4 }], // reversed in the scene, oriented here
      ['c', { x: 3, y: 4 }, { x: 3, y: 8 }],
    ]);
  });
  it('is empty when nothing touches the start', () => {
    expect(chainFrom([seg('a', 0, 0, 3, 0)], { x: 9, y: 9 })).toEqual([]);
  });
});

describe('placeOnRoute', () => {
  const l = [seg('a', 0, 0, 0, 6), seg('b', 0, 6, 8, 6)]; // total 14
  it('maps the fraction onto the route by length', () => {
    expect(placeOnRoute(l, 3 / 14)).toMatchObject({ seg: { id: 'a' }, t: 0.5 });
    const r = placeOnRoute(l, 10 / 14)!;
    expect(r.seg.id).toBe('b');
    expect(r.t).toBeCloseTo(0.5);
  });
  it('slides a part off an elbow onto the clear part of the straight', () => {
    const r = placeOnRoute(l, 6 / 14)!; // exactly on the bend
    const along = r.t * 6;
    expect(r.seg.id).toBe('a');
    expect(along).toBeCloseTo(6 - ELBOW_RADIUS - INLINE_PART_LENGTH / 2 - INLINE_PART_MARGIN);
    const r2 = placeOnRoute(l, 6.2 / 14)!; // just past the bend
    expect(r2.seg.id).toBe('b');
    expect(r2.t * 8).toBeCloseTo(ELBOW_RADIUS + INLINE_PART_LENGTH / 2 + INLINE_PART_MARGIN);
  });
  it('clears the route start and end by the body half-length plus a margin', () => {
    expect(placeOnRoute(l, 0.01)!.t * 6).toBeGreaterThan(0);
    expect(placeOnRoute(l, 0.01)!.t * 6).toBeLessThan(ELBOW_RADIUS);
    const end = placeOnRoute(l, 1)!;
    expect(end.t).toBeLessThan(1); // strictly inside, so it stays hosted
    expect((1 - end.t) * 8).toBeCloseTo(INLINE_PART_LENGTH / 2 + INLINE_PART_MARGIN);
  });
  it('skips straights too short to clear their bends and the part body', () => {
    const short = [seg('a', 0, 0, 0, 3), seg('b', 0, 3, 1, 3), seg('c', 1, 3, 1, 6)];
    expect(placeOnRoute(short, 0.5)!.seg.id).not.toBe('b');
    expect(placeOnRoute([seg('tiny', 0, 0, 0.7, 0)], 0.5)).toBeNull();
  });
  it('returns null for an empty or zero-length route', () => {
    expect(placeOnRoute([], 0.5)).toBeNull();
    expect(placeOnRoute([seg('z', 1, 1, 1, 1)], 0.5)).toBeNull();
  });
  it('clamps out-of-range fractions', () => {
    expect(placeOnRoute(l, -3)!.seg.id).toBe('a');
    expect(placeOnRoute(l, 7)!.seg.id).toBe('b');
  });
});

describe('carryHostedParts', () => {
  const old = [seg('old', 0, 0, 10, 0)];
  it('keeps the same fraction on a straight replacement and stays attached', () => {
    const [v] = carryHostedParts([valve('v', 4, 0, { onPipe: 'old', at: 0.4 })], old, [seg('new', 0, 0, 20, 0)])!;
    expect(v).toMatchObject({ x: 8, y: 0, onPipe: 'new', at: 0.4 });
    expect(v).not.toHaveProperty('rotation');
  });
  it('turns the part with the pipe axis when it lands on a perpendicular straight', () => {
    const route = [seg('n1', 0, 0, 0, 5), seg('n2', 0, 5, 5, 5)];
    const [v] = carryHostedParts([valve('v', 2, 0, { onPipe: 'old', at: 0.2 })], old, route)!;
    expect(v).toMatchObject({ x: 0, y: 2, onPipe: 'n1' });
    expect(v!.rotation).toBeCloseTo(Math.PI / 2);
    // A yawed part keeps its own offset from the axis.
    const [w] = carryHostedParts([valve('w', 2, 0, { onPipe: 'old', rotation: Math.PI / 2 })], old, route)!;
    expect(w!.rotation).toBeCloseTo(Math.PI);
  });
  it('uses the pipe geometry, not a stale `at`', () => {
    const [v] = carryHostedParts([valve('v', 5, 0, { onPipe: 'old', at: 0.9 })], old, [seg('new', 0, 0, 10, 0)])!;
    expect(v).toMatchObject({ x: 5, at: 0.5 });
  });
  it('maps across a multi-pipe run by total length', () => {
    const chain = [seg('o1', 0, 0, 4, 0), seg('o2', 4, 0, 4, 4)];
    const [v] = carryHostedParts([valve('v', 4, 2, { onPipe: 'o2', at: 0.5 })], chain, [seg('n', 0, 0, 16, 0)])!;
    expect(v).toMatchObject({ x: 12, y: 0, onPipe: 'n' });
  });
  it('rejects an invalid old attachment or an empty replacement route', () => {
    const v = valve('v', 5, 0, { onPipe: 'zzz' });
    expect(carryHostedParts([v], old, [seg('n', 0, 0, 5, 0)])).toBeNull();
    const w = valve('w', 5, 0, { onPipe: 'old' });
    expect(carryHostedParts([w], old, [])).toBeNull();
  });

  it('shortens a U run without overlapping carried bodies and preserves geometric order', () => {
    const chain = [seg('a', 0, 0, 0, 10), seg('b', 0, 10, 10, 10), seg('c', 10, 10, 10, 0)];
    const parts = [valve('later', 0, 4, { onPipe: 'a' }), valve('earlier', 0, 3, { onPipe: 'a' })];
    const [later, earlier] = carryHostedParts(parts, chain, [seg('new', 0, 0, 10, 0)])!;
    expect(earlier!.x).toBeCloseTo(1);
    expect(later!.x - earlier!.x).toBeGreaterThanOrEqual(INLINE_PART_LENGTH + INLINE_PART_MARGIN - 1e-9);
    expect(later!.onPipe).toBe('new');
    expect(earlier!.onPipe).toBe('new');
    expect(parts.map((p) => p.x)).toEqual([0, 0]); // inputs unchanged
  });

  it('shifts a late cluster upstream to leave room for every part', () => {
    const parts = [8, 8.8, 9.6].map((x, i) => valve(`v${i}`, x, 0, { onPipe: 'old' }));
    const moved = carryHostedParts(parts, old, [seg('new', 0, 0, 3, 0)])!;
    expect(moved).toHaveLength(3);
    expect(moved[2]!.x).toBeCloseTo(2.6);
    for (let i = 1; i < moved.length; i += 1) {
      expect(moved[i]!.x - moved[i - 1]!.x).toBeCloseTo(INLINE_PART_LENGTH + INLINE_PART_MARGIN);
    }
  });

  it('distributes a cluster near bends over clear straights without coinciding', () => {
    const parts = [4.1, 4.9, 5.7].map((x, i) => valve(`v${i}`, x, 0, { onPipe: 'old' }));
    const route = [seg('a', 0, 0, 0, 4), seg('short', 0, 4, 1, 4), seg('b', 1, 4, 1, 8)];
    const moved = carryHostedParts(parts, old, route)!;
    const distances = moved.map((p) => p.onPipe === 'a' ? p.y : 5 + p.y - 4);
    expect(distances[0]).toBeLessThan(distances[1]!);
    expect(distances[1]).toBeLessThan(distances[2]!);
    for (const p of moved) {
      expect(p.onPipe).not.toBe('short');
      const host = route.find((s) => s.id === p.onPipe)!;
      expect(positionOnPipe(host, p.x, p.y)).toBeCloseTo(p.at!);
      const fromBend = p.onPipe === 'a' ? 4 - p.y : p.y - 4;
      expect(fromBend).toBeGreaterThanOrEqual(ELBOW_RADIUS + INLINE_PART_LENGTH / 2 + INLINE_PART_MARGIN - 1e-9);
    }
    for (let i = 1; i < moved.length; i += 1) {
      expect(Math.hypot(moved[i]!.x - moved[i - 1]!.x, moved[i]!.y - moved[i - 1]!.y))
        .toBeGreaterThanOrEqual(INLINE_PART_LENGTH + INLINE_PART_MARGIN - 1e-9);
    }
  });

  it('rejects too many parts for a straight or a route trimmed by bends', () => {
    const parts = [2, 4, 6].map((x, i) => valve(`v${i}`, x, 0, { onPipe: 'old' }));
    expect(carryHostedParts(parts, old, [seg('new', 0, 0, 2, 0)])).toBeNull();
    const bends = [seg('a', 0, 0, 0, 1), seg('b', 0, 1, 1, 1), seg('c', 1, 1, 1, 2)];
    expect(carryHostedParts(parts, old, bends)).toBeNull();
  });

  it.each([1, 2, 3, 10])('fits %i parts at the exact clearance limit', (count) => {
    const parts = Array.from({ length: count }, (_, i) => valve(`v${i}`, (i + 0.5) * 10 / count, 0, { onPipe: 'old' }));
    const length = 0.8 + (count - 1) * 0.7;
    const moved = carryHostedParts(parts, old, [seg('new', 0, 0, length, 0)])!;
    expect(moved).not.toBeNull();
    expect(moved.map((p) => p.x)).toEqual(parts.map((_, i) => expect.closeTo(0.4 + i * 0.7)));
  });

  it('handles no carried parts', () => {
    expect(carryHostedParts([], [], [])).toEqual([]);
  });
});
