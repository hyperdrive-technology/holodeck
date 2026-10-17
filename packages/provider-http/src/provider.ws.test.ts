import { runProviderConformance } from '@holodeck/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const h = await connect({ mode: 'websocket', timeoutMs: 1000, backoff: fast, ...config }, extra);
  harnesses.push(h);
  return h;
}

describe('holodeck.http websocket', () => {
  it('uses the global WebSocket (Node ≥ 22) by default', () => {
    expect(typeof globalThis.WebSocket).toBe('function');
  });

  it('passes runProviderConformance against a local socket', async () => {
    const feed = server.ws('/feed');
    feed.onConnect = (socket) => socket.send(JSON.stringify({ temp: 21, state: 'RUN' }));
    const timer = setInterval(() => feed.broadcast(JSON.stringify({ temp: 22 })), 30);
    const failures: string[] = [];
    try {
      await runProviderConformance(
        () => createHttpProvider(),
        { config: { url: `${server.wsUrl}/feed`, mode: 'websocket' }, sources: ['/temp', '$.state'], flush: () => sleep(10) },
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

  it('sends the subscribe message after every (re)connect and maps partial messages', async () => {
    const feed = server.ws('/feed');
    const h = await open({ url: `${server.wsUrl}/feed`, subscribe: { op: 'subscribe', topics: ['line2'] }, protocols: ['json'] });
    const c = collector();
    h.session.subscribe(['/line2/speed', '$.line2.state'], c.onSamples);
    await feed.waitForClients(1);
    await waitFor(() => feed.received.length === 1);
    expect(JSON.parse(feed.received[0]!)).toEqual({ op: 'subscribe', topics: ['line2'] });
    feed.broadcast(JSON.stringify({ line2: { speed: 3 } }));
    feed.broadcast(JSON.stringify({ line2: { state: 'RUN' } }));
    await waitFor(() => c.count() >= 2);
    expect(c.all().map((s) => [s.source, s.value])).toEqual([
      ['/line2/speed', 3],
      ['$.line2.state', 'RUN'],
    ]);

    feed.dropAll(1012);
    await waitFor(() => feed.connections === 2, 3000, 'reconnect');
    await waitFor(() => feed.received.length === 2);
    expect(JSON.parse(feed.received[1]!)).toEqual({ op: 'subscribe', topics: ['line2'] });
    expect(h.statuses.some((s) => s.state === 'stale' && /code 1012/.test(s.message ?? ''))).toBe(true);
    await waitFor(() => h.session.status().state === 'live');
  });

  it('accepts binary (UTF-8 JSON) messages', async () => {
    const feed = server.ws('/feed');
    const h = await open({ url: `${server.wsUrl}/feed` });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await feed.waitForClients(1);
    feed.broadcast(Buffer.from(JSON.stringify({ v: 'binär' }), 'utf8'));
    await waitFor(() => c.count() === 1);
    expect(c.latest('/v')?.value).toBe('binär');
  });

  it('skips malformed and oversized messages without closing the socket', async () => {
    const feed = server.ws('/feed');
    const h = await open({ url: `${server.wsUrl}/feed`, maxBytes: 100 });
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await feed.waitForClients(1);
    feed.broadcast('not json SECRETISH');
    feed.broadcast(JSON.stringify({ v: 'x'.repeat(200) }));
    feed.broadcast(Buffer.alloc(300, 0x20));
    feed.broadcast(JSON.stringify({ v: 'ok' }));
    await waitFor(() => c.count() === 1);
    expect(c.latest('/v')?.value).toBe('ok');
    expect(h.logs.filter(([, m]) => /not valid JSON|larger than 100 bytes/.test(m))).toHaveLength(3);
    expect(h.exposed()).not.toContain('SECRETISH');
    expect(feed.connections).toBe(1);
  });

  it('times out an upgrade that never completes and retries', async () => {
    server.blackholeUpgrade('/void');
    const h = await open({ url: `${server.wsUrl}/void`, timeoutMs: 80 });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toMatch(/timed out after 80 ms/);
  });

  it('reports a refused upgrade as an error and backs off', async () => {
    const h = await open({ url: `${server.wsUrl}/missing`, backoff: { initialMs: 40, maxMs: 160, factor: 2, jitter: 0 } });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error', 3000);
    expect(h.session.status().message).toMatch(/retrying in \d+ ms/);
  });

  it('query auth reaches the server on every connect; the token stays out of logs', async () => {
    const feed = server.ws('/feed');
    const h = await open({ url: `${server.wsUrl}/feed?site=1`, auth: { scheme: 'query', name: 'key' } }, { secrets: { token: 'ws-SECRET' } });
    h.session.subscribe(['/v'], () => {});
    await feed.waitForClients(1);
    const url = new URL(feed.upgradeUrls[0]!, server.url);
    expect(url.searchParams.get('key')).toBe('ws-SECRET');
    expect(url.searchParams.get('site')).toBe('1');
    feed.dropAll();
    await waitFor(() => feed.connections === 2, 3000);
    expect(new URL(feed.upgradeUrls[1]!, server.url).searchParams.get('key')).toBe('ws-SECRET');
    expect(h.exposed()).not.toContain('ws-SECRET');
  });

  it('unsubscribe and close close the socket (no leaked connections)', async () => {
    const feed = server.ws('/feed');
    const h = await open({ url: `${server.wsUrl}/feed` });
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

  it('closing while the socket is still connecting stops all further attempts', async () => {
    server.blackholeUpgrade('/void');
    const h = await open({ url: `${server.wsUrl}/void`, timeoutMs: 5000 });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => server.blackholeAttempts('/void') === 1);
    await h.session.close();
    expect(h.session.status().state).toBe('disconnected');
    // No retry after close. (The half-open TCP socket itself lingers until the
    // server answers: Node's undici WebSocket does not abort a pending
    // handshake on close(); see the note in channels.ts.)
    await sleep(200);
    expect(server.blackholeAttempts('/void')).toBe(1);
  });

  it('an open timeout closes that attempt and retries with a fresh socket', async () => {
    server.blackholeUpgrade('/void');
    const h = await open({ url: `${server.wsUrl}/void`, timeoutMs: 60 });
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => server.blackholeAttempts('/void') >= 3, 3000);
    await h.session.close();
    const attempts = server.blackholeAttempts('/void');
    await sleep(250);
    expect(server.blackholeAttempts('/void')).toBe(attempts);
  });

  it('writes go over HTTP to the matching origin', async () => {
    server.route('POST', '/write', (_req, res) => res.writeHead(204).end());
    const h = await open({ url: `${server.wsUrl}/feed`, write: { url: '/write' } });
    await h.session.write!('/v', true);
    expect(JSON.parse(server.requestsTo('/write')[0]!.body)).toEqual({ source: '/v', value: true });
  });

  it('a WebSocket factory that throws is an error, retried with backoff', async () => {
    let calls = 0;
    const h = await open(
      { url: `${server.wsUrl}/feed` },
      {
        options: {
          webSocket: () => {
            calls++;
            throw new Error('WebSocket is not supported here');
          },
        },
      },
    );
    h.session.subscribe(['/v'], () => {});
    await waitFor(() => h.session.status().state === 'error');
    expect(h.session.status().message).toMatch(/WebSocket is not supported here/);
    await waitFor(() => calls >= 2, 3000);
  });

  it('without any WebSocket implementation the session reports an error', async () => {
    vi.stubGlobal('WebSocket', undefined);
    try {
      const h = await open({ url: `${server.wsUrl}/feed` });
      h.session.subscribe(['/v'], () => {});
      await waitFor(() => h.session.status().state === 'error');
      expect(h.session.status().message).toMatch(/no WebSocket implementation available/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
