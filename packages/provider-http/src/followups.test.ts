/**
 * Review follow-ups to holodeck#89: #97 #98 #103 #105 #106 (and #94 below).
 * #99 (id-only frames and empty-id resets update Last-Event-ID) was already
 * fixed by #89; its tests live in provider.sse.test.ts and sse-id.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  const h = await connect({ timeoutMs: 1000, backoff: fast, ...config }, extra);
  harnesses.push(h);
  return h;
}

describe('#97 cache newest = request order', () => {
  it('a read that started earlier but finished later does not overwrite a newer poll result', async () => {
    let calls = 0;
    server.route('GET', '/s', async (_req, res) => {
      const n = ++calls;
      if (n === 1) await sleep(250); // the read: slow, and its data is older
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ v: n === 1 ? 'old' : 'new' }));
    });
    const h = await open({ url: `${server.url}/s`, intervalMs: 60_000 });
    const reading = h.session.read!(['/v']);
    await sleep(30); // the read's request is on the wire first
    const a = collector();
    h.session.subscribe(['/v'], a.onSamples);
    await waitFor(() => a.latest('/v')?.value === 'new');
    expect((await reading)[0]?.value).toBe('old'); // the read reports what it fetched
    const b = collector();
    h.session.subscribe(['/v'], b.onSamples);
    await waitFor(() => b.count() > 0);
    expect(b.batches[0]?.[0]?.value).toBe('new');
  });
});

describe('#105 streaming read does not revert after a partial update', () => {
  it('v=2 answered from a payload stays cached when an unrelated {w} arrives', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events`, mode: 'sse' });
    const c = collector();
    const stopV = h.session.subscribe(['/v'], c.onSamples);
    await feed.waitForClients(1);
    const keep = collector();
    h.session.subscribe(['/w'], keep.onSamples); // keeps the channel open
    feed.broadcast('{"v":1}');
    await waitFor(() => c.latest('/v')?.value === 1);
    stopV();
    feed.broadcast('{"v":2,"w":0}');
    await waitFor(() => keep.latest('/w')?.value === 0);
    expect((await h.session.read!(['/v']))[0]?.value).toBe(2);
    feed.broadcast('{"w":3}');
    await waitFor(() => keep.latest('/w')?.value === 3);
    expect((await h.session.read!(['/v']))[0]?.value).toBe(2);
  });
});

describe('#103 Last-Event-ID never passes undelivered events', () => {
  // eventsource-parser only throws for an UNTERMINATED event that outgrows
  // maxBytes (complete oversized events are dispatched, then dropped by
  // handleText), and it dispatches everything complete in a chunk before it
  // throws. So the only id that could leak is the undispatched one.
  it('an oversized unterminated event after an id line: resume from the last delivered id, even after a heartbeat', async () => {
    const feed = server.sse('/events');
    feed.preamble = 'retry: 20\n\n';
    const h = await open({ url: `${server.url}/events`, mode: 'sse', maxBytes: 200 });
    const c = collector();
    h.session.subscribe(['/n'], c.onSamples);
    await feed.waitForClients(1);
    feed.broadcast('{"n":1}', { id: 'delivered' });
    await waitFor(() => c.latest('/n')?.value === 1);
    feed.clients[0]!.raw(`id: lost\ndata: {"n":2}\ndata: ${'x'.repeat(400)}\n`);
    await waitFor(() => feed.connections === 2, 3000, 'reconnect after oversized event');
    expect(feed.connectHeaders[1]?.['last-event-id']).toBe('delivered');
    await feed.waitForClients(1);
    feed.clients[0]!.raw('\n'); // a blank line must not promote the undelivered id
    await sleep(30);
    feed.dropAll();
    await waitFor(() => feed.connections === 3, 3000, 'second reconnect');
    expect(feed.connectHeaders[2]?.['last-event-id']).toBe('delivered');
  });
});

describe('#98 followRedirects in browsers', () => {
  it('is rejected at connect with a clear error when the environment is a browser', async () => {
    await expect(
      connect({ url: `${server.url}/s`, followRedirects: true }, { options: { browser: true } }),
    ).rejects.toThrow(/followRedirects.*(browser|Node)/);
  });
  it('is fine in a browser when left off, and on Node when on', async () => {
    server.json('/s', { v: 1 });
    harnesses.push(await connect({ url: `${server.url}/s` }, { options: { browser: true } }));
    harnesses.push(await connect({ url: `${server.url}/s`, followRedirects: true }, { options: { browser: false } }));
  });
});

describe('#94 channel cap and path scope', () => {
  it('sources past maxChannels become bad samples; freed channels can be reused', async () => {
    for (const p of ['/a', '/b', '/c']) server.json(p, { v: p });
    const h = await open({ url: `${server.url}/a`, intervalMs: 60_000 }, { options: { maxChannels: 2 } });
    const c = collector();
    const stop = h.session.subscribe(['/a#/v', '/b#/v', '/c#/v'], c.onSamples);
    await waitFor(() => c.all().length >= 3);
    const bySource = Object.fromEntries(c.all().map((s) => [s.source, s]));
    expect(bySource['/a#/v']?.value).toBe('/a');
    expect(bySource['/b#/v']?.value).toBe('/b');
    expect(bySource['/c#/v']).toMatchObject({ value: null, quality: 'bad' });
    expect(server.requestsTo('/c')).toHaveLength(0);
    expect(h.logs.some(([, m]) => /channel limit/.test(m))).toBe(true);
    stop();
    const d = collector();
    h.session.subscribe(['/c#/v'], d.onSamples);
    await waitFor(() => d.latest('/c#/v')?.value === '/c');
  });

  it('pathPrefix scopes the endpoints a document may address (segment boundary)', async () => {
    server.json('/api/x', { v: 1 });
    server.json('/apix', { v: 2 });
    server.json('/other', { v: 3 });
    const h = await open({ url: `${server.url}/api/x`, intervalMs: 60_000 }, { options: { pathPrefix: '/api' } });
    const c = collector();
    h.session.subscribe(['/api/x#/v', '/apix#/v', '/other#/v', '/api/../other#/v'], c.onSamples);
    await waitFor(() => c.all().length >= 4);
    const by = Object.fromEntries(c.all().map((s) => [s.source, s.value]));
    expect(by).toEqual({ '/api/x#/v': 1, '/apix#/v': null, '/other#/v': null, '/api/../other#/v': null });
    expect(server.requestsTo('/apix')).toHaveLength(0);
    expect(server.requestsTo('/other')).toHaveLength(0);
  });

  it('rejects a connection URL outside pathPrefix, and bad option values', async () => {
    await expect(connect({ url: `${server.url}/elsewhere` }, { options: { pathPrefix: '/api' } })).rejects.toThrow(/pathPrefix/);
    await expect(connect({ url: `${server.url}/x` }, { options: { maxChannels: 0 } })).rejects.toThrow(/maxChannels/);
    await expect(connect({ url: `${server.url}/x` }, { options: { pathPrefix: 'api' } })).rejects.toThrow(/pathPrefix/);
  });
});
