/**
 * Property: no secret ever leaves the provider in a thrown error, a status
 * message or a log line (holodeck#89 review). A hostile or careless server
 * injects the secret into every field it controls, for every auth scheme,
 * several secret shapes and every session operation; we collect everything
 * the provider exposes and look for every encoding of the secret.
 */
import { createProviderContext, type ProviderSession } from '@holodeck/sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpProvider } from './provider';
import { sleep, startTestServer, type TestServer } from './test-support/server';

/** Secret shapes: plain, URL-special characters, non-ASCII (invalid in headers: fetch itself fails). */
const SECRETS = ['plainSECRET0123456789', 'tok en/+=&?#%x', 'pässwörd-ü'];

const AUTHS = [
  { scheme: 'bearer' },
  { scheme: 'header', name: 'X-API-Key' },
  { scheme: 'query', name: 'api_key' },
  { scheme: 'basic', username: 'ops' },
] as const;

/** Every form a secret can take on the wire or in text. */
function forms(secret: string): string[] {
  const out = new Set([
    secret,
    encodeURIComponent(secret),
    new URLSearchParams({ s: secret }).toString().slice(2),
    encodeURI(secret),
    Buffer.from(`ops:${secret}`, 'utf8').toString('base64'),
  ]);
  return [...out].filter((f) => f.length >= 6);
}

let server: TestServer;
let secret = SECRETS[0] as string;
/** The secret as a server would put it in a header-safe or URL field. */
const enc = () => encodeURIComponent(secret);

/** Server-controlled fields, each a route that injects the secret. */
const SITES: Record<string, (req: IncomingMessage, res: ServerResponse) => void> = {
  'redirect-path': (_req, res) => void res.writeHead(302, { location: `/session/${enc()}` }).end(),
  'redirect-query': (_req, res) => void res.writeHead(307, { location: `/x?token=${enc()}&raw=${enc()}` }).end(),
  'redirect-loop': (req, res) => void res.writeHead(302, { location: `/redirect-loop/${enc()}/${(req.url ?? '').length}` }).end(),
  'redirect-ftp': (_req, res) => void res.writeHead(302, { location: `ftp://example.com/${enc()}` }).end(),
  'redirect-invalid': (_req, res) => void res.writeHead(302, { location: `http://[${enc()}` }).end(),
  'status-text': (_req, res) => void res.writeHead(500, `Bad ${enc()}`).end(),
  'body-401': (_req, res) => void res.writeHead(401, { 'content-type': 'text/plain' }).end(`invalid key ${secret}`),
  'body-malformed': (_req, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end(`{"key": ${secret}`),
  'error-json': (_req, res) => void res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `bad ${secret}` })),
  'too-large': (_req, res) => void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ k: secret, pad: 'x'.repeat(5000) })),
  'sse-content-type': (_req, res) => void res.writeHead(200, { 'content-type': `text/plain; k=${enc()}` }).end(),
  'sse-messages': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: not json ${secret}\n\n`);
    res.write(`event: ${secret}\ndata: {"v":1}\n\n`);
    res.write(`id: ${secret}\ndata: {"v": ${secret}}\n\n`);
    res.write(`data: ${JSON.stringify({ big: secret.repeat(400) })}\n\n`);
    setTimeout(() => res.end(), 20);
  },
};

beforeAll(async () => {
  server = await startTestServer();
  for (const [site, handler] of Object.entries(SITES)) server.route('*', `/${site}`, handler);
  server.route('*', '/redirect-loop/*', SITES['redirect-loop']!);
  // Redirect targets answer with an error whose body names the (secret-bearing) path.
  server.route('*', '/session/*', (req, res) => void res.writeHead(500).end(req.url));
  server.route('*', '/x', (req, res) => void res.writeHead(500).end(req.url));
  const ws = server.ws('/ws-messages');
  ws.onConnect = (socket) => {
    socket.send(`not json ${secret}`);
    socket.send(JSON.stringify({ big: secret.repeat(400) }));
    setTimeout(() => socket.close(4000, `bye ${enc()}`.slice(0, 100)), 20);
  };
});
afterAll(async () => {
  await server.close();
});

interface Exposure {
  text: string[];
}

async function exercise(
  site: string,
  auth: (typeof AUTHS)[number],
  mode: 'poll' | 'sse' | 'websocket',
  exposure: Exposure,
  options: Parameters<typeof createHttpProvider>[0] = {},
) {
  const logs = exposure.text;
  const record = (error: unknown) => {
    logs.push(String(error), (error as Error)?.message ?? '', JSON.stringify(error) ?? '');
    if (error instanceof Error && error.cause) logs.push(String(error.cause));
  };
  const provider = createHttpProvider(options);
  const isWs = mode === 'websocket';
  const url = isWs ? `${server.wsUrl}/${site}` : `${server.url}/${site}`;
  const config: Record<string, unknown> = {
    url,
    mode,
    timeoutMs: 1000,
    maxBytes: 2000,
    backoff: { initialMs: 20, maxMs: 40, jitter: 0 },
    followRedirects: site !== 'redirect-path',
    auth: isWs ? { scheme: 'query', name: 'api_key' } : auth,
    write: { url: isWs ? `/${site.replace('ws-', '')}` : `/${site}` },
  };
  if (mode === 'poll') config.intervalMs = 50;
  let session: ProviderSession;
  try {
    session = await provider.connect(
      config,
      createProviderContext({
        secret: async () => secret,
        log: (level, message, data) => logs.push(`${level} ${message} ${data === undefined ? '' : JSON.stringify(data)}`),
      }),
    );
  } catch (error) {
    record(error);
    return;
  }
  session.onStatus((s) => logs.push(s.message ?? ''));
  try {
    await session.read?.(['/v', `/x?${enc()}#/v`]).catch(record);
    await session.write?.('/v', secret).catch(record);
    await session.write?.(`/${enc()}#/v`, 1).catch(record);
    await session.browse?.().catch(record);
    await session.browse?.(`/session/${enc()}#`).catch(record);
    const stop = session.subscribe(['/v', '/big'], () => {});
    await sleep(mode === 'poll' ? 150 : 200);
    logs.push(session.status().message ?? '');
    stop();
  } finally {
    await session.close();
  }
}

describe('secrets never leak (property over sites × auth schemes × secret shapes)', () => {
  const pollSites = Object.keys(SITES).filter((s) => !s.startsWith('sse-'));
  const cases: Array<[string, string, (typeof AUTHS)[number], 'poll' | 'sse' | 'websocket']> = [];
  for (const s of SECRETS) {
    for (const auth of AUTHS) {
      for (const site of pollSites) cases.push([s, site, auth, 'poll']);
      for (const site of ['sse-content-type', 'sse-messages', 'redirect-path', 'status-text', 'body-401']) cases.push([s, site, auth, 'sse']);
    }
    cases.push([s, 'ws-messages', AUTHS[2], 'websocket']);
  }

  it(`holds for ${cases.length} combinations`, async () => {
    const failures: string[] = [];
    let exposedChars = 0;
    for (const [s, site, auth, mode] of cases) {
      secret = s;
      const exposure: Exposure = { text: [] };
      await exercise(site, auth, mode, exposure);
      const all = exposure.text.join('\n');
      exposedChars += all.length;
      for (const form of forms(s)) {
        if (all.includes(form)) {
          const line = exposure.text.find((t) => t.includes(form)) ?? '';
          failures.push(`${mode} ${site} ${auth.scheme} secret=${JSON.stringify(s)} form=${JSON.stringify(form)}: ${line.slice(0, 200)}`);
          break;
        }
      }
    }
    // The provider did say things (errors, statuses, logs): the property is not vacuous.
    expect(exposedChars).toBeGreaterThan(10_000);
    expect(failures).toEqual([]);
  }, 120_000);

  it('rejection paths (maxChannels, pathPrefix, browser followRedirects) stay redacted', async () => {
    const failures: string[] = [];
    let exposedChars = 0;
    for (const s of SECRETS) {
      for (const site of Object.keys(SITES).filter((x) => !x.startsWith('sse-'))) {
        secret = s;
        // `browser: true` + followRedirects rejects at connect; the other half exercises scope/cap rejections.
        for (const browser of [true, false]) {
          const exposure: Exposure = { text: [] };
          await exercise(site, AUTHS[2], 'poll', exposure, { maxChannels: 1, pathPrefix: `/${site}`, browser });
          const all = exposure.text.join('\n');
          exposedChars += all.length;
          for (const form of forms(s)) if (all.includes(form)) failures.push(`${site} browser=${browser} form=${form}`);
        }
      }
    }
    expect(exposedChars).toBeGreaterThan(1000);
    expect(failures).toEqual([]);
  }, 120_000);

  it('the provider still reports useful errors with the secret replaced', async () => {
    secret = SECRETS[0] as string;
    const provider = createHttpProvider();
    const session = await provider.connect(
      { url: `${server.url}/redirect-path`, followRedirects: true, write: { url: '/redirect-path' }, auth: { scheme: 'bearer' } },
      createProviderContext({ secret: async () => secret }),
    );
    try {
      const error = await session.write!('/v', 1).then(
        () => undefined,
        (e: Error) => e,
      );
      expect(error?.message).toMatch(/HTTP 500/);
      expect(error?.message).not.toContain(secret);
      expect(error?.name).toBe('HttpProviderError');
    } finally {
      await session.close();
    }
  });
});
