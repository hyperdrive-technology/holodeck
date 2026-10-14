import { describe, expect, it } from 'vitest';
import { collectIsoBindings, isoBindingProblems, placementBindingProblems, placementsOf } from './bindings';

const ok = { connection: 'plant', source: 'sine:10' };

describe('isoBindingProblems', () => {
  it('accepts a minimal binding and every transform kind', () => {
    expect(isoBindingProblems(ok, 'b')).toEqual([]);
    const transforms = [
      { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 },
      { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1, clamp: false },
      { kind: 'threshold', steps: [{ at: 50, value: 'warn' }, { at: 90, value: 'alarm' }], below: 'ok' },
      { kind: 'map', cases: { ALARM: '#e74c3c', OK: '#2ecc71' }, default: '#bdc3c7' },
      { kind: 'format', template: '{value} %', digits: 0 },
    ];
    for (const transform of transforms) expect(isoBindingProblems({ ...ok, transform }, 'b')).toEqual([]);
  });

  it('rejects values that are not objects', () => {
    for (const raw of [null, undefined, 'plant/sine:10', 42, true, [ok]]) {
      expect(isoBindingProblems(raw, 'p.level')).toEqual(['p.level: must be an object { connection, source, transform? }']);
    }
  });

  it('lists every missing or empty field', () => {
    expect(isoBindingProblems({}, 'p.level')).toEqual([
      'p.level.connection: must be a non-empty string',
      'p.level.source: must be a non-empty string',
    ]);
    expect(isoBindingProblems({ connection: '', source: 7 }, 'x')).toEqual([
      'x.connection: must be a non-empty string',
      'x.source: must be a non-empty string',
    ]);
  });

  it('checks transforms with the SDK validator, under the binding path', () => {
    expect(isoBindingProblems({ ...ok, transform: { kind: 'sqrt' } }, 'p.level')).toEqual([
      'p.level.transform.kind: must be one of scale, threshold, map, format',
    ]);
    expect(isoBindingProblems({ ...ok, transform: { kind: 'scale', inMin: 0, inMax: 1 } }, 'p.level')).toEqual([
      'p.level.transform.outMin: must be a finite number',
      'p.level.transform.outMax: must be a finite number',
    ]);
    expect(isoBindingProblems({ ...ok, transform: null }, 'p.level')).toEqual(['p.level.transform: must be an object']);
  });

  it('ignores extra fields (documents are lenient, like the SDK validateBindings)', () => {
    expect(isoBindingProblems({ ...ok, note: 'from the P&ID' }, 'b')).toEqual([]);
  });
});

describe('placementBindingProblems', () => {
  it('absent bindings and an empty map are fine', () => {
    expect(placementBindingProblems('t1', undefined)).toEqual([]);
    expect(placementBindingProblems('t1', {})).toEqual([]);
  });

  it('rejects a bindings value that is not a map', () => {
    for (const raw of [null, [], 'level', 3]) {
      expect(placementBindingProblems('t1', raw)).toEqual([
        'placement t1: bindings must be an object mapping param names to bindings',
      ]);
    }
  });

  it('lists every problem of every param, prefixed with the placement', () => {
    expect(
      placementBindingProblems('t1', {
        level: ok,
        temp: { connection: 'plant' },
        alarm: 'x',
        color: { ...ok, transform: { kind: 'map', cases: { A: {} } } },
      }),
    ).toEqual([
      'placement t1: bindings.temp.source: must be a non-empty string',
      'placement t1: bindings.alarm: must be an object { connection, source, transform? }',
      'placement t1: bindings.color.transform.cases: must map strings to signal values',
    ]);
  });

  it('needs an addressable placement id and param names', () => {
    expect(placementBindingProblems('', { level: ok })).toEqual(['placement : bindings need a non-empty placement id']);
    expect(placementBindingProblems(undefined, { level: ok })).toEqual([
      'placement undefined: bindings need a non-empty placement id',
    ]);
    expect(placementBindingProblems('t1', { '': ok })).toEqual(['placement t1: bindings has an empty param name']);
  });
});

describe('collectIsoBindings', () => {
  it('returns every binding in placement order, then param order', () => {
    const body = {
      objects: [
        { id: 'a', object: 'tank', x: 0, y: 0, bindings: { level: ok, temp: { connection: 'plant', source: 'ramp:30' } } },
        { id: 'b', object: 'pipe', x: 0, y: 0 },
        { id: 'c', object: 'valve', x: 0, y: 0, bindings: { open: { connection: 'aws', source: 'alarm:x' } } },
      ],
    };
    expect(collectIsoBindings(body)).toEqual([
      { objectId: 'a', param: 'level', binding: ok },
      { objectId: 'a', param: 'temp', binding: { connection: 'plant', source: 'ramp:30' } },
      { objectId: 'c', param: 'open', binding: { connection: 'aws', source: 'alarm:x' } },
    ]);
  });

  it('keeps the binding objects themselves (no copies)', () => {
    const binding = { ...ok };
    const [ref] = collectIsoBindings({ objects: [{ id: 'a', bindings: { level: binding } }] });
    expect(ref?.binding).toBe(binding);
  });

  it('tolerates any input and skips what cannot be addressed', () => {
    for (const body of [undefined, null, 1, 'scene', [], {}, { objects: 'nope' }, { objects: {} }]) {
      expect(collectIsoBindings(body)).toEqual([]);
    }
    expect(
      collectIsoBindings({
        objects: [null, 'x', { bindings: { level: ok } }, { id: 7, bindings: { level: ok } }, { id: 'a', bindings: [ok] }, { id: 'b', bindings: 'x' }],
      }),
    ).toEqual([]);
  });

  it('passes malformed binding values through so document validation can name them', () => {
    expect(collectIsoBindings({ objects: [{ id: 'a', bindings: { level: 'plant/x', temp: null } }] })).toEqual([
      { objectId: 'a', param: 'level', binding: 'plant/x' },
      { objectId: 'a', param: 'temp', binding: null },
    ]);
  });

  it('treats a JSON "__proto__" param as an ordinary own key', () => {
    const body = JSON.parse('{"objects":[{"id":"a","bindings":{"__proto__":{"connection":"c","source":"s"}}}]}');
    expect(collectIsoBindings(body)).toEqual([{ objectId: 'a', param: '__proto__', binding: { connection: 'c', source: 's' } }]);
    expect(({} as Record<string, unknown>).connection).toBeUndefined();
  });
});

describe('placementsOf', () => {
  it('returns objects only when it is an array', () => {
    const objects = [{ id: 'a' }];
    expect(placementsOf({ objects })).toBe(objects);
    expect(placementsOf({ objects: {} })).toEqual([]);
    expect(placementsOf(null)).toEqual([]);
  });
});
