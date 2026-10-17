import { runProviderConformance, type Sample } from '@holodeck/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpProvider, HTTP_PROVIDER_ID } from './provider';
import { collector, connect, type Harness } from './test-support/harness';
import { sleep, startTestServer, waitFor, type TestServer } from './test-support/server';

let server: TestServer;
let harnesses: Harness[] = [];
const fast = { initialMs: 20, maxMs: 80, factor: 2, jitter: 0 };

beforeEach(async () => {
  server = await startTestServer();
  harnesses = [];
});
afterEach(async () => {
  for (const h of harnesses) await h.session.close();
  await server.close();
});

async function open(config: Record<string, unknown>, extra?: Parameters<typeof connect>[1]) {
  const h = await connect({ intervalMs: 50, timeoutMs: 1000, backoff: fast, ...config }, extra);
  harnesses.push(h);
  return h;
}

describe('holodeck.http poll: conformance', () => {
  it('passes runProviderConformance against a local server', async () => {
    let n = 0;
    server.json('/status', () => ({ temp: 20 + n++, pumps: [{ rpm: 1500, on: true }], label: 'ok' }));
    const failures: string[] = [];
    await runProviderConformance(
      () => createHttpProvider(),
      {
        config: { url: `${server.url}/status`, intervalMs: 50, timeoutMs: 1000 },
        sources: ['/temp', '$.pumps[0].rpm', '/pumps/0/on', '/label'],
        flush: () => sleep(10),
      },
      (ok, message) => {
        if (!ok) failures.push(message);
      },
    );
    expect(failures).toEqual([]);
    // After close nothing polls any more.
    const count = server.requestsTo('/status').length;
    await sleep(200);
    expect(server.requestsTo('/status').length).toBe(count);
  });

  it('declares its id, capabilities, schema and secrets', () => {
    const p = createHttpProvider();
    expect(p.id).toBe(HTTP_PROVIDER_ID);
    expect(p.capabilities).toEqual({ read: true, write: true, browse: true });
    expect(p.secrets?.map((s) => s.key)).toEqual(['token', 'password']);
    expect(p.secrets?.every((s) => s.optional)).toBe(true);
    expect(p.origins).toBeUndefined();
    expect(p.configSchema).toMatchObject({ required: ['url'] });
  });
});

describe('holodeck.http poll: subscriptions', () => {
  it('maps values with pointers and JSONPath and reports bad quality for missing or structured values', async () => {
    server.json('/s', { a: { b: [10, 'x', true, null] }, obj: { k: 1 } });
    const h = await open({ url: `${server.url}/s` });
    const c = collector();
    h.session.subscribe(['/a/b/0', '$.a.b[1]', '$.a.b[-2]', '/a/b/3', '/missing', '/obj', 'no-slash'], c.onSamples);
    await waitFor(() => c.latest('/a/b/0') !== undefined);
    const get = (s: string) => c.latest(s) as Sample;
    expect(get('/a/b/0')).toMatchObject({ value: 10 });
    expect(get('/a/b/0').quality).toBeUndefined();
    expect(get('$.a.b[1]')).toMatchObject({ value: 'x' });
    expect(get('$.a.b[-2]')).toMatchObject({ value: true });
    expect(get('/a/b/3')).toMatchObject({ value: null });
    expect(get('/a/b/3').quality).toBeUndefined();
    expect(get('/missing')).toMatchObject({ value: null, quality: 'bad' });
    expect(get('/obj')).toMatchObject({ value: null, quality: 'bad' });
    expect(get('no-slash')).toMatchObject({ value: null, quality: 'bad' });
    expect(h.logs.some(([level, m]) => level === 'warn' && m.includes('"no-slash" ignored'))).toBe(true);
    expect(h.session.status().state).toBe('live');
  });

  it('polls on the interval, one request at a time, and delivers each response', async () => {
    let n = 0;
    server.json('/s', () => ({ n: n++ }));
    const h = await open({ url: `${server.url}/s` });
    const c = collector();
    h.session.subscribe(['/n'], c.onSamples);
    await waitFor(() => c.count() >= 4);
    const values = c.all().map((s) => s.value);
    expect(values.slice(0, 4)).toEqual([0, 1, 2, 3]);
    const at = server.requestsTo('/s').map((r) => r.at);
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(40);
  });

  it('starts the next poll only after the previous one finished (slow server)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    server.route('GET', '/slow', async (_req, res) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(120);
      inFlight--;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"v":1}');
    });
    const h = await open({ url: `${server.url}/slow` });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => c.count() >= 3, 3000);
    expect(maxInFlight).toBe(1);
  });

  it('shares one poller per endpoint and routes sources to their endpoint', async () => {
    server.json('/a', { v: 'A' });
    server.json('/b', { v: 'B' });
    const h = await open({ url: `${server.url}/a` });
    const c1 = collector();
    const c2 = collector();
    const stop1 = h.session.subscribe(['/v', '/b#/v'], c1.onSamples);
    const stop2 = h.session.subscribe(['/v'], c2.onSamples);
    await waitFor(() => c1.latest('/v') !== undefined && c1.latest('/b#/v') !== undefined && c2.latest('/v') !== undefined);
    expect(c1.latest('/v')?.value).toBe('A');
    expect(c1.latest('/b#/v')?.value).toBe('B');
    await sleep(160);
    // Two subscribers on /a still produce one request per interval, not two.
    const aRequests = server.requestsTo('/a').length;
    const bRequests = server.requestsTo('/b').length;
    expect(aRequests).toBeLessThanOrEqual(bRequests + 2);
    stop1();
    stop2();
  });

  it('delivers cached current values to a late subscriber immediately', async () => {
    server.json('/s', { v: 7 });
    const h = await open({ url: `${server.url}/s`, intervalMs: 5000 });
    const c1 = collector();
    h.session.subscribe(['/v'], c1.onSamples);
    await waitFor(() => c1.count() > 0);
    const c2 = collector();
    h.session.subscribe(['/v'], c2.onSamples);
    await sleep(0);
    expect(c2.latest('/v')?.value).toBe(7);
    expect(server.requestsTo('/s')).toHaveLength(1);
  });

  it('takes sample timestamps from the message when configured', async () => {
    server.json('/s', { ts: '2026-10-17T12:00:00Z', ms: 1234, v: 1 });
    const h = await open({ url: `${server.url}/s`, timestamp: '$.ts' });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => c.count() > 0);
    expect(c.latest('/v')?.ts).toBe(Date.parse('2026-10-17T12:00:00Z'));

    const h2 = await open({ url: `${server.url}/s`, timestamp: '/ms' });
    const c2 = collector();
    h2.session.subscribe(['/v'], c2.onSamples);
    await waitFor(() => c2.count() > 0);
    expect(c2.latest('/v')?.ts).toBe(1234);

    // An unusable timestamp falls back to receive time.
    const h3 = await open({ url: `${server.url}/s`, timestamp: '/v/nope' });
    const c3 = collector();
    const before = Date.now();
    h3.session.subscribe(['/v'], c3.onSamples);
    await waitFor(() => c3.count() > 0);
    expect(c3.latest('/v')!.ts).toBeGreaterThanOrEqual(before);
  });

  it('sends POST polls with a JSON body', async () => {
    server.route('POST', '/q', (_req, res, body) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ echo: JSON.parse(body).query }));
    });
    const h = await open({ url: `${server.url}/q`, method: 'POST', body: { query: 'temps' } });
    const c = collector();
    h.session.subscribe(['/echo'], c.onSamples);
    await waitFor(() => c.count() > 0);
    expect(c.latest('/echo')?.value).toBe('temps');
    expect(server.requestsTo('/q')[0]?.headers['content-type']).toBe('application/json');
  });

  it('sends configured non-secret headers and accept: application/json', async () => {
    server.json('/s', { v: 1 });
    const h = await open({ url: `${server.url}/s`, headers: { 'X-Site': 'north' } });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => c.count() > 0);
    const req = server.requestsTo('/s')[0]!;
    expect(req.headers['x-site']).toBe('north');
    expect(req.headers.accept).toBe('application/json');
    expect(req.headers.cookie).toBeUndefined();
  });

  it('a throwing subscriber is logged and does not stop other subscribers', async () => {
    server.json('/s', { v: 1 });
    const h = await open({ url: `${server.url}/s` });
    h.session.subscribe(['/v'], () => {
      throw new Error('boom');
    });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => c.count() >= 2);
    expect(h.logs.some(([level, m]) => level === 'error' && m.includes('subscriber threw: boom'))).toBe(true);
  });

  it('an endpoint can never leave the connection origin', async () => {
    server.json('/s', { v: 1 });
    const h = await open({ url: `${server.url}/s` });
    const c = collector();
    h.session.subscribe(['//evil.example/x#/v', '/s?x=//evil.example#/v'], c.onSamples);
    await waitFor(() => c.latest('/s?x=//evil.example#/v') !== undefined);
    // Protocol-relative "//host" is refused; "//host" inside a query is just a same-origin query.
    expect(c.latest('//evil.example/x#/v')).toMatchObject({ value: null, quality: 'bad' });
    expect(c.latest('/s?x=//evil.example#/v')?.value).toBe(1);
    expect(server.requests.every((r) => r.path.startsWith('/s'))).toBe(true);
  });
});

describe('holodeck.http poll: leaks', () => {
  it('unsubscribe stops polling that endpoint', async () => {
    server.json('/s', { v: 1 });
    const h = await open({ url: `${server.url}/s` });
    const c = collector();
    const stop = h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => server.requestsTo('/s').length >= 2);
    stop();
    stop(); // idempotent
    const count = server.requestsTo('/s').length;
    const delivered = c.count();
    await sleep(250);
    expect(server.requestsTo('/s').length).toBeLessThanOrEqual(count + 1); // at most the in-flight one
    expect(c.count()).toBe(delivered);
    expect(h.session.status()).toMatchObject({ state: 'live', message: 'idle' });
  });

  it('unsubscribe aborts an in-flight request and drops its response', async () => {
    let aborted = false;
    server.route('GET', '/slow', (_req, res) => {
      res.on('close', () => {
        if (!res.writableEnded) aborted = true;
      });
      setTimeout(() => {
        if (!res.destroyed) res.writeHead(200, { 'content-type': 'application/json' }).end('{"v":1}');
      }, 300);
    });
    const h = await open({ url: `${server.url}/slow` });
    const c = collector();
    const stop = h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => server.requestsTo('/slow').length === 1);
    stop();
    await waitFor(() => aborted, 2000, 'server to see the aborted request');
    await sleep(350);
    expect(c.count()).toBe(0);
    expect(server.requestsTo('/slow')).toHaveLength(1);
  });

  it('close() stops every channel, aborts requests and is idempotent', async () => {
    server.json('/a', { v: 1 });
    server.json('/b', { v: 2 });
    const h = await open({ url: `${server.url}/a` });
    const c = collector();
    h.session.subscribe(['/v', '/b#/v'], c.onSamples);
    await waitFor(() => server.requestsTo('/b').length >= 1 && server.requestsTo('/a').length >= 1);
    await h.session.close();
    await h.session.close();
    expect(h.session.status().state).toBe('disconnected');
    expect(h.statuses.filter((s) => s.state === 'disconnected')).toHaveLength(1);
    const total = server.requests.length;
    const delivered = c.count();
    await sleep(200);
    expect(server.requests.length).toBeLessThanOrEqual(total + 2);
    expect(c.count()).toBe(delivered);
    // A closed session refuses work.
    expect(h.session.subscribe(['/v'], c.onSamples)).toBeTypeOf('function');
    await expect(h.session.read!(['/v'])).rejects.toThrow(/closed session/);
    await expect(h.session.browse!()).rejects.toThrow(/closed session/);
    await expect(h.session.write!('/v', 1)).rejects.toThrow(/closed session/);
  });

  it('aborting the host signal closes the session', async () => {
    server.json('/s', { v: 1 });
    const h = await open({ url: `${server.url}/s` });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => server.requestsTo('/s').length >= 1);
    h.controller.abort();
    await waitFor(() => h.session.status().state === 'disconnected');
    const count = server.requestsTo('/s').length;
    await sleep(200);
    expect(server.requestsTo('/s').length).toBeLessThanOrEqual(count + 1);
  });

  it('a session connected with an already-aborted signal is closed', async () => {
    const controller = new AbortController();
    controller.abort();
    const session = await createHttpProvider().connect(
      { url: `${server.url}/s` },
      { ...(await import('@holodeck/sdk')).createProviderContext({ signal: controller.signal }) },
    );
    expect(session.status().state).toBe('disconnected');
  });
});

describe('holodeck.http poll: failures and reconnect', () => {
  it('server errors: error before first success, stale after, live again on recovery, with backoff', async () => {
    let mode: 'fail' | 'ok' = 'fail';
    server.route('GET', '/s', (_req, res) => {
      if (mode === 'fail') res.writeHead(503).end('down');
      else res.writeHead(200, { 'content-type': 'application/json' }).end('{"v":1}');
    });
    const h = await open({ url: `${server.url}/s`, intervalMs: 50, backoff: { initialMs: 60, maxMs: 240, factor: 2, jitter: 0 } });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => h.session.status().state === 'error');
    expect(h.session.status().message).toMatch(/HTTP 503; retrying in \d+ ms/);
    await waitFor(() => server.requestsTo('/s').length >= 4, 3000);
    const at = server.requestsTo('/s').map((r) => r.at);
    // Backoff grows: 60, 120, 240 (± scheduling noise).
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(100);
    expect(at[3]! - at[2]!).toBeGreaterThanOrEqual(200);

    mode = 'ok';
    await waitFor(() => h.session.status().state === 'live', 3000);
    expect(c.latest('/v')?.value).toBe(1);

    mode = 'fail';
    await waitFor(() => h.session.status().state === 'stale', 3000);
    expect(h.session.status().message).toMatch(/HTTP 503/);
    // Values are held while stale, not replaced by bad samples.
    expect(c.latest('/v')?.value).toBe(1);
    expect(c.all().every((s) => s.quality === undefined)).toBe(true);
  });

  it('malformed JSON is a failed poll; the next good payload recovers', async () => {
    let body = '{"v": 1';
    server.route('GET', '/s', (_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(body));
    const h = await open({ url: `${server.url}/s` });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => h.session.status().state === 'error');
    expect(h.session.status().message).toMatch(/not valid JSON/);
    expect(h.exposed()).not.toContain('{"v": 1');
    expect(c.count()).toBe(0);
    body = '{"v": 2}';
    await waitFor(() => c.latest('/v')?.value === 2, 3000);
    expect(h.session.status().state).toBe('live');
  });

  it('times out slow responses', async () => {
    server.route('GET', '/hang', () => {
      /* never respond */
    });
    const h = await open({ url: `${server.url}/hang`, timeoutMs: 80 });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toMatch(/timed out after 80 ms/);
  });

  it('times out a body that stalls after the headers', async () => {
    server.route('GET', '/stall', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"v":');
    });
    const h = await open({ url: `${server.url}/stall`, timeoutMs: 100 });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toMatch(/aborted|timed out/);
  });

  it('refuses responses larger than maxBytes (declared and streamed)', async () => {
    server.json('/big', { s: 'x'.repeat(5000) });
    server.route('GET', '/chunked', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"s":"');
      res.write('y'.repeat(3000));
      res.end('"}');
    });
    const h = await open({ url: `${server.url}/big`, maxBytes: 1000 });
    h.session.subscribe(['/s', '/chunked#/s'], () => {});
    await waitFor(() => (h.session.status().message ?? '').includes('larger than 1000 bytes'), 3000);
    await waitFor(() => h.logs.filter(([, m]) => m.includes('/chunked') && m.includes('larger than 1000 bytes')).length > 0, 3000);
  });

  it('connection refused is an error with a useful message', async () => {
    const port = Number(new URL(server.url).port);
    await server.close();
    server = await startTestServer(); // keep afterEach happy; nothing listens on `port` now
    const h = await open({ url: `http://127.0.0.1:${port}/s` });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toMatch(/127\.0\.0\.1/);
  });

  it('redirects are errors unless followRedirects is set', async () => {
    server.route('GET', '/old', (_req, res) => res.writeHead(302, { location: '/new' }).end());
    server.json('/new', { v: 'moved' });
    const h = await open({ url: `${server.url}/old` });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(server.requestsTo('/new')).toHaveLength(0);

    const h2 = await open({ url: `${server.url}/old`, followRedirects: true });
    const c = collector();
    h2.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => c.latest('/v')?.value === 'moved', 3000);
  });

  it('aggregates status over endpoints (worst wins) and names the failing one', async () => {
    server.json('/good', { v: 1 });
    server.route('GET', '/bad', (_req, res) => res.writeHead(500).end());
    const h = await open({ url: `${server.url}/good` });
    const stopBad = h.session.subscribe(['/bad#/v'], () => {});
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toContain('/bad: ');
    stopBad();
    await waitFor(() => h.session.status().state === 'live', 3000);
  });
});

describe('holodeck.http poll: read, browse, write', () => {
  it('read fetches each endpoint once and keeps request order', async () => {
    server.json('/a', { x: 1, y: 'two' });
    server.json('/b', { z: false });
    const h = await open({ url: `${server.url}/a` });
    const samples = await h.session.read!(['/y', '/b#/z', '/x', '/nope', 'bad source']);
    expect(samples.map((s) => [s.source, s.value, s.quality])).toEqual([
      ['/y', 'two', undefined],
      ['/b#/z', false, undefined],
      ['/x', 1, undefined],
      ['/nope', null, 'bad'],
      ['bad source', null, 'bad'],
    ]);
    expect(server.requestsTo('/a')).toHaveLength(1);
    expect(server.requestsTo('/b')).toHaveLength(1);
  });

  it('read reports bad samples when the endpoint fails', async () => {
    server.route('GET', '/a', (_req, res) => res.writeHead(500).end());
    const h = await open({ url: `${server.url}/a` });
    expect(await h.session.read!(['/x'])).toMatchObject([{ source: '/x', value: null, quality: 'bad' }]);
    expect(h.logs.some(([, m]) => m.includes('HTTP 500'))).toBe(true);
  });

  it('browse lists children as a picker tree', async () => {
    server.json('/s', { pumps: [{ rpm: 1, name: 'P1', on: true, note: null }], 'a/b': 2, site: { id: 'north' } });
    server.json('/other', { k: 'v' });
    const h = await open({ url: `${server.url}/s`, write: {} });
    expect(await h.session.browse!()).toEqual([
      { path: '/pumps', label: 'pumps', hasChildren: true },
      { path: '/a~1b', label: 'a/b', source: '/a~1b', type: 'number', writable: true },
      { path: '/site', label: 'site', hasChildren: true },
    ]);
    expect(await h.session.browse!('/pumps')).toEqual([{ path: '/pumps/0', label: '0', hasChildren: true }]);
    expect(await h.session.browse!('/pumps/0')).toEqual([
      { path: '/pumps/0/rpm', label: 'rpm', source: '/pumps/0/rpm', type: 'number', writable: true },
      { path: '/pumps/0/name', label: 'name', source: '/pumps/0/name', type: 'string', writable: true },
      { path: '/pumps/0/on', label: 'on', source: '/pumps/0/on', type: 'boolean', writable: true },
      { path: '/pumps/0/note', label: 'note', source: '/pumps/0/note', writable: true },
    ]);
    expect(await h.session.browse!('/pumps/0/rpm')).toEqual([]);
    expect(await h.session.browse!('/missing')).toEqual([]);
    expect(await h.session.browse!('/other#')).toEqual([{ path: '/other#/k', label: 'k', source: '/other#/k', type: 'string', writable: true }]);
    // Browsed sources are valid subscription sources.
    expect((await h.session.read!(['/other#/k']))[0]?.value).toBe('v');
  });

  it('browse caps very wide nodes', async () => {
    server.json('/s', Object.fromEntries(Array.from({ length: 800 }, (_, i) => [`k${i}`, i])));
    const h = await open({ url: `${server.url}/s` });
    expect(await h.session.browse!()).toHaveLength(500);
  });

  it('write POSTs an envelope by default', async () => {
    server.json('/s', {});
    server.route('POST', '/s', (_req, res) => res.writeHead(204).end());
    const h = await open({ url: `${server.url}/s`, write: {} });
    await h.session.write!('/pumps/0/speed', 42);
    const req = server.requestsTo('/s').find((r) => r.method === 'POST')!;
    expect(JSON.parse(req.body)).toEqual({ source: '/pumps/0/speed', value: 42 });
    expect(req.headers['content-type']).toBe('application/json');
  });

  it('write supports method, URL templates and bare-value bodies', async () => {
    server.route('PUT', '/tags/%2Fpumps%2F0%2Fspeed', (_req, res) => res.writeHead(200).end('{"ok":true}'));
    server.route('PATCH', '/x/line2', (_req, res) => res.writeHead(200).end());
    const h = await open({ url: `${server.url}/s`, write: { method: 'PUT', url: '/tags/{selector}', body: 'value' } });
    await h.session.write!('/pumps/0/speed', 'fast');
    const put = server.requests.find((r) => r.method === 'PUT')!;
    expect(put.body).toBe('"fast"');
    const h2 = await open({ url: `${server.url}/s`, write: { method: 'PATCH', url: `${server.url}/x/line2` } });
    await h2.session.write!('$.a', null);
    expect(JSON.parse(server.requests.find((r) => r.method === 'PATCH')!.body)).toEqual({ source: '$.a', value: null });
  });

  it('write failures and misuse throw', async () => {
    server.route('POST', '/s', (_req, res) => res.writeHead(403).end('{"secret":"echo"}'));
    const h = await open({ url: `${server.url}/s`, write: {} });
    await expect(h.session.write!('/v', 1)).rejects.toThrow(/HTTP 403/);
    await expect(h.session.write!('/v', { a: 1 } as never)).rejects.toThrow(TypeError);
    await expect(h.session.write!('nope', 1)).rejects.toThrow(/JSON pointer/);
    const h2 = await open({ url: `${server.url}/s`, write: { url: 'https://elsewhere.example/w' } });
    await expect(h2.session.write!('/v', 1)).rejects.toThrow(/leaves the connection origin/);
    const h3 = await open({ url: `${server.url}/s` });
    await expect(h3.session.write!('/v', 1)).rejects.toThrow(/no write settings/);
  });

  it('write times out', async () => {
    server.route('POST', '/s', () => {
      /* hang */
    });
    const h = await open({ url: `${server.url}/s`, write: {}, timeoutMs: 80 });
    await expect(h.session.write!('/v', 1)).rejects.toThrow(/timed out after 80 ms/);
  });
});

describe('holodeck.http: auth and secrets', () => {
  const SECRET = 'tok-SECRET-1234/+=';

  it.each([
    [{ scheme: 'bearer' }, { token: SECRET }, (h: Record<string, unknown>) => h.authorization === `Bearer ${SECRET}`],
    [{ scheme: 'header', name: 'X-API-Key' }, { token: SECRET }, (h: Record<string, unknown>) => h['x-api-key'] === SECRET],
    [
      { scheme: 'basic', username: 'ops' },
      { password: SECRET },
      (h: Record<string, unknown>) => h.authorization === `Basic ${Buffer.from(`ops:${SECRET}`).toString('base64')}`,
    ],
  ])('auth %j reaches the server', async (auth, secrets, check) => {
    server.json('/s', { v: 1 });
    const h = await open({ url: `${server.url}/s`, auth }, { secrets });
    await h.session.read!(['/v']);
    expect(check(server.requestsTo('/s')[0]!.headers)).toBe(true);
  });

  it('query auth adds the parameter to every request', async () => {
    server.json('/s', { v: 1 });
    const h = await open({ url: `${server.url}/s?site=1`, auth: { scheme: 'query', name: 'api_key' } }, { secrets: { token: SECRET } });
    await h.session.read!(['/v']);
    const url = new URL(server.requestsTo('/s')[0]!.path, server.url);
    expect(url.searchParams.get('api_key')).toBe(SECRET);
    expect(url.searchParams.get('site')).toBe('1');
  });

  it('a missing secret fails connect without revealing anything', async () => {
    await expect(connect({ url: `${server.url}/s`, auth: { scheme: 'bearer' } })).rejects.toThrow(/needs the secret "token"/);
    await expect(connect({ url: `${server.url}/s`, auth: { scheme: 'basic', username: 'u' } })).rejects.toThrow(/needs the secret "password"/);
    await expect(
      connect({ url: `${server.url}/s`, auth: { scheme: 'bearer' } }, { secrets: { token: 'a\r\nInjected: 1' } }),
    ).rejects.toThrow(/single line/);
  });

  it('secrets never appear in logs, status messages or thrown errors', async () => {
    // A server that fails in every way while echoing the secret back.
    server.route('GET', '/s', (req, res) => res.writeHead(500, { 'x-echo': String(req.headers['x-api-key']) }).end(`bad key ${req.headers['x-api-key']}`));
    server.route('POST', '/s', (req, res) => res.writeHead(401).end(String(req.headers['x-api-key'])));
    server.route('GET', '/garbage', (req, res) => res.writeHead(200).end(`{not json ${req.url}`));
    const thrown: string[] = [];
    const h = await open({ url: `${server.url}/s`, auth: { scheme: 'header', name: 'X-API-Key' }, write: {} }, { secrets: { token: SECRET } });
    h.session.subscribe(['/v', '/garbage#/v', '/garbage?x=1#/v'], () => {});
    await waitFor(() => server.requestsTo('/garbage').length >= 2 && server.requestsTo('/s').length >= 2, 3000);
    await h.session.write!('/v', 1).catch((e: Error) => thrown.push(e.message));
    await h.session.read!(['/v']).catch((e: Error) => thrown.push(e.message));

    const hq = await open({ url: `${server.url}/garbage`, auth: { scheme: 'query', name: 'k' } }, { secrets: { token: SECRET } });
    hq.session.subscribe(['/v'], () => {});
    await waitFor(() => hq.session.status().state === 'error', 3000);

    const everything = [h.exposed(), hq.exposed(), ...thrown].join('\n');
    expect(thrown.length).toBeGreaterThan(0);
    expect(everything.length).toBeGreaterThan(0);
    for (const form of [SECRET, encodeURIComponent(SECRET), new URLSearchParams({ s: SECRET }).toString().slice(2)]) {
      expect(everything).not.toContain(form);
    }
    // URLs are logged without their query string.
    expect(everything).not.toMatch(/\?k=/);
  });
});

describe('holodeck.http: origin allowlist', () => {
  it('refuses connections outside the allowed origins', async () => {
    const provider = createHttpProvider({ origins: ['https://*.example.com', 'http://127.0.0.1:1'] });
    expect(provider.origins).toEqual(['https://*.example.com', 'http://127.0.0.1:1']);
    const { createProviderContext } = await import('@holodeck/sdk');
    await expect(provider.connect({ url: `${server.url}/s` }, createProviderContext())).rejects.toThrow(/not in this provider's allowed origins/);
    const ok = await provider.connect({ url: 'https://api.example.com/s' }, createProviderContext());
    await ok.close();
    await expect(provider.connect({ url: 'https://api.example.com/s', followRedirects: true }, createProviderContext())).rejects.toThrow(
      /followRedirects/,
    );
    await expect(provider.connect({ url: 'https://a.b.example.com/s' }, createProviderContext())).rejects.toThrow(/allowed origins/);
  });

  it('checks the HTTP origin used for writes on websocket connections', async () => {
    const { createProviderContext } = await import('@holodeck/sdk');
    const wsOnly = createHttpProvider({ origins: ['wss://feed.example.com'] });
    await expect(
      wsOnly.connect({ url: 'wss://feed.example.com/x', mode: 'websocket', write: {} }, createProviderContext()),
    ).rejects.toThrow(/https:\/\/feed.example.com is not/);
    const s = await wsOnly.connect({ url: 'wss://feed.example.com/x', mode: 'websocket' }, createProviderContext());
    await s.close();
  });

  it('rejects invalid origin patterns up front', () => {
    expect(() => createHttpProvider({ origins: ['https://*.com'] })).toThrow(/invalid origin pattern/);
    expect(() => createHttpProvider({ origins: ['https://example.com/path'] })).toThrow(/invalid origin pattern/);
  });

  it('rejects bad config at connect with every problem listed', async () => {
    await expect(connect({ url: 'ftp://x', typo: true })).rejects.toThrow(/typo: unknown setting/);
  });
});
