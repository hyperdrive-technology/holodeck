import { describe, expect, it } from 'vitest';
import {
  EMBED_LIMITS,
  EMBED_PROTOCOL,
  isPlainObject,
  mergeObjectStates,
  parseEmbedMessage,
  withObjectState,
  withoutObjectState,
  type ObjectStates,
} from './protocol';

const msg = (fields: Record<string, unknown>) => ({ protocol: EMBED_PROTOCOL, ...fields });
const error = (data: unknown) => {
  const r = parseEmbedMessage(data);
  if (r.kind !== 'error') throw new Error(`expected an error, got ${JSON.stringify(r)}`);
  return r;
};

describe('parseEmbedMessage: not ours', () => {
  it.each([
    ['null', null],
    ['a string', 'setObjectState'],
    ['a number', 42],
    ['an array', [EMBED_PROTOCOL]],
    ['no protocol', { type: 'setObjectState', objectId: 'a', state: { x: 1 } }],
    ['another protocol', { protocol: 'holodeck.embed.v2', type: 'getInfo' }],
    ['a Map', new Map([['protocol', EMBED_PROTOCOL]])],
    ['a Date', new Date()],
    ['a class instance', new (class { protocol = EMBED_PROTOCOL; type = 'getInfo'; })()],
  ])('ignores %s', (_, data) => {
    expect(parseEmbedMessage(data)).toEqual({ kind: 'ignore' });
  });
});

describe('parseEmbedMessage: setObjectState', () => {
  it('accepts numbers, booleans, strings and null', () => {
    const r = parseEmbedMessage(msg({ type: 'setObjectState', requestId: 'r-1', objectId: 'tank-1', state: { level: 0.42, running: true, mode: 'CIP', alarm: null } }));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok' || r.message.type !== 'setObjectState') throw new Error('shape');
    expect(r.message).toMatchObject({ type: 'setObjectState', requestId: 'r-1', objectId: 'tank-1' });
    expect({ ...r.message.state }).toEqual({ level: 0.42, running: true, mode: 'CIP', alarm: null });
    // The kept state is a fresh null-prototype object, not the sender's.
    expect(Object.getPrototypeOf(r.message.state)).toBeNull();
  });

  it('accepts a null-prototype message', () => {
    const data = Object.assign(Object.create(null), msg({ type: 'getInfo' }));
    expect(parseEmbedMessage(data).kind).toBe('ok');
  });

  it.each([
    ['missing objectId', { type: 'setObjectState', state: { a: 1 } }, /objectId is required/],
    ['empty objectId', { type: 'setObjectState', objectId: '', state: { a: 1 } }, /objectId/],
    ['numeric objectId', { type: 'setObjectState', objectId: 7, state: { a: 1 } }, /objectId/],
    ['control chars in objectId', { type: 'setObjectState', objectId: 'a\u0000b', state: { a: 1 } }, /objectId/],
    ['too long objectId', { type: 'setObjectState', objectId: 'x'.repeat(EMBED_LIMITS.objectId + 1), state: { a: 1 } }, /objectId/],
    ['missing state', { type: 'setObjectState', objectId: 'a' }, /state/],
    ['array state', { type: 'setObjectState', objectId: 'a', state: [1] }, /state/],
    ['empty state', { type: 'setObjectState', objectId: 'a', state: {} }, /at least one/],
    ['NaN', { type: 'setObjectState', objectId: 'a', state: { v: Number.NaN } }, /finite number/],
    ['Infinity', { type: 'setObjectState', objectId: 'a', state: { v: Number.POSITIVE_INFINITY } }, /finite number/],
    ['nested object', { type: 'setObjectState', objectId: 'a', state: { v: { deep: 1 } } }, /state\.v/],
    ['array value', { type: 'setObjectState', objectId: 'a', state: { v: [1] } }, /state\.v/],
    ['undefined value', { type: 'setObjectState', objectId: 'a', state: { v: undefined } }, /state\.v/],
    ['long string', { type: 'setObjectState', objectId: 'a', state: { v: 'x'.repeat(EMBED_LIMITS.stringValue + 1) } }, /at most/],
    ['bad param name', { type: 'setObjectState', objectId: 'a', state: { 'a b': 1 } }, /not a valid param name/],
    ['param starting with a digit', { type: 'setObjectState', objectId: 'a', state: { '1a': 1 } }, /not a valid param name/],
    ['constructor param', { type: 'setObjectState', objectId: 'a', state: { constructor: 1 } }, /not a valid param name/],
    ['prototype param', { type: 'setObjectState', objectId: 'a', state: { prototype: 1 } }, /not a valid param name/],
    ['unknown field', { type: 'setObjectState', objectId: 'a', state: { v: 1 }, eval: 'x' }, /unexpected field/],
  ])('refuses %s', (_, fields, message) => {
    expect(error(msg(fields)).error).toMatch(message);
  });

  it('refuses a __proto__ param (as a JSON-parsed own key)', () => {
    const data = JSON.parse(`{"protocol":"${EMBED_PROTOCOL}","type":"setObjectState","objectId":"a","state":{"__proto__":{"polluted":1}}}`);
    expect(error(data).error).toMatch(/__proto__/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses more params than the limit', () => {
    const state = Object.fromEntries(Array.from({ length: EMBED_LIMITS.stateKeys + 1 }, (_, i) => [`p${i}`, i]));
    expect(error(msg({ type: 'setObjectState', objectId: 'a', state })).error).toMatch(/at most 64/);
    const ok = Object.fromEntries(Array.from({ length: EMBED_LIMITS.stateKeys }, (_, i) => [`p${i}`, i]));
    expect(parseEmbedMessage(msg({ type: 'setObjectState', objectId: 'a', state: ok })).kind).toBe('ok');
  });

  it('refuses class instances inside the message', () => {
    expect(error(msg({ type: 'setObjectState', objectId: 'a', state: new Map([['v', 1]]) })).error).toMatch(/state/);
  });
});

describe('parseEmbedMessage: request ids and types', () => {
  it('echoes a valid requestId on errors so the sender can match the reply', () => {
    expect(error(msg({ type: 'setObjectState', requestId: 'abc', objectId: 'a' }))).toMatchObject({ requestId: 'abc' });
    expect(error(msg({ type: 'nope', requestId: 'abc' }))).toMatchObject({ requestId: 'abc', error: expect.stringMatching(/unknown message type/) });
  });

  it.each([[''], ['has space'], ['x'.repeat(EMBED_LIMITS.requestId + 1)], [5], [null]])('refuses requestId %j without echoing it', (requestId) => {
    const r = error(msg({ type: 'getInfo', requestId }));
    expect(r.error).toMatch(/requestId/);
    expect(r.requestId).toBeUndefined();
  });

  it.each([['toString'], ['__proto__'], ['hasOwnProperty'], [42]])('refuses type %j', (type) => {
    expect(error(msg({ type })).error).toMatch(/unknown message type/);
  });

  it('parses clearObjectState with and without an objectId', () => {
    expect(parseEmbedMessage(msg({ type: 'clearObjectState' }))).toEqual({ kind: 'ok', message: { type: 'clearObjectState' } });
    expect(parseEmbedMessage(msg({ type: 'clearObjectState', objectId: 'v1', requestId: 'q' }))).toEqual({
      kind: 'ok',
      message: { type: 'clearObjectState', objectId: 'v1', requestId: 'q' },
    });
    expect(error(msg({ type: 'clearObjectState', objectId: 3 })).error).toMatch(/objectId/);
  });

  it('parses loadDocument with an object document only', () => {
    expect(parseEmbedMessage(msg({ type: 'loadDocument', document: { format: 'x' } })).kind).toBe('ok');
    expect(error(msg({ type: 'loadDocument', document: '{"format":1}' })).error).toMatch(/document/);
    expect(error(msg({ type: 'loadDocument' })).error).toMatch(/document/);
  });

  it('parses getInfo and refuses extra fields on it', () => {
    expect(parseEmbedMessage(msg({ type: 'getInfo', requestId: 'i' }))).toEqual({ kind: 'ok', message: { type: 'getInfo', requestId: 'i' } });
    expect(error(msg({ type: 'getInfo', objectId: 'a' })).error).toMatch(/unexpected field/);
  });
});

describe('isPlainObject', () => {
  it('accepts literals and null-prototype objects only', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Uint8Array(1))).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });
});

describe('object states', () => {
  const empty: ObjectStates = Object.create(null);

  it('merges params per object without touching the input', () => {
    const a = withObjectState(empty, 'tank-1', { level: 0.1 });
    const b = withObjectState(a, 'tank-1', { running: true });
    const c = withObjectState(b, 'tank-1', { level: 0.9 });
    expect({ ...a['tank-1'] }).toEqual({ level: 0.1 });
    expect({ ...c['tank-1'] }).toEqual({ level: 0.9, running: true });
  });

  it('clears one object or all', () => {
    const s = withObjectState(withObjectState(empty, 'a', { x: 1 }), 'b', { y: 2 });
    expect(Object.keys(withoutObjectState(s, 'a'))).toEqual(['b']);
    expect(Object.keys(withoutObjectState(s))).toEqual([]);
    expect(Object.keys(s)).toEqual(['a', 'b']);
  });

  it('overlays states on provider metrics per param', () => {
    const base = { 'tank-1': { level: 0.5, temp: 20 }, 'valve-1': { open: false } };
    const merged = mergeObjectStates(base, withObjectState(empty, 'tank-1', { level: 0.75 }));
    expect({ ...merged['tank-1'] }).toEqual({ level: 0.75, temp: 20 });
    expect(merged['valve-1']).toEqual({ open: false });
    expect(base['tank-1'].level).toBe(0.5);
  });

  it('returns the provider metrics themselves when there are no states (stable identity)', () => {
    const base = { a: { x: 1 } };
    expect(mergeObjectStates(base, empty)).toBe(base);
  });

  it('cannot be tricked into prototype pollution by an object id', () => {
    const s = withObjectState(empty, '__proto__', { polluted: 1 });
    const merged = mergeObjectStates({}, s);
    expect(Object.keys(merged)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
