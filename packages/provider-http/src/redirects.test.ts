/**
 * Redirect handling (holodeck#89 review, P1): redirects are followed manually,
 * each hop's origin is re-checked, and credentials are only ever sent to the
 * connection's own origin. Two local servers stand in for "our API" and "a
 * third party".
 */
import { createProviderContext } from '@holodeck/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHttpProvider } from './provider';
import { connect, type Harness } from './test-support/harness';
import { startTestServer, type TestServer } from './test-support/server';

let api: TestServer;
let other: TestServer;
let harnesses: Harness[] = [];
const SECRET = 'redirect-SECRET-token';

beforeEach(async () => {
  api = await startTestServer();
  other = await startTestServer();
  harnesses = [];
});
afterEach(async () => {
  for (const h of harnesses) await h.session.close();
  await api.close();
  await other.close();
});

async function open(config: Record<string, unknown>, secrets: Record<string, string> = {}) {
  const h = await connect({ timeoutMs: 2000, ...config }, { secrets });
  harnesses.push(h);
  return h;
}

const AUTHS: Array<[string, Record<string, unknown>, Record<string, string>]> = [
  ['bearer', { scheme: 'bearer' }, { token: SECRET }],
  ['header', { scheme: 'header', name: 'X-API-Key' }, { token: SECRET }],
  ['basic', { scheme: 'basic', username: 'ops' }, { password: SECRET }],
  ['query', { scheme: 'query', name: 'api_key' }, { token: SECRET }],
];

const leaked = (server: TestServer) =>
  server.requests.some((r) => {
    const text = JSON.stringify(r);
    return (
      text.includes(SECRET) ||
      text.includes(Buffer.from(`ops:${SECRET}`).toString('base64')) ||
      r.headers.authorization !== undefined ||
      r.headers['x-api-key'] !== undefined
    );
  });

describe('holodeck.http redirects', () => {
  it.each(AUTHS)('cross-origin redirect never delivers %s credentials to the other origin', async (_name, auth, secrets) => {
    // The redirect echoes the query token back, as a careless server might.
    api.route('GET', '/old', (req, res) => {
      const q = new URL(req.url ?? '/', api.url).search;
      res.writeHead(302, { location: `${other.url}/steal${q}` }).end();
    });
    other.json('/steal', { v: 'third-party' });
    const h = await open({ url: `${api.url}/old`, followRedirects: true, auth }, secrets);
    const [sample] = await h.session.read!(['/v']);
    expect(other.requestsTo('/steal')).toHaveLength(1);
    expect(leaked(other)).toBe(false);
    // The redirect itself was followed (unauthenticated).
    expect(sample?.value).toBe('third-party');
  });

  it.each(AUTHS)('same-origin redirect keeps %s credentials', async (_name, auth, secrets) => {
    api.route('GET', '/old', (_req, res) => res.writeHead(301, { location: '/new' }).end());
    api.json('/new', { v: 'moved' });
    const h = await open({ url: `${api.url}/old`, followRedirects: true, auth }, secrets);
    const [sample] = await h.session.read!(['/v']);
    expect(sample?.value).toBe('moved');
    expect(leaked(api)).toBe(true);
    expect(api.requestsTo('/new')).toHaveLength(1);
  });

  it('credentials stay stripped after leaving the origin, even when a later hop returns', async () => {
    api.route('GET', '/old', (_req, res) => res.writeHead(302, { location: `${other.url}/bounce` }).end());
    other.route('GET', '/bounce', (_req, res) => res.writeHead(302, { location: `${api.url}/final` }).end());
    api.json('/final', { v: 1 });
    const h = await open({ url: `${api.url}/old`, followRedirects: true, auth: { scheme: 'bearer' } }, { token: SECRET });
    await h.session.read!(['/v']);
    expect(leaked(other)).toBe(false);
    // Returning to the connection origin after a third party is treated as untrusted too.
    expect(api.requestsTo('/final')[0]?.headers.authorization).toBeUndefined();
  });

  it('redirects are refused (not followed) by default', async () => {
    api.route('GET', '/old', (_req, res) => res.writeHead(302, { location: `${other.url}/steal` }).end());
    const h = await open({ url: `${api.url}/old`, auth: { scheme: 'bearer' } }, { token: SECRET });
    h.session.subscribe(['/v'], () => {});
    const samples = await h.session.read!(['/v']);
    expect(samples[0]).toMatchObject({ quality: 'bad' });
    expect(other.requests).toHaveLength(0);
    expect(h.logs.some(([, m]) => /redirect/i.test(m))).toBe(true);
  });

  it('caps the number of hops', async () => {
    let n = 0;
    api.route('GET', '/loop', (_req, res) => res.writeHead(302, { location: `/loop?n=${n++}` }).end());
    const h = await open({ url: `${api.url}/loop`, followRedirects: true });
    await h.session.read!(['/v']);
    expect(h.logs.some(([, m]) => /too many redirects/.test(m))).toBe(true);
    expect(api.requestsTo('/loop').length).toBeLessThanOrEqual(6);
  });

  it('refuses a redirect without Location or to a non-HTTP scheme', async () => {
    api.route('GET', '/nowhere', (_req, res) => res.writeHead(302).end());
    api.route('GET', '/file', (_req, res) => res.writeHead(302, { location: 'file:///etc/passwd' }).end());
    const h = await open({ url: `${api.url}/nowhere`, followRedirects: true });
    await h.session.read!(['/v', '/file#/v']);
    expect(h.logs.some(([, m]) => /without a Location/.test(m))).toBe(true);
    expect(h.logs.some(([, m]) => /not http/.test(m))).toBe(true);
  });

  it('an origin allowlist is enforced on every hop', async () => {
    api.route('GET', '/old', (_req, res) => res.writeHead(302, { location: `${other.url}/steal` }).end());
    other.json('/steal', { v: 1 });
    api.route('GET', '/ok', (_req, res) => res.writeHead(302, { location: '/new' }).end());
    api.json('/new', { v: 'allowed' });
    const provider = createHttpProvider({ origins: [api.url] });
    const logs: string[] = [];
    const session = await provider.connect(
      { url: `${api.url}/old`, followRedirects: true },
      createProviderContext({ log: (_l, m) => logs.push(m) }),
    );
    try {
      expect((await session.read!(['/v']))[0]).toMatchObject({ quality: 'bad' });
      expect(other.requests).toHaveLength(0);
      expect(logs.some((m) => /not in this provider's allowed origins/.test(m))).toBe(true);
      expect((await session.read!(['/ok#/v']))[0]?.value).toBe('allowed');
    } finally {
      await session.close();
    }
  });

  it('303 turns a write into GET without a body; 307 keeps method and body', async () => {
    api.route('POST', '/w303', (_req, res) => res.writeHead(303, { location: '/done' }).end());
    api.route('GET', '/done', (_req, res) => res.writeHead(200).end('{}'));
    api.route('POST', '/w307', (_req, res) => res.writeHead(307, { location: '/w307b' }).end());
    api.route('POST', '/w307b', (_req, res) => res.writeHead(204).end());
    const h = await open({ url: `${api.url}/s`, followRedirects: true, write: { url: '/w303' } });
    await h.session.write!('/v', 1);
    expect(api.requestsTo('/done')[0]).toMatchObject({ method: 'GET', body: '' });
    const h2 = await open({ url: `${api.url}/s`, followRedirects: true, write: { url: '/w307' } });
    await h2.session.write!('/v', 2);
    expect(JSON.parse(api.requestsTo('/w307b')[0]!.body)).toEqual({ source: '/v', value: 2 });
  });
});
