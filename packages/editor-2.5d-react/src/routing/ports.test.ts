import { describe, expect, it } from 'vitest';
import { HEADINGS, rotateHeading, rotateOffset } from './grid';
import { resolveRouteEnd } from './ports';
import { coincidentPortRegistry, registry, tank } from './test-helpers';

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
    // The east port sits in the tank's cut-away window; that is allowed (the
    // pipe is drawn clipped at the wall, vessel-ports.ts clipPipeEnd).
    const east = resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: 1, y: 1 });
    expect(east).toMatchObject({ cell: { x: 1, y: 0 }, heading: 'e', partId: 't', port: 'east' });
    const west = resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: -1, y: -1 });
    expect(west).toMatchObject({ cell: { x: -1, y: 0 }, heading: 'w' });
  });

  it('rotates ports with the part', () => {
    // At pi the local west port faces world east.
    const r = resolveRouteEnd(scene(tank('t', 10, 10, Math.PI)), registry, { x: 11, y: 10 });
    expect(r).toMatchObject({ cell: { x: 11, y: 10 }, heading: 'e', port: 'west' });
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

  // holodeck#47: coincident ports used to resolve to whichever was declared
  // first; the caller's preferred heading (the original pipe's) must win.
  describe.each([[['east', 'west']], [['west', 'east']]] as const)('coincident ports (declared %j)', (order) => {
    const objects = [{ id: 'c', object: 'test:coincident', x: 3, y: 4 }];
    it.each(['e', 'w'] as const)('prefers the port facing %s', (prefer) => {
      const r = resolveRouteEnd({ objects }, coincidentPortRegistry(order), { x: 3, y: 4 }, { prefer });
      expect(r).toMatchObject({ cell: { x: 3, y: 4 }, heading: prefer, port: prefer === 'e' ? 'east' : 'west' });
    });
    it('keeps declaration order without a preference, or when no port faces it', () => {
      const reg = coincidentPortRegistry(order);
      expect(resolveRouteEnd({ objects }, reg, { x: 3, y: 4 }).port).toBe(order[0]);
      expect(resolveRouteEnd({ objects }, reg, { x: 3, y: 4 }, { prefer: 'n' }).port).toBe(order[0]);
    });
  });

  it('never prefers a farther port over a nearer one', () => {
    // Tank click near the east port; a west preference must not pull it across the vessel.
    expect(resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: 1, y: 0 }, { prefer: 'w' })).toMatchObject({ port: 'east' });
  });

  it('does not re-rank equidistant ports at different cells', () => {
    // Centre click on a tank: east and west ports are both 1 away; declaration order (east) wins.
    expect(resolveRouteEnd(scene(tank('t', 0, 0)), registry, { x: 0, y: 0 }, { prefer: 'w' })).toMatchObject({ port: 'east' });
  });
});
