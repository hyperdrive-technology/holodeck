import { describe, expect, it } from 'vitest';
import { formatPointer, formatSource, lookup, MAX_SOURCE_LENGTH, parseSelector, parseSource, SourceSyntaxError } from './selector';

describe('parseSource', () => {
  it.each([
    ['', '', []],
    ['/temperature', '', ['temperature']],
    ['/pumps/0/rpm', '', ['pumps', '0', 'rpm']],
    ['/a~1b/m~0n/~01', '', ['a/b', 'm~n', '~1']],
    ['/', '', ['']],
    ['$', '', []],
    ['$.pumps[0].rpm', '', ['pumps', 0, 'rpm']],
    ['$.alarms[-1].text', '', ['alarms', -1, 'text']],
    ["$['a b'][\"c.d\"]", '', ['a b', 'c.d']],
    ["$['it\\'s']", '', ["it's"]],
    ["$['a#b']", '', ['a#b']],
    ['$.$ref._x-y', '', ['$ref', '_x-y']],
    ['/api/line2#/speed', '/api/line2', ['speed']],
    ['/api/line2?site=1#$.alarms[0]', '/api/line2?site=1', ['alarms', 0]],
    ['#/a#b', '', ['a#b']],
    ['/api#', '/api', []],
  ])('%j → endpoint %j tokens %j', (source, endpoint, tokens) => {
    expect(parseSource(source)).toEqual({ source, endpoint, tokens });
  });

  it.each([
    ['temperature', /JSON pointer/],
    ['$.', /member name/],
    ['$.0abc', /member name/],
    ['$[*]', /index or a quoted key/],
    ['$..a', /member name/],
    ['$[0', /expected "]"/],
    ["$['abc", /unterminated/],
    ["$['a\\nb']", /escaped quote/],
    ['$.a[?(@.x)]', /index or a quoted key/],
    ['$.a b', /unexpected " "/],
    ['/a~2', /bad escape/],
    ['api#/a', /absolute path/],
    ['//evil.example#/a', /absolute path/],
    ['/a b#/x', /absolute path/],
    ['/a\\b#/x', /absolute path/],
    ['/a#b', /JSON pointer/],
    ['$[1234567890]', /expected "]"/],
  ])('rejects %j', (source, message) => {
    expect(() => parseSource(source)).toThrow(SourceSyntaxError);
    expect(() => parseSource(source)).toThrow(message);
  });

  it('bounds source length', () => {
    expect(() => parseSource('/' + 'a'.repeat(MAX_SOURCE_LENGTH))).toThrow(/longer than/);
    expect(() => parseSource('/' + 'a'.repeat(MAX_SOURCE_LENGTH - 1))).not.toThrow();
  });

  it('rejects non-strings', () => {
    expect(() => parseSource(42 as unknown as string)).toThrow(SourceSyntaxError);
  });
});

describe('lookup', () => {
  const doc = { pumps: [{ rpm: 1500, on: true }, { rpm: 0, on: false }], 'a/b': { c: null }, nested: { arr: [[1, 2], [3]] } };

  it('walks objects and arrays', () => {
    expect(lookup(doc, parseSelector('/pumps/1/rpm'))).toEqual({ found: true, value: 0 });
    expect(lookup(doc, parseSelector('$.pumps[0].on'))).toEqual({ found: true, value: true });
    expect(lookup(doc, parseSelector('/a~1b/c'))).toEqual({ found: true, value: null });
    expect(lookup(doc, parseSelector('$.nested.arr[1][0]'))).toEqual({ found: true, value: 3 });
    expect(lookup(doc, [])).toEqual({ found: true, value: doc });
  });

  it('supports negative indexes from the end', () => {
    expect(lookup(doc, parseSelector('$.pumps[-1].rpm'))).toEqual({ found: true, value: 0 });
    expect(lookup(doc, parseSelector('$.pumps[-3]'))).toEqual({ found: false });
  });

  it('reports missing paths', () => {
    expect(lookup(doc, parseSelector('/pumps/2'))).toEqual({ found: false });
    expect(lookup(doc, parseSelector('/pumps/x'))).toEqual({ found: false });
    expect(lookup(doc, parseSelector('/pumps/01'))).toEqual({ found: false });
    expect(lookup(doc, parseSelector('/pumps/0/rpm/deeper'))).toEqual({ found: false });
    expect(lookup(null, parseSelector('/a'))).toEqual({ found: false });
    expect(lookup(doc, parseSelector('/missing'))).toEqual({ found: false });
  });

  it('never walks the prototype chain', () => {
    expect(lookup({}, parseSelector('/__proto__'))).toEqual({ found: false });
    expect(lookup({}, parseSelector('/constructor/name'))).toEqual({ found: false });
    expect(lookup({}, parseSelector('$.toString'))).toEqual({ found: false });
    expect(lookup([], parseSelector('/length'))).toEqual({ found: false });
    // JSON.parse creates an own "__proto__" property, which is fine to read.
    expect(lookup(JSON.parse('{"__proto__":{"x":1}}'), parseSelector('/__proto__/x'))).toEqual({ found: true, value: 1 });
  });
});

describe('formatSource', () => {
  it('round-trips through parseSource', () => {
    for (const [endpoint, tokens] of [
      ['', ['a', 'b']],
      ['', ['a/b', 'm~n']],
      ['', ['x#y']],
      ['/api/x', ['speed']],
      ['/api/x', []],
      ['', []],
    ] as const) {
      const source = formatSource(endpoint, tokens);
      expect(parseSource(source)).toEqual({ source, endpoint, tokens: [...tokens] });
    }
  });

  it('writes numbers as pointer segments', () => {
    expect(formatPointer(['pumps', 0, 'rpm'])).toBe('/pumps/0/rpm');
    expect(formatSource('', ['x#y'])).toBe('#/x#y');
  });
});
