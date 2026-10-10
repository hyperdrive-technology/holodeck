import { describe, expect, it } from 'vitest';
import { HEADINGS, rotateHeading, rotateOffset } from './grid';
import { resolveRouteEnd } from './ports';
import { registry, tank } from './test-helpers';

const scene = (...objects: ReturnType<typeof tank>[]) => ({ objects });

describe('rotation helpers', () => {
  it('rotates headings by yaw (east -> north at +90 deg)', () => {
    expect(rotateHeading('e', Math.PI / 2)).toBe('n');
    expect(rotateHeading('e', Math.PI)).toBe('w');
    expect(rotateHeading('e', -Math.PI / 2)).toBe('s');
    expect(HEADINGS.map((h) => rotateHeading(h, 2 * Math.PI))).toEqual([...HEADINGS]);
  });
  it('rotates offsets consistently with headings', () => {
    expect(rotateOffset(1, 0, Math.PI / 2)).toEqual({ x: 0, y: -1 });
    expect(rotateOffset(1, 0, Math.PI)).toEqual({ x: -1, y: 0 });
  });
});

describe('resolveRouteEnd', () => {
  it('returns the bare cell outside any part', () => {
    expect(resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: 9, y: 9 })).toEqual({ cell: { x: 9, y: 9 } });
  });

  it('snaps a click inside a tank to the nearest port and points outward', () => {
    const east = resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: 1, y: 1 });
    expect(east).toMatchObject({ cell: { x: 1, y: 0 }, heading: 'e', partId: 't', port: 'east' });
    const west = resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: -1, y: -1 });
    expect(west).toMatchObject({ cell: { x: -1, y: 0 }, heading: 'w' });
  });

  it('rotates ports with the part', () => {
    const r = resolveRouteEnd(scene(tank('t', 10, 10, Math.PI / 2)), registry, { x: 10, y: 9 });
    expect(r).toMatchObject({ cell: { x: 10, y: 9 }, heading: 'n', port: 'east' });
  });

  it('treats a part without ports as a bare cell', () => {
    expect(resolveRouteEnd({ objects: [{ id: 'v', object: 'valve', x: 0, y: 0 }] }, registry, { x: 0, y: 0 })).toEqual({
      cell: { x: 0, y: 0 },
    });
  });

  it('ignores excluded parts', () => {
    expect(resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: 1, y: 0 }, { exclude: new Set(['t']) })).toEqual({
      cell: { x: 1, y: 0 },
    });
  });
});
