import { describe, expect, it } from 'vitest';
import type { IsoPartParamSpec } from '../registry/types';
import {
  appearanceProblems,
  assetUrlProblem,
  isHexColor,
  jsonValueProblem,
  linkProblems,
  MAX_LINK_VIA,
  MAX_META_ENTRIES,
  MAX_PARAM_STRING,
  MAX_URL_LENGTH,
  metaProblems,
  paramsProblems,
  paramValueProblem,
} from './validate';

describe('isHexColor', () => {
  it.each(['#fff', '#FFFF', '#c0392b', '#c0392b80'])('accepts %s', (c) => expect(isHexColor(c)).toBe(true));
  it.each(['', 'red', '#ff', '#12345', '#ggg', 'rgb(0,0,0)', '#c0392b8', 3, null])('rejects %s', (c) =>
    expect(isHexColor(c)).toBe(false));
});

describe('assetUrlProblem', () => {
  it.each(['/models/logo.svg', 'logo.png', './a/b.png', 'https://example.com/x.svg', 'http://x/y', 'blob:https://x/1', 'data:image/svg+xml;base64,AAAA', 'DATA:IMAGE/png;base64,AA'])(
    'accepts %s',
    (url) => expect(assetUrlProblem(url)).toBeNull(),
  );
  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'vbscript:x', 'ftp://x/y'])(
    'rejects scheme %s',
    (url) => expect(assetUrlProblem(url)).toMatch(/scheme/),
  );
  it('rejects empty, whitespace, non-strings and oversized URLs', () => {
    expect(assetUrlProblem('')).toMatch(/non-empty/);
    expect(assetUrlProblem('   ')).toMatch(/non-empty/);
    expect(assetUrlProblem(42)).toMatch(/non-empty/);
    expect(assetUrlProblem(`data:image/png;base64,${'A'.repeat(MAX_URL_LENGTH)}`)).toMatch(/at most/);
  });
});

describe('paramValueProblem', () => {
  const num: IsoPartParamSpec = { type: 'number', label: 'n', default: 0, min: 0, max: 10 };
  it('numbers: finite and within min/max', () => {
    expect(paramValueProblem(num, 0)).toBeNull();
    expect(paramValueProblem(num, 10)).toBeNull();
    expect(paramValueProblem(num, 10.0001)).toMatch(/<= 10/);
    expect(paramValueProblem(num, -1)).toMatch(/>= 0/);
    for (const bad of [Infinity, -Infinity, NaN, '3', true]) expect(paramValueProblem(num, bad)).toMatch(/finite number/);
    expect(paramValueProblem({ type: 'number', label: 'u', default: 0 }, 1e300)).toBeNull();
  });
  it('null and undefined always pass ("no value")', () => {
    for (const spec of [num, { type: 'boolean', label: 'b', default: false } as IsoPartParamSpec]) {
      expect(paramValueProblem(spec, null)).toBeNull();
      expect(paramValueProblem(spec, undefined)).toBeNull();
    }
  });
  it('booleans, enums and colours', () => {
    expect(paramValueProblem({ type: 'boolean', label: 'b', default: false }, 1)).toMatch(/boolean/);
    const e: IsoPartParamSpec = { type: 'enum', label: 'e', default: 'a', options: ['a', 'b'] };
    expect(paramValueProblem(e, 'b')).toBeNull();
    expect(paramValueProblem(e, 'c')).toMatch(/one of a, b/);
    const c: IsoPartParamSpec = { type: 'color', label: 'c', default: '' };
    expect(paramValueProblem(c, '')).toBeNull();
    expect(paramValueProblem(c, '#abc')).toBeNull();
    expect(paramValueProblem(c, 'red')).toMatch(/hex colour/);
  });
  it('strings: length cap, maxLength, url format, hidden object values', () => {
    const s: IsoPartParamSpec = { type: 'string', label: 's', default: '' };
    expect(paramValueProblem(s, 'x'.repeat(MAX_PARAM_STRING))).toBeNull();
    expect(paramValueProblem(s, 'x'.repeat(MAX_PARAM_STRING + 1))).toMatch(/at most/);
    expect(paramValueProblem({ ...s, maxLength: 3 }, 'abcd')).toMatch(/at most 3/);
    expect(paramValueProblem(s, 3)).toMatch(/string/);
    expect(paramValueProblem(s, { a: 1 })).toMatch(/string/);
    expect(paramValueProblem({ ...s, hidden: true }, { '0': 'Idle' })).toBeNull();
    expect(paramValueProblem({ ...s, hidden: true }, { a: Infinity })).toMatch(/finite/);
    const url: IsoPartParamSpec = { ...s, format: 'url' };
    expect(paramValueProblem(url, '')).toBeNull();
    expect(paramValueProblem(url, 'https://x/y.png')).toBeNull();
    expect(paramValueProblem(url, 'javascript:alert(1)')).toMatch(/scheme/);
    // url params may be long data: URLs (up to MAX_URL_LENGTH), beyond the normal string cap.
    expect(paramValueProblem(url, `data:image/png;base64,${'A'.repeat(MAX_PARAM_STRING * 2)}`)).toBeNull();
  });
});

describe('jsonValueProblem / paramsProblems', () => {
  it('accepts plain JSON data and rejects non-finite or exotic values at any depth', () => {
    expect(jsonValueProblem({ a: [1, 'x', null, true, { b: 2 }] }, 0)).toBeNull();
    expect(jsonValueProblem({ a: [1, { b: Infinity }] }, 0)).toMatch(/finite/);
    expect(jsonValueProblem(() => 1, 0)).toMatch(/JSON data/);
    let deep: unknown = 1;
    for (let i = 0; i < 12; i += 1) deep = [deep];
    expect(jsonValueProblem(deep, 0)).toMatch(/nested/);
  });
  it('checks declared params against specs and undeclared ones for finiteness, naming each problem', () => {
    const specs: Record<string, IsoPartParamSpec> = { level: { type: 'number', label: 'l', default: 0, min: 0, max: 1 } };
    expect(paramsProblems('t', specs, { level: 0.5, extra: 3 })).toEqual([]);
    expect(paramsProblems('t', specs, { level: 2, extra: NaN })).toEqual([
      'placement t: params.level must be <= 1, got 2',
      'placement t: params.extra must be finite, got NaN',
    ]);
  });
  it('does not treat Object.prototype keys as declared specs', () => {
    expect(paramsProblems('t', {}, { toString: 1 })).toEqual([]);
  });
});

describe('metaProblems', () => {
  it('accepts scalar rows and absent meta', () => {
    expect(metaProblems('a', undefined)).toEqual([]);
    expect(metaProblems('a', { region: 'eu-west-1', instances: 3, public: false })).toEqual([]);
  });
  it('rejects non-objects, bad values, long keys and too many rows', () => {
    expect(metaProblems('a', [])).toHaveLength(1);
    expect(metaProblems('a', 'x')).toHaveLength(1);
    expect(metaProblems('a', { n: Infinity })[0]).toMatch(/meta\.n/);
    expect(metaProblems('a', { n: { nested: 1 } })[0]).toMatch(/meta\.n/);
    expect(metaProblems('a', { n: 'x'.repeat(257) })[0]).toMatch(/256/);
    expect(metaProblems('a', { ['k'.repeat(65)]: 1 })[0]).toMatch(/1\.\.64/);
    expect(metaProblems('a', { '': 1 })[0]).toMatch(/1\.\.64/);
    const many = Object.fromEntries(Array.from({ length: MAX_META_ENTRIES + 1 }, (_, i) => [`k${i}`, i]));
    expect(metaProblems('a', many)[0]).toMatch(/33 entries/);
  });
});

describe('linkProblems', () => {
  it('accepts object anchors, port anchors, free points and waypoints', () => {
    expect(linkProblems('c', undefined)).toEqual([]);
    expect(linkProblems('c', { from: { object: 'tank-1', port: 'east' }, to: { x: 4, y: -2 }, via: [{ x: 1, y: 1 }] })).toEqual([]);
  });
  it.each([
    [{ from: 'tank' }, /link\.from must be/],
    [{ from: { object: '' } }, /placement id/],
    [{ from: { object: 'a', port: 3 } }, /port name/],
    [{ from: { object: 'a', x: 1 } }, /unknown field/],
    [{ to: { x: 1e400, y: 0 } }, /link\.to x and y/],
    [{ to: { x: 1, y: 20000 } }, /link\.to x and y/],
    [{ to: { x: 1, y: 2, z: 3 } }, /unknown field/],
    [{ via: 'x' }, /link\.via must be an array/],
    [{ via: Array.from({ length: MAX_LINK_VIA + 1 }, () => ({ x: 0, y: 0 })) }, /at most 64/],
    [{ via: [{ x: 0, y: NaN }] }, /link\.via\[0\]/],
    [{ via: [{ x: 0, y: 0, z: 1 }] }, /link\.via\[0\]/],
    [{ waypoints: [] }, /link\.waypoints is not a link field/],
    ['x', /link must be an object/],
  ])('rejects %j', (link, message) => {
    expect(linkProblems('c', link).join('; ')).toMatch(message);
  });
});

describe('appearanceProblems', () => {
  it('opacity is 0..1 and z an integer within +-1000', () => {
    expect(appearanceProblems('p', { opacity: 0, z: -1000 })).toEqual([]);
    expect(appearanceProblems('p', { opacity: 1, z: 1000 })).toEqual([]);
    for (const opacity of [-0.1, 1.1, NaN, Infinity, '0.5']) expect(appearanceProblems('p', { opacity })[0]).toMatch(/opacity/);
    for (const z of [1.5, 1001, -1001, Infinity, '1']) expect(appearanceProblems('p', { z })[0]).toMatch(/z must be an integer/);
  });
});
