import { runProviderConformance } from '@holodeck/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpProvider } from './provider';
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
  const h = await connect({ mode: 'sse', timeoutMs: 1000, backoff: fast, ...config }, extra);
  harnesses.push(h);
  return h;
}

describe('holodeck.http sse', () => {
  it('passes runProviderConformance against a local event stream', async () => {
    const feed = server.sse('/events');
    feed.onConnect = (client) => client.send(JSON.stringify({ temp: 21, pumps: [{ rpm: 900 }] }));
    const timer = setInterval(() => feed.broadcast(JSON.stringify({ temp: 22 })), 30);
    const failures: string[] = [];
    try {
      await runProviderConformance(
        () => createHttpProvider(),
        { config: { url: `${server.url}/events`, mode: 'sse' }, sources: ['/temp', '$.pumps[0].rpm'], flush: () => sleep(10) },
        (ok, message) => {
          if (!ok) failures.push(message);
        },
      );
    } finally {
      clearInterval(timer);
    }
    expect(failures).toEqual([]);
    await feed.waitForClients(0);
  });

  it('delivers only the sources present in each (partial) message', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events` });
    const c = collector();
    h.session.subscribe(['/a', '/b'], c.onSamples);
    await feed.waitForClients(1);
    feed.broadcast(JSON.stringify({ a: 1 }));
    feed.broadcast(JSON.stringify({ b: 'two' }));
    feed.broadcast(JSON.stringify({ a: 3, b: 'four', extra: true }));
    await waitFor(() => c.count() >= 3);
    expect(c.batches.map((b) => b.map((s) => [s.source, s.value]))).toEqual([
      [['/a', 1]],
      [['/b', 'two']],
      [
        ['/a', 3],
        ['/b', 'four'],
      ],
    ]);
    expect(h.session.status().state).toBe('live');
    // read in streaming mode returns the latest values per source
    expect((await h.session.read!(['/a', '/b', '/never'])).map((s) => [s.value, s.quality])).toEqual([
      [3, undefined],
      ['four', undefined],
      [null, 'uncertain'],
    ]);
    // browse uses the last message
    expect((await h.session.browse!()).map((n) => n.label)).toEqual(['a', 'b', 'extra']);
  });

  it('handles multi-line data and filters event names', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events`, events: ['update'] });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await feed.waitForClients(1);
    feed.broadcast(JSON.stringify({ v: 'ignored' })); // event "message": filtered out
    feed.broadcast(JSON.stringify({ v: 'heartbeat' }, null, 0), { event: 'ping' });
    feed.broadcast('{\n"v":\n"multi"\n}', { event: 'update' });
    await waitFor(() => c.count() >= 1);
    await sleep(30);
    expect(c.all().map((s) => s.value)).toEqual(['multi']);
  });

  it('skips malformed and oversized events, logs them without their content, and keeps going', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events`, maxBytes: 200 });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await feed.waitForClients(1);
    feed.broadcast('{"v": PRIVATE-NOT-JSON');
    feed.broadcast(JSON.stringify({ v: 'x'.repeat(150), pad: 'y'.repeat(100) }));
    feed.broadcast(JSON.stringify({ v: 'good' }));
    await waitFor(() => c.count() >= 1);
    expect(c.all().map((s) => s.value)).toEqual(['good']);
    expect(h.logs.filter(([level]) => level === 'warn').map(([, m]) => m)).toEqual(
      expect.arrayContaining([expect.stringMatching(/not valid JSON/), expect.stringMatching(/larger than 200 bytes/)]),
    );
    expect(h.exposed()).not.toContain('PRIVATE');
    expect(h.session.status().state).toBe('live');
    expect(feed.connections).toBe(1);
  });

  it('reconnects with Last-Event-ID after the server drops the stream, honouring retry:', async () => {
    const feed = server.sse('/events');
    feed.preamble = 'retry: 30\n\n';
    const h = await open({ url: `${server.url}/events` });
    const c = collector();
    h.session.subscribe(['/n'], c.onSamples);
    await feed.waitForClients(1);
    feed.broadcast(JSON.stringify({ n: 1 }), { id: 'evt-1' });
    await waitFor(() => c.count() === 1);
    feed.dropAll();
    await waitFor(() => feed.connections === 2, 3000, 'reconnect');
    expect(feed.connectHeaders[0]?.['last-event-id']).toBeUndefined();
    expect(feed.connectHeaders[1]?.['last-event-id']).toBe('evt-1');
    expect(feed.connectHeaders[1]?.accept).toBe('text/event-stream');
    await feed.waitForClients(1);
    feed.broadcast(JSON.stringify({ n: 2 }));
    await waitFor(() => c.latest('/n')?.value === 2);
    expect(h.session.status().state).toBe('live');
    expect(h.statuses.some((s) => s.state === 'stale' && /event stream ended/.test(s.message ?? ''))).toBe(true);
  });

  describe('Last-Event-ID (WHATWG event-stream rules, holodeck#99)', () => {
    async function reconnectHeader(frames: string): Promise<string | undefined> {
      const feed = server.sse('/events');
      const h = await open({ url: `${server.url}/events` });
      const c = collector();
      h.session.subscribe(['/n'], c.onSamples);
      await feed.waitForClients(1);
      feed.clients[0]!.raw(frames);
      feed.broadcast('{"n":"sync"}'); // no id: must not reset the id
      await waitFor(() => c.latest('/n')?.value === 'sync');
      feed.dropAll();
      await waitFor(() => feed.connections === 2, 3000, 'reconnect');
      return feed.connectHeaders[1]?.['last-event-id'] as string | undefined;
    }

    it('an id-only frame (no data) updates the id', async () => {
      expect(await reconnectHeader('id: 41\ndata: {"n":1}\n\nid: 42\n\n')).toBe('42');
    });

    it('an empty id resets it: no header on reconnect', async () => {
      expect(await reconnectHeader('id: 41\ndata: {"n":1}\n\nid\n\n')).toBeUndefined();
      expect(await reconnectHeader('id: 41\ndata: {"n":1}\n\nid:\ndata: {"n":2}\n\n')).toBeUndefined();
    });

    it('an id persists across later events without one, and ids with NUL are ignored', async () => {
      expect(await reconnectHeader('id: 7\ndata: {"n":1}\n\ndata: {"n":2}\n\n')).toBe('7');
      expect(await reconnectHeader('id: 7\ndata: {"n":1}\n\nid: bad\u0000id\n\n')).toBe('7');
    });

    it('handles CRLF and CR line endings split across chunks', async () => {
      expect(await reconnectHeader('id: 9\r\ndata: {"n":1}\r\n\r\nid: 10\r\r')).toBe('10');
    });
  });

  it('backs off while the server keeps failing and recovers', async () => {
    server.route('GET', '/events', (_req, res) => res.writeHead(503).end());
    const h = await open({ url: `${server.url}/events`, backoff: { initialMs: 40, maxMs: 160, factor: 2, jitter: 0 } });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => server.requestsTo('/events').length >= 4, 3000);
    const at = server.requestsTo('/events').map((r) => r.at);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(60);
    expect(at[3]! - at[2]!).toBeGreaterThanOrEqual(130);
    expect(h.session.status()).toMatchObject({ state: 'error' });
    expect(h.session.status().message).toMatch(/HTTP 503/);
    // The server comes back: the same path now serves an event stream.
    const feed = server.sse('/events');
    await feed.waitForClients(1, 3000);
    feed.broadcast('{"v":1}');
    await waitFor(() => c.count() === 1);
    expect(h.session.status().state).toBe('live');
  });

  it('rejects a response that is not an event stream', async () => {
    server.json('/events', { v: 1 });
    const h = await open({ url: `${server.url}/events` });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toMatch(/expected text\/event-stream, got "application\/json"/);
  });

  it('times out when the stream never answers, but not once it is open', async () => {
    server.route('GET', '/hang', () => {});
    const h = await open({ url: `${server.url}/hang`, timeoutMs: 80 });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toMatch(/timed out after 80 ms/);

    const feed = server.sse('/events');
    const h2 = await open({ url: `${server.url}/events`, timeoutMs: 80 });
    h2.session.subscribe(['/v'], () => {});
    await feed.waitForClients(1);
    await sleep(250); // three timeouts' worth of an idle but open stream
    expect(feed.connections).toBe(1);
    expect(h2.session.status().state).toBe('live');
  });

  it('unsubscribe and close disconnect the stream (no leaked connections)', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events` });
    const c = collector();
    const stop = h.session.subscribe(['/v'], c.onSamples);
    await feed.waitForClients(1);
    stop();
    await feed.waitForClients(0);
    feed.broadcast('{"v":1}');
    await sleep(100);
    expect(c.count()).toBe(0);
    expect(feed.connections).toBe(1);

    h.session.subscribe(['/v'], c.onSamples);
    await feed.waitForClients(1);
    await h.session.close();
    await feed.waitForClients(0);
    await sleep(150);
    expect(feed.connections).toBe(2);
  });

  it('two endpoints get two streams; both close with the session', async () => {
    const a = server.sse('/a');
    const b = server.sse('/b');
    const h = await open({ url: `${server.url}/a` });
    const c = collector();
    h.session.subscribe(['/v', '/b#/v'], c.onSamples);
    await a.waitForClients(1);
    await b.waitForClients(1);
    a.broadcast('{"v":"A"}');
    b.broadcast('{"v":"B"}');
    await waitFor(() => c.latest('/v')?.value === 'A' && c.latest('/b#/v')?.value === 'B');
    h.controller.abort();
    await a.waitForClients(0);
    await b.waitForClients(0);
  });

  it('sends auth on the stream request', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events`, auth: { scheme: 'bearer' } }, { secrets: { token: 'sse-token' } });
    h.session.subscribe(['/v'], () => {});
    await feed.waitForClients(1);
    expect(feed.connectHeaders[0]?.authorization).toBe('Bearer sse-token');
  });
});
