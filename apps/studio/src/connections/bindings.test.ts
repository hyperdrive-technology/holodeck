import type { ValueTransform } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { describe, expect, it } from 'vitest';
import {
  bindingProblems,
  connectionIdProblem,
  connectionUsages,
  EMPTY_TRANSFORM_FORM,
  formToTransform,
  parseSignalValue,
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
});
