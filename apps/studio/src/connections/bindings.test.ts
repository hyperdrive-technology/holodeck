import type { ValueTransform } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { describe, expect, it } from 'vitest';
import {
  bindingProblems,
  reconcileConnections,
  connectionIdProblem,
  connectionUsages,
  EMPTY_TRANSFORM_FORM,
  formToTransform,
  isPercentLeaf,
  parseSignalValue,
  suggestedTransformForm,
  transformToForm,
  withBinding,
} from './bindings';

describe('transforms as forms', () => {
  const cases: ValueTransform[] = [
    { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 },
    { kind: 'scale', inMin: 4, inMax: 20, outMin: 0, outMax: 100, clamp: false },
    { kind: 'threshold', steps: [{ at: 50, value: '#fa0' }, { at: 80, value: '#f00' }], below: '#0a0' },
    { kind: 'map', cases: { true: 'ON', false: 'OFF' }, default: '?' },
    { kind: 'format', template: '{value} rpm', digits: 1 },
  ];
  it.each(cases.map((t) => [t]))('round-trips %j', (t) => {
    expect(formToTransform(transformToForm(t))).toEqual({ transform: t, problems: [] });
  });

  // holodeck#165: editing an existing transform must not change its values.
  const lossy: ValueTransform[] = [
    { kind: 'map', cases: { '1': '7', '2': 'true', '3': 'null', '4': '', '5': 'two\nlines', '6': ' padded ', '7': '"quoted"' }, default: '' },
    { kind: 'map', cases: { 'a=b': 'x', '': 'empty key', ' sp': 'y', 'line\nkey': 'z' } },
    { kind: 'threshold', steps: [{ at: 0, value: '42' }, { at: 10, value: 'false' }], below: '' },
    { kind: 'map', cases: { on: 1, off: 0, unknown: null, flag: true } },
  ];
  it.each(lossy.map((t) => [t]))('round-trips string values losslessly %j', (t) => {
    expect(formToTransform(transformToForm(t))).toEqual({ transform: t, problems: [] });
  });

  it('none is no transform', () => {
    expect(formToTransform(EMPTY_TRANSFORM_FORM)).toEqual({ problems: [] });
    expect(transformToForm(undefined).kind).toBe('none');
  });

  it('reports the SDK validation problems', () => {
    expect(formToTransform({ ...EMPTY_TRANSFORM_FORM, kind: 'scale', inMax: 'x' }).problems.join()).toContain('inMax');
    expect(formToTransform({ ...EMPTY_TRANSFORM_FORM, kind: 'threshold', lines: '80 = a\n50 = b' }).problems.join()).toContain('ascending');
    expect(formToTransform({ ...EMPTY_TRANSFORM_FORM, kind: 'format', template: 'no placeholder' }).problems.join()).toContain('{value}');
    expect(formToTransform({ ...EMPTY_TRANSFORM_FORM, kind: 'threshold', lines: '' }).problems.join()).toContain('non-empty');
  });

  it.each([
    ['42', 42],
    ['true', true],
    ['null', null],
    ['"7"', '7'],
    ['#ff0000', '#ff0000'],
    ['  spaced  ', 'spaced'],
  ])('parseSignalValue(%j) = %j', (text, value) => {
    expect(parseSignalValue(text)).toEqual(value);
  });
});

describe('bindings', () => {
  const connections = [{ id: 'sim', provider: 'holodeck.sim' }];
  it('bindingProblems checks connection, source and transform', () => {
    expect(bindingProblems(connections, { connection: 'sim', source: 'sine:10' })).toEqual([]);
    expect(bindingProblems(connections, { connection: 'nope', source: '' })).toHaveLength(2);
    expect(bindingProblems(connections, { connection: 'sim', source: 'x', transform: { kind: 'format', template: 'x' } }).join()).toContain('{value}');
  });

  // holodeck#167: a source can carry an endpoint query; credentials there are refused.
  it('bindingProblems refuses credential-looking sources', () => {
    expect(bindingProblems(connections, { connection: 'sim', source: '/api/line2?api_key=SECRET#/speed' }).join()).toContain('api_key');
    expect(bindingProblems(connections, { connection: 'sim', source: 'https://u:SECRET@x.test/a' }).join()).not.toContain('SECRET');
    expect(bindingProblems(connections, { connection: 'sim', source: '/api/line2?limit=5#/speed' })).toEqual([]);
  });

  it('withBinding sets and removes, dropping an empty map', () => {
    const one = withBinding(undefined, 'level', { connection: 'sim', source: 'sine:10' });
    expect(one).toEqual({ level: { connection: 'sim', source: 'sine:10' } });
    expect(withBinding(one, 'level', undefined)).toBeUndefined();
    expect(withBinding({ ...one, rpm: { connection: 'sim', source: 'const:1' } }, 'level', undefined)).toEqual({ rpm: { connection: 'sim', source: 'const:1' } });
  });

  it('connectionUsages lists bound params', () => {
    const scene: IsoSceneFile = {
      id: 's',
      name: 'S',
      gridCellSize: 1,
      objects: [
        { id: 't', object: 'tank', x: 0, y: 0, bindings: { level: { connection: 'sim', source: 'sine:5' } } },
        { id: 'v', object: 'valve', x: 0, y: 0, bindings: { open: { connection: 'api', source: '/v' } } },
      ],
    };
    expect(connectionUsages(scene, 'sim')).toEqual(['t.level']);
    expect(connectionUsages(scene, 'none')).toEqual([]);
  });

  it.each([
    ['plant', [], null],
    ['prod-aws.eu_1', [], null],
    ['1abc', [], 'start with a letter'],
    ['a b', [], 'letters'],
    ['sim', ['sim'], 'already used'],
  ])('connectionIdProblem(%j)', (id, existing, problem) => {
    const result = connectionIdProblem(id, existing);
    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });

  // holodeck#164: undo can bring back bindings to a connection removed meanwhile.
  describe('reconcileConnections', () => {
    const plant = { id: 'plant', provider: 'holodeck.sim' };
    const scene: IsoSceneFile = {
      id: 's',
      name: 'S',
      gridCellSize: 1,
      objects: [
        { id: 't', object: 'tank', x: 0, y: 0, bindings: { level: { connection: 'plant', source: 'sine:5' }, temp: { connection: 'plant', source: 'const:1' } } },
        { id: 'v', object: 'valve', x: 0, y: 0, bindings: { open: { connection: 'ghost', source: 'mem:v' } } },
      ],
    };
    it('restores a connection removed earlier (once) and reports unknown ones as dangling', () => {
      const r = reconcileConnections(scene, [], new Map([['plant', plant]]));
      expect(r.connections).toEqual([plant]);
      expect(r.restored).toEqual(['plant']);
      expect(r.dangling).toEqual(['v.open']);
    });
    it('changes nothing when every binding has its connection', () => {
      const ok = { ...scene, objects: [scene.objects[0]!] };
      expect(reconcileConnections(ok, [plant], new Map())).toEqual({ connections: [plant], restored: [], dangling: [] });
    });
  });
});

describe('isPercentLeaf', () => {
  it('reads a % unit or a 0–100 range in the label', () => {
    expect(isPercentLeaf({ label: 'Sine, 10 s, 0–100' })).toBe(true);
    expect(isPercentLeaf({ label: 'Noise, seed 1, 0-100' })).toBe(true);
    expect(isPercentLeaf({ label: 'level', unit: '%' })).toBe(true);
    expect(isPercentLeaf({ label: 'level' })).toBe(false);
    expect(isPercentLeaf({ label: 'Range 0–1000' })).toBe(false);
    expect(isPercentLeaf({ label: 'Range 10–100' })).toBe(false);
    expect(isPercentLeaf({ label: 'Range 0.5–100' })).toBe(false);
  });
});

describe('suggestedTransformForm (a browse leaf picked for a ranged param)', () => {
  const level = { min: 0, max: 1 };
  const pct = { type: 'number' as const, label: 'Sine, 10 s, 0–100' };
  it('scales 0-100 onto the param range for a percent leaf and an untouched form', () => {
    const form = suggestedTransformForm(pct, level, EMPTY_TRANSFORM_FORM);
    expect(form).toMatchObject({ kind: 'scale', inMin: '0', inMax: '100', outMin: '0', outMax: '1', clamp: true });
    expect(formToTransform(form!)).toEqual({ transform: { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 }, problems: [] });
    expect(suggestedTransformForm(pct, { min: 0, max: 300 }, EMPTY_TRANSFORM_FORM)).toMatchObject({ outMin: '0', outMax: '300' });
    expect(suggestedTransformForm({ type: 'number', label: 'fill', unit: '%' }, level, EMPTY_TRANSFORM_FORM)).toMatchObject({ kind: 'scale' });
  });

  it('leaves a numeric leaf without a declared percent range alone (an HTTP /tank/level is often 0..1 already)', () => {
    expect(suggestedTransformForm({ type: 'number', label: 'level' }, level, EMPTY_TRANSFORM_FORM)).toBeNull();
  });

  it('never replaces a transform the user chose', () => {
    expect(suggestedTransformForm(pct, level, { ...EMPTY_TRANSFORM_FORM, kind: 'format' })).toBeNull();
    expect(suggestedTransformForm(pct, level, { ...EMPTY_TRANSFORM_FORM, kind: 'scale' })).toBeNull();
  });

  it('suggests nothing for non-numeric leaves, unranged params, 0-100 params or a bad range', () => {
    expect(suggestedTransformForm({ ...pct, type: 'boolean' }, level, EMPTY_TRANSFORM_FORM)).toBeNull();
    expect(suggestedTransformForm({ label: pct.label }, level, EMPTY_TRANSFORM_FORM)).toBeNull();
    expect(suggestedTransformForm(pct, undefined, EMPTY_TRANSFORM_FORM)).toBeNull();
    expect(suggestedTransformForm(pct, { min: 0, max: 100 }, EMPTY_TRANSFORM_FORM)).toBeNull();
    expect(suggestedTransformForm(pct, { min: 1, max: 1 }, EMPTY_TRANSFORM_FORM)).toBeNull();
    expect(suggestedTransformForm(pct, { min: 0, max: Number.NaN }, EMPTY_TRANSFORM_FORM)).toBeNull();
  });
});
