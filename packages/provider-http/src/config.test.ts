import { describe, expect, it } from 'vitest';
import { HTTP_CONFIG_SCHEMA, HTTP_DEFAULTS, HttpConfigError, isSignalValue, parseHttpConfig, toEpochMs } from './config';

const errorsOf = (raw: unknown): string[] => {
  try {
    parseHttpConfig(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpConfigError);
    return (error as HttpConfigError).details;
  }
  return [];
};

describe('parseHttpConfig', () => {
  it('fills defaults', () => {
    const c = parseHttpConfig({ url: 'https://api.example.com/status' });
    expect(c).toMatchObject({
      url: 'https://api.example.com/status',
      mode: 'poll',
      intervalMs: HTTP_DEFAULTS.intervalMs,
      timeoutMs: HTTP_DEFAULTS.timeoutMs,
      backoff: HTTP_DEFAULTS.backoff,
      headers: {},
      method: 'GET',
      maxBytes: HTTP_DEFAULTS.maxBytes,
      followRedirects: false,
    });
    expect(c.write).toBeUndefined();
    expect(c.auth).toBeUndefined();
  });

  it('accepts a full config per mode', () => {
    expect(
      parseHttpConfig({
        url: 'https://api.example.com/x?y=1',
        mode: 'poll',
        intervalMs: 50,
        timeoutMs: 500,
        backoff: { initialMs: 10, maxMs: 100, factor: 1.5, jitter: 0 },
        headers: { 'X-Site': 'north' },
        auth: { scheme: 'bearer' },
        method: 'POST',
        body: { query: ['a', 1, true, null] },
        timestamp: '$.ts',
        write: { method: 'PUT', url: '/tags/{selector}', body: 'value' },
        maxBytes: 1024,
        followRedirects: true,
      }),
    ).toMatchObject({ method: 'POST', write: { method: 'PUT', url: '/tags/{selector}', body: 'value' } });
    expect(parseHttpConfig({ url: 'http://h/events', mode: 'sse', events: ['update'] }).events).toEqual(['update']);
    expect(
      parseHttpConfig({ url: 'wss://h/feed', mode: 'websocket', subscribe: { op: 'sub' }, protocols: ['json'], auth: { scheme: 'query', name: 'key' } }),
    ).toMatchObject({ subscribe: { op: 'sub' }, protocols: ['json'] });
    expect(parseHttpConfig({ url: 'http://h', write: {} }).write).toEqual({ method: 'POST', body: 'envelope' });
  });

  it('lists every problem at once', () => {
    const errors = errorsOf({
      url: 'ftp://x',
      mode: 'poll',
      intervalMs: 10,
      timeoutMs: 0,
      maxBytes: -1,
      typo: 1,
      backoff: { initialMs: 0, factor: 0.5, jitter: 2, extra: 1 },
      method: 'DELETE',
      followRedirects: 'yes',
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        'typo: unknown setting',
        'url: scheme must be one of http:, https:',
        expect.stringMatching(/^intervalMs:/),
        expect.stringMatching(/^timeoutMs:/),
        expect.stringMatching(/^maxBytes:/),
        'backoff.extra: unknown setting',
        expect.stringMatching(/^backoff.initialMs:/),
        expect.stringMatching(/^backoff.factor:/),
        expect.stringMatching(/^backoff.jitter:/),
        'method: must be GET or POST',
        'followRedirects: must be a boolean',
      ]),
    );
  });

  it.each([
    [undefined, 'config: must be an object'],
    [[], 'config: must be an object'],
    [{}, /^url:/],
    [{ url: ' https://x' }, /whitespace/],
    [{ url: 'not a url' }, /not a valid URL/],
    [{ url: 'https://user:pw@x' }, /credentials/],
    [{ url: 'https://x/#frag' }, /fragment/],
    [{ url: 'ws://x', mode: 'poll' }, /scheme/],
    [{ url: 'https://x', mode: 'websocket' }, /scheme must be one of ws:, wss:/],
    [{ url: 'https://x', mode: 'mqtt' }, /^mode:/],
    [{ url: 'https://x', backoff: { initialMs: 100, maxMs: 10 } }, /maxMs: must be ≥/],
    [{ url: 'https://x', backoff: 5 }, /backoff: must be an object/],
    [{ url: 'https://x', headers: { Authorization: 'Bearer x' } }, /credentials must not be stored/],
    [{ url: 'https://x', headers: { cookie: 'a=b' } }, /credentials must not be stored/],
    [{ url: 'https://x', headers: { 'Proxy-Authorization': 'x' } }, /credentials must not be stored/],
    [{ url: 'https://x', headers: { 'bad name': 'x' } }, /not a valid header name/],
    [{ url: 'https://x', headers: { 'X-A': 'a\r\nInjected: 1' } }, /single-line/],
    [{ url: 'https://x', headers: { 'X-A': 1 } }, /single-line/],
    [{ url: 'https://x', headers: [] }, /headers: must be an object/],
    [{ url: 'https://x', auth: { scheme: 'oauth' } }, /auth.scheme/],
    [{ url: 'https://x', auth: { scheme: 'bearer', token: 'leak' } }, /auth.token: unknown setting/],
    [{ url: 'https://x', auth: { scheme: 'header' } }, /auth.name/],
    [{ url: 'https://x', auth: { scheme: 'query', name: 'a b' } }, /auth.name/],
    [{ url: 'https://x', auth: { scheme: 'basic', username: 'a:b' } }, /auth.username/],
    [{ url: 'https://x', auth: { scheme: 'basic', username: 'u', password: 'p' } }, /auth.password: unknown setting/],
    [{ url: 'https://x', auth: 'bearer' }, /auth: must be an object/],
    [{ url: 'wss://x', mode: 'websocket', auth: { scheme: 'bearer' } }, /only the query scheme/],
    [{ url: 'https://x', body: {} }, /only allowed with method POST/],
    [{ url: 'https://x', method: 'POST', body: () => 1 }, /JSON value/],
    [{ url: 'https://x', method: 'POST', body: { n: NaN } }, /JSON value/],
    [{ url: 'https://x', method: 'POST', body: new Date() }, /JSON value/],
    [{ url: 'https://x', mode: 'sse', method: 'GET' }, /only apply to mode poll/],
    [{ url: 'https://x', mode: 'sse', intervalMs: 100 }, /only applies to mode poll/],
    [{ url: 'https://x', timestamp: 'ts' }, /timestamp:/],
    [{ url: 'https://x', timestamp: 5 }, /timestamp:/],
    [{ url: 'https://x', events: ['a'] }, /only applies to mode sse/],
    [{ url: 'https://x', mode: 'sse', events: [''] }, /event names/],
    [{ url: 'https://x', subscribe: {} }, /only applies to mode websocket/],
    [{ url: 'wss://x', mode: 'websocket', subscribe: undefined, protocols: ['a b'] }, /subprotocol/],
    [{ url: 'https://x', protocols: ['a'] }, /only applies to mode websocket/],
    [{ url: 'https://x', write: 'yes' }, /write: must be an object/],
    [{ url: 'https://x', write: { method: 'DELETE' } }, /write.method/],
    [{ url: 'https://x', write: { body: 'form' } }, /write.body/],
    [{ url: 'https://x', write: { url: '' } }, /write.url/],
    [{ url: 'https://x', write: { url: '/a b' } }, /write.url/],
    [{ url: 'https://x', write: { verb: 'POST' } }, /write.verb: unknown setting/],
  ])('rejects %j', (raw, message) => {
    const errors = errorsOf(raw);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => (typeof message === 'string' ? e === message : message.test(e)))).toBe(true);
  });

  it('normalises the URL', () => {
    expect(parseHttpConfig({ url: 'HTTPS://API.Example.com:443/a/../b' }).url).toBe('https://api.example.com/b');
  });

  it('error message lists the details', () => {
    expect(() => parseHttpConfig({ url: 'ftp://x', typo: 1 })).toThrow(/typo: unknown setting/);
  });
});

describe('HTTP_CONFIG_SCHEMA', () => {
  it('covers every setting and holds no secrets', () => {
    const props = (HTTP_CONFIG_SCHEMA.properties ?? {}) as Record<string, unknown>;
    for (const key of ['url', 'mode', 'intervalMs', 'timeoutMs', 'backoff', 'headers', 'auth', 'method', 'body', 'timestamp', 'events', 'subscribe', 'protocols', 'write', 'maxBytes', 'followRedirects']) {
      expect(props).toHaveProperty(key);
    }
    expect(JSON.stringify(HTTP_CONFIG_SCHEMA)).not.toMatch(/"(token|password|secret)"\s*:/);
  });
});

describe('helpers', () => {
  it('toEpochMs', () => {
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs('2026-10-17T00:00:00Z')).toBe(Date.parse('2026-10-17T00:00:00Z'));
    expect(toEpochMs('nope')).toBeUndefined();
    expect(toEpochMs('')).toBeUndefined();
    expect(toEpochMs(null)).toBeUndefined();
    expect(toEpochMs(Infinity)).toBeUndefined();
  });

  it('isSignalValue', () => {
    for (const v of [0, -1.5, 'x', '', true, false, null]) expect(isSignalValue(v)).toBe(true);
    for (const v of [undefined, NaN, Infinity, {}, [], () => 1]) expect(isSignalValue(v)).toBe(false);
  });
});
