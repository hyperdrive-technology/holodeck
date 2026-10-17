/**
 * Cached values (holodeck#89 review, P2): what a new subscriber or `read()`
 * gets must be the latest value the session has seen, whichever path (a
 * subscription, a read, another endpoint subscriber) brought it in, and reads
 * must stamp samples the same way subscriptions do.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collector, connect, type Harness } from './test-support/harness';
import { sleep, startTestServer, waitFor, type TestServer } from './test-support/server';

let server: TestServer;
let harnesses: Harness[] = [];

beforeEach(async () => {
  server = await startTestServer();
  harnesses = [];
});
afterEach(async () => {
  for (const h of harnesses) await h.session.close();
  await server.close();
});

async function open(config: Record<string, unknown>) {
  const h = await connect({ timeoutMs: 1000, ...config });
  harnesses.push(h);
  return h;
}

describe('holodeck.http cached values', () => {
  it('poll: a new subscriber after churn gets the newest value (from a read), not an older delivered one', async () => {
    let v = 1;
    server.json('/s', () => ({ v }));
    const h = await open({ url: `${server.url}/s`, intervalMs: 60_000 });
    const a = collector();
    const stopA = h.session.subscribe(['/v'], a.onSamples);
    await waitFor(() => a.count() > 0);
    stopA();
    v = 2;
    expect((await h.session.read!(['/v']))[0]?.value).toBe(2);
    v = 3;
    const b = collector();
    h.session.subscribe(['/v'], b.onSamples);
    await waitFor(() => b.count() > 0);
    // First delivery is the cached current value: 2 (latest seen), never 1.
    expect(b.batches[0]?.[0]?.value).toBe(2);
    await waitFor(() => b.latest('/v')?.value === 3);
  });

  it('poll: a read after churn sees a newer payload than the one last delivered', async () => {
    let v = 1;
    server.json('/s', () => ({ v, w: 'x' }));
    const h = await open({ url: `${server.url}/s`, intervalMs: 60_000 });
    const a = collector();
    const stopA = h.session.subscribe(['/v'], a.onSamples);
    await waitFor(() => a.count() > 0);
    stopA();
    v = 2;
    await h.session.read!(['/w']); // refreshes the payload; /v not requested
    const b = collector();
    h.session.subscribe(['/v'], b.onSamples);
    await waitFor(() => b.count() > 0);
    expect(b.batches[0]?.[0]?.value).toBe(2);
  });

  it('sse: read returns the newest message value even if it arrived while nobody subscribed to that source', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events`, mode: 'sse' });
    const a = collector();
    const stopA = h.session.subscribe(['/v'], a.onSamples);
    await feed.waitForClients(1);
    feed.broadcast('{"v":1}');
    await waitFor(() => a.count() > 0);
    stopA();
    await feed.waitForClients(0);
    const b = collector();
    h.session.subscribe(['/w'], b.onSamples);
    await feed.waitForClients(1);
    feed.broadcast('{"v":2,"w":"x"}');
    await waitFor(() => b.count() > 0);
    expect((await h.session.read!(['/v']))[0]?.value).toBe(2);
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await sleep(0);
    expect(c.batches[0]?.[0]?.value).toBe(2);
  });

  it('sse: a partial newer message does not hide an older value of a source it lacks', async () => {
    const feed = server.sse('/events');
    const h = await open({ url: `${server.url}/events`, mode: 'sse' });
    const a = collector();
    h.session.subscribe(['/v', '/w'], a.onSamples);
    await feed.waitForClients(1);
    feed.broadcast('{"v":1}');
    feed.broadcast('{"w":"x"}');
    await waitFor(() => a.count() >= 2);
    expect((await h.session.read!(['/v', '/w'])).map((s) => s.value)).toEqual([1, 'x']);
  });

  it('poll read stamps samples with the configured timestamp selector', async () => {
    server.json('/s', { ts: '2026-10-17T12:00:00Z', v: 1 });
    const h = await open({ url: `${server.url}/s`, timestamp: '$.ts' });
    const [sample] = await h.session.read!(['/v']);
    expect(sample).toMatchObject({ value: 1, ts: Date.parse('2026-10-17T12:00:00Z') });
    // …and a subscriber served from that cached read gets the same stamp.
    const c = collector();
    h.session.subscribe(['/v'], c.onSamples);
    await waitFor(() => c.count() > 0);
    expect(c.batches[0]?.[0]?.ts).toBe(Date.parse('2026-10-17T12:00:00Z'));
  });
});
