import { describe, expect, it } from 'vitest';
import { parseSceneFile, type IsoPlacement } from '../iso/scene';
import { attachProblems } from '../objects/validate';
import {
  attachRecord,
  detachPipeEnds,
  endsAttachedTo,
  isAttachTarget,
  PORT_ATTACH_TOLERANCE,
  remapPipeEnds,
  resolvePipeEnd,
  withPipeAttach,
} from './attach';
import { coincidentPortRegistry, pipe, registry, tank } from './test-helpers';

// Built-in tank: 2x2, ports east (+1, 0, e) and west (-1, 0, w).

describe('attach validation (schema + parse)', () => {
  it('accepts { object, port? } on either end', () => {
    expect(attachProblems('p', undefined)).toEqual([]);
    expect(attachProblems('p', { from: { object: 't', port: 'east' }, to: { object: 'v' } })).toEqual([]);
  });

  it.each([
    ['not an object', 5],
    ['an unknown end', { middle: { object: 't' } }],
    ['an end without object', { from: { port: 'east' } }],
    ['an empty object id', { from: { object: '' } }],
    ['an empty port', { to: { object: 't', port: '' } }],
    ['extra fields', { to: { object: 't', x: 1 } }],
  ])('rejects %s', (_label, attach) => {
    expect(attachProblems('p', attach).length).toBeGreaterThan(0);
  });

  it('parses a scene with attach and rejects a malformed one', () => {
    const ok = { id: 's', name: 's', gridCellSize: 1, objects: [tank('t', 0, 0), { ...pipe('p', 1, 0, 5, 0), attach: { from: { object: 't', port: 'east' } } }] };
    expect(parseSceneFile(ok, registry).objects[1]!.attach).toEqual({ from: { object: 't', port: 'east' } });
    const bad = { ...ok, objects: [tank('t', 0, 0), { ...pipe('p', 1, 0, 5, 0), attach: { from: 't' } }] };
    expect(() => parseSceneFile(bad, registry)).toThrow(/attach\.from/);
  });

  it('a dangling attach id still parses (geometry decides, like onPipe)', () => {
    const scene = { id: 's', name: 's', gridCellSize: 1, objects: [{ ...pipe('p', 1, 0, 5, 0), attach: { from: { object: 'gone' } } }] };
    expect(() => parseSceneFile(scene, registry)).not.toThrow();
  });
});

describe('resolvePipeEnd (inference)', () => {
  const objects = (...extra: IsoPlacement[]) => [tank('t', 0, 0), ...extra];

  it('infers a port when the end is on it and the pipe leaves outward', () => {
    const p = pipe('p', 1, 0, 5, 0);
    expect(resolvePipeEnd(objects(p), registry, p, 'from')).toMatchObject({ object: 't', port: 'east', heading: 'e', explicit: false, point: { x: 1, y: 0 } });
    expect(resolvePipeEnd(objects(p), registry, p, 'to')).toBeNull();
  });

  it('infers the `to` end of a pipe drawn into a port', () => {
    const p = pipe('p', -6, 0, -1, 0);
    expect(resolvePipeEnd(objects(p), registry, p, 'to')).toMatchObject({ object: 't', port: 'west', heading: 'w' });
  });

  it('absorbs an end that stops short of / past the port within the tolerance (brewery wall ends)', () => {
    for (const x of [1.3, 0.8, 1 + PORT_ATTACH_TOLERANCE]) {
      const p = pipe('p', x, 0, 6, 0);
      expect(resolvePipeEnd(objects(p), registry, p, 'from')?.port).toBe('east');
    }
    const far = pipe('p', 1.6, 0, 6, 0);
    expect(resolvePipeEnd(objects(far), registry, far, 'from')).toBeNull();
  });

  it('does not infer a pipe that runs into the vessel or off the port axis', () => {
    const inward = pipe('p', 1, 0, -4, 0);
    expect(resolvePipeEnd(objects(inward), registry, inward, 'from')).toBeNull();
    const sideways = pipe('p', 1, 0, 1, 4);
    expect(resolvePipeEnd(objects(sideways), registry, sideways, 'from')).toBeNull();
    const offAxis = pipe('p', 1, 0.5, 6, 0.5);
    expect(resolvePipeEnd(objects(offAxis), registry, offAxis, 'from')).toBeNull();
  });

  it('infers a centre attachment (valve on a joint, end cap, bottom outlet) with the pipe direction as heading', () => {
    const valve: IsoPlacement = { id: 'v', object: 'valve', x: 5, y: 0 };
    const p = pipe('p', 1, 0, 5, 0);
    expect(resolvePipeEnd([valve, p], registry, p, 'to')).toMatchObject({ object: 'v', heading: 'w' });
    expect(resolvePipeEnd([valve, p], registry, p, 'to')?.port).toBeUndefined();
    const outlet = pipe('o', 0, 0, 0, 4);
    expect(resolvePipeEnd(objects(outlet), registry, outlet, 'from')).toMatchObject({ object: 't', heading: 's' });
  });

  it('never attaches to elbows, labels, areas or other pipes', () => {
    const p = pipe('p', 1, 0, 5, 0);
    const others: IsoPlacement[] = [
      { id: 'e', object: 'elbow', x: 5, y: 0 },
      { id: 'l', object: 'label', x: 5, y: 0 },
      { id: 'a', object: 'area', x: 5, y: 0 },
      pipe('q', 5, 0, 5, 4),
    ];
    for (const o of others) expect(isAttachTarget(o, registry)).toBe(false);
    expect(resolvePipeEnd([p, ...others], registry, p, 'to')).toBeNull();
  });

  it('later placements win when two parts both match (they draw on top)', () => {
    const p = pipe('p', 1, 0, 5, 0);
    const a: IsoPlacement = { id: 'a', object: 'valve', x: 1, y: 0 };
    expect(resolvePipeEnd([tank('t', 0, 0), a, p], registry, p, 'from')?.object).toBe('a');
    expect(resolvePipeEnd([a, tank('t', 0, 0), p], registry, p, 'from')?.object).toBe('t');
  });
});

describe('resolvePipeEnd (explicit records)', () => {
  it('honours a valid record and marks it explicit', () => {
    const p = { ...pipe('p', 1, 0, 5, 0), attach: { from: { object: 't', port: 'east' } } };
    expect(resolvePipeEnd([tank('t', 0, 0), p], registry, p, 'from')).toMatchObject({ object: 't', port: 'east', explicit: true });
  });

  it('ignores a stale record (part moved away, unknown port, unknown id) and falls back to inference', () => {
    const p = { ...pipe('p', 1, 0, 5, 0), attach: { from: { object: 'gone', port: 'east' } } };
    expect(resolvePipeEnd([tank('t', 0, 0), p], registry, p, 'from')).toMatchObject({ object: 't', explicit: false });
    const wrongPort = { ...p, attach: { from: { object: 't', port: 'west' } } };
    expect(resolvePipeEnd([tank('t', 0, 0), wrongPort], registry, wrongPort, 'from')).toMatchObject({ port: 'east', explicit: false });
    const moved = { ...p, attach: { from: { object: 't', port: 'east' } } };
    expect(resolvePipeEnd([tank('t', 10, 10), moved], registry, moved, 'from')).toBeNull();
  });

  it('a record picks between coincident ports that inference cannot tell apart (holodeck#47)', () => {
    const reg = coincidentPortRegistry(['east', 'west']);
    const part: IsoPlacement = { id: 'c', object: 'test:coincident', x: 0, y: 0 };
    const p = pipe('p', 0, 0, -5, 0);
    // Inference requires the pipe to leave outward, so a west-going pipe picks west...
    expect(resolvePipeEnd([part, p], reg, p, 'from')?.port).toBe('west');
    // ...and a record naming east is still honoured (it lies on that port too).
    const rec = { ...p, attach: { from: { object: 'c', port: 'east' } } };
    expect(resolvePipeEnd([part, rec], reg, rec, 'from')).toMatchObject({ port: 'east', heading: 'e', explicit: true });
  });
});

describe('endsAttachedTo', () => {
  it('lists every pipe end on the given parts, skipping pipes that are themselves selected', () => {
    const objects = [tank('a', 0, 0), tank('b', 10, 0), pipe('p', 1, 0, 9, 0), pipe('q', -1, 0, -5, 0), pipe('free', 20, 0, 25, 0)];
    const ends = endsAttachedTo(objects, registry, new Set(['a']));
    expect(ends.map((e) => [e.pipe.id, e.end, e.attach.port])).toEqual([['p', 'from', 'east'], ['q', 'from', 'west']]);
    expect(endsAttachedTo(objects, registry, new Set(['a', 'b'])).map((e) => `${e.pipe.id}.${e.end}`)).toEqual(['p.from', 'p.to', 'q.from']);
    expect(endsAttachedTo(objects, registry, new Set(['a', 'p'])).map((e) => e.pipe.id)).toEqual(['q']);
  });
});

describe('attach record helpers', () => {
  const p = { ...pipe('p', 1, 0, 9, 0), attach: { from: { object: 'a', port: 'east' }, to: { object: 'b', port: 'west' } } };

  it('withPipeAttach sets / clears one end and drops an empty attach', () => {
    expect(withPipeAttach(pipe('p', 0, 0, 1, 0), 'to', { object: 'x' }).attach).toEqual({ to: { object: 'x' } });
    const cleared = withPipeAttach(withPipeAttach(p, 'from', null), 'to', null);
    expect('attach' in cleared).toBe(false);
  });

  it('detachPipeEnds frees ends whose part is gone, same object when untouched', () => {
    expect(detachPipeEnds(p, (id) => id === 'b').attach).toEqual({ from: { object: 'a', port: 'east' } });
    expect(detachPipeEnds(p, () => false)).toBe(p);
  });

  it('remapPipeEnds renames through the paste id map and drops ends outside it', () => {
    expect(remapPipeEnds(p, new Map([['a', 'a-2']])).attach).toEqual({ from: { object: 'a-2', port: 'east' } });
  });

  it('attachRecord omits an undefined port', () => {
    expect(attachRecord({ object: 'v' })).toEqual({ object: 'v' });
    expect(attachRecord({ object: 't', port: 'east' })).toEqual({ object: 't', port: 'east' });
  });
});
