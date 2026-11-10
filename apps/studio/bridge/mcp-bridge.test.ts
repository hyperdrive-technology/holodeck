// @vitest-environment node
/**
 * The MCP playground bridge server over real loopback sockets: who may
 * connect (tokens, Origin, Host), relaying between agent and tab, and the
 * failure paths (no tab, tab gone, timeout, wrong tab answering).
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BRIDGE_CONFIG_PATH, type BridgeFile, type BridgeResponse } from '../src/playground/bridge-protocol';
import { isLoopbackAddress, isLoopbackOrigin, sameToken, startMcpBridge, type McpBridge } from './mcp-bridge';
import { bridgeConfigMiddleware, bridgeEnabled } from './vite-plugin';

const STUDIO_PORT = 5999;
const ORIGIN = `http://localhost:${STUDIO_PORT}`;

let dir: string;
let bridge: McpBridge;
const open: WebSocket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hd-bridge-'));
  bridge = await startMcpBridge({ allowOrigin: (o) => isLoopbackOrigin(o, STUDIO_PORT), file: join(dir, '.holodeck-mcp.json'), requestTimeoutMs: 400 });
});
afterEach(async () => {
  for (const ws of open.splice(0)) ws.terminate();
  await bridge.close();
  await rm(dir, { recursive: true, force: true });
});

/** Connect; resolves with the socket, or rejects with the HTTP status of a refused upgrade. */
function connect(query: string, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((done, failed) => {
    const ws = new WebSocket(`${bridge.url}${query}`, { headers });
    open.push(ws);
    ws.once('open', () => done(ws));
    ws.once('unexpected-response', (_req, res) => failed(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', failed);
  });
}
const agent = () => connect(`?role=agent&token=${bridge.agentToken}`);
async function session(name = 'Playground') {
  const ws = await connect(`?role=session&token=${bridge.sessionToken}`, { Origin: ORIGIN });
  ws.send(JSON.stringify({ type: 'hello', protocol: 1, session: { documentId: 'playground', documentName: name, tab: 'edit' } }));
  return ws;
}
const next = (ws: WebSocket) => new Promise<Record<string, unknown>>((done) => ws.once('message', (d) => done(JSON.parse(d.toString()))));
/** Agent request -> its response. */
async function call(ws: WebSocket, method: string, params?: unknown, id = 'a1') {
  const reply = next(ws);
  ws.send(JSON.stringify({ type: 'request', id, method, params }));
  return (await reply) as unknown as BridgeResponse;
}
/** Wait until the bridge lists `n` sessions (hello is asynchronous). */
async function sessions(ws: WebSocket, n: number) {
  for (let i = 0; i < 50; i += 1) {
    const r = await call(ws, 'bridge.status', undefined, `st${i}`);
    if (r.ok && (r.result as { sessions: unknown[] }).sessions.length === n) return (r.result as { sessions: Array<{ documentName: string }> }).sessions;
    await new Promise((d) => setTimeout(d, 10));
  }
  throw new Error(`never saw ${n} sessions`);
}

describe('startMcpBridge', () => {
  it('listens on loopback only and writes the agent file (mode 0600); close removes it', async () => {
    expect(bridge.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/$/);
    const path = join(dir, '.holodeck-mcp.json');
    const file = JSON.parse(await readFile(path, 'utf8')) as BridgeFile;
    expect(file).toMatchObject({ protocol: 1, url: bridge.url, token: bridge.agentToken, pid: process.pid });
    expect(file.token).not.toBe(bridge.sessionToken);
    expect(bridge.agentToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await bridge.close();
    await expect(stat(path)).rejects.toThrow();
  });

  it('leaves an agent file another bridge wrote since', async () => {
    const path = join(dir, '.holodeck-mcp.json');
    await writeFile(path, '{"token":"someone-else"}');
    await bridge.close();
    expect(await readFile(path, 'utf8')).toContain('someone-else');
  });

  it('refuses sessions without the session token, or from a foreign / missing Origin', async () => {
    await expect(connect(`?role=session&token=nope`, { Origin: ORIGIN })).rejects.toThrow('HTTP 401');
    await expect(connect(`?role=session&token=${bridge.agentToken}`, { Origin: ORIGIN })).rejects.toThrow('HTTP 401');
    await expect(connect(`?role=session&token=${bridge.sessionToken}`)).rejects.toThrow('HTTP 403');
    for (const origin of ['http://evil.example', 'http://localhost:1234', `http://localhost.evil.example:${STUDIO_PORT}`, 'null']) {
      await expect(connect(`?role=session&token=${bridge.sessionToken}`, { Origin: origin }), origin).rejects.toThrow('HTTP 403');
    }
    await expect(session()).resolves.toBeDefined();
  });

  it('refuses agents with an Origin (any browser page), the session token, or no role', async () => {
    await expect(connect(`?role=agent&token=${bridge.agentToken}`, { Origin: ORIGIN })).rejects.toThrow('HTTP 403');
    await expect(connect(`?role=agent&token=${bridge.sessionToken}`)).rejects.toThrow('HTTP 401');
    await expect(connect(`?token=${bridge.agentToken}`)).rejects.toThrow('HTTP 400');
    await expect(connect(`other?role=agent&token=${bridge.agentToken}`)).rejects.toThrow('HTTP 404');
    await expect(agent()).resolves.toBeDefined();
  });

  it('refuses a Host that is not the loopback address (DNS rebinding)', async () => {
    await expect(connect(`?role=agent&token=${bridge.agentToken}`, { Host: `evil.example:${bridge.port}` })).rejects.toThrow('HTTP 403');
  });

  it('answers plain HTTP with 426', async () => {
    const res = await fetch(bridge.url.replace('ws:', 'http:'));
    expect(res.status).toBe(426);
  });

  it('relays a request to the tab and its answer back under the agent’s id', async () => {
    const a = await agent();
    const tab = await session('My playground');
    expect(await sessions(a, 1)).toMatchObject([{ documentName: 'My playground', tab: 'edit' }]);
    const asked = next(tab);
    const reply = call(a, 'state', { metrics: false }, 'agent-7');
    const request = await asked;
    expect(request).toMatchObject({ type: 'request', method: 'state', params: { metrics: false } });
    expect(request.id).not.toBe('agent-7');
    tab.send(JSON.stringify({ type: 'response', id: request.id, ok: true, result: { etag: 'e1' } }));
    expect(await reply).toEqual({ type: 'response', id: 'agent-7', ok: true, result: { etag: 'e1' } });
  });

  it('no tab: no_session; the newest tab gets requests; a closed tab falls back to the previous one', async () => {
    const a = await agent();
    expect(await call(a, 'state')).toMatchObject({ ok: false, error: { code: 'no_session' } });
    const first = await session('first');
    await sessions(a, 1);
    const second = await session('second');
    expect((await sessions(a, 2)).map((s) => s.documentName)).toEqual(['second', 'first']);
    const toSecond = next(second);
    void call(a, 'state', undefined, 'x');
    expect(await toSecond).toMatchObject({ method: 'state' });
    second.close();
    expect((await sessions(a, 1)).map((s) => s.documentName)).toEqual(['first']);
    const toFirst = next(first);
    void call(a, 'state', undefined, 'y');
    expect(await toFirst).toMatchObject({ method: 'state' });
  });

  it('a tab that closes mid-request fails it (session_gone); one that never answers times out', async () => {
    const a = await agent();
    const tab = await session();
    await sessions(a, 1);
    const asked = next(tab);
    const reply = call(a, 'apply', {}, 'z');
    await asked;
    tab.close();
    expect(await reply).toMatchObject({ id: 'z', ok: false, error: { code: 'session_gone' } });

    const slow = await session();
    await sessions(a, 1);
    expect(await call(a, 'state', undefined, 't')).toMatchObject({ id: 't', ok: false, error: { code: 'timeout' } });
    slow.close();
  });

  it('only the tab that was asked may answer; malformed messages are dropped', async () => {
    const a = await agent();
    const asked1 = await session('one');
    await sessions(a, 1);
    const other = await session('two');
    await sessions(a, 2);
    const toOther = next(other);
    const reply = call(a, 'state', undefined, 'q');
    const request = await toOther;
    asked1.send(JSON.stringify({ type: 'response', id: request.id, ok: true, result: 'forged' }));
    other.send('not json');
    other.send(JSON.stringify({ type: 'response', id: request.id, ok: false }));
    other.send(JSON.stringify({ type: 'response', id: request.id, ok: true, result: 'real' }));
    expect(await reply).toMatchObject({ ok: true, result: 'real' });
  });
});

describe('helpers', () => {
  it('isLoopbackOrigin: the studio’s own origins only', () => {
    expect(isLoopbackOrigin('http://localhost:5173', 5173)).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:5173', 5173)).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:5173', 5173)).toBe(true);
    expect(isLoopbackOrigin('http://localhost:5173', null)).toBe(false);
    for (const o of ['http://localhost:5174', 'http://example.com:5173', 'file://', 'null', 'http://localhost:5173/x', 'http://user@localhost:5173']) {
      expect(isLoopbackOrigin(o, 5173), o).toBe(false);
    }
  });

  it('isLoopbackAddress and sameToken', () => {
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1'].every(isLoopbackAddress)).toBe(true);
    expect(isLoopbackAddress('192.168.1.4')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abcd')).toBe(false);
  });

  it('bridgeEnabled: playground mode or HOLODECK_MCP_BRIDGE=1; =0 wins', () => {
    expect(bridgeEnabled('playground', {})).toBe(true);
    expect(bridgeEnabled('development', {})).toBe(false);
    expect(bridgeEnabled('production', { HOLODECK_MCP_BRIDGE: '1' })).toBe(true);
    expect(bridgeEnabled('playground', { HOLODECK_MCP_BRIDGE: '0' })).toBe(false);
  });
});

describe('bridgeConfigMiddleware', () => {
  type Res = { status?: number; body?: string; headers: Record<string, string> };
  const run = (req: { url: string; method?: string; address?: string; host?: string }, b: McpBridge | null) =>
    new Promise<Res | 'next'>((done) => {
      const out: Res = { headers: {} };
      const res = {
        setHeader: (k: string, v: string) => void (out.headers[k] = v),
        writeHead(status: number, headers?: Record<string, string>) {
          out.status = status;
          Object.assign(out.headers, headers);
          return this;
        },
        end(body?: string) {
          out.body = body;
          done(out);
        },
      };
      const incoming = { url: req.url, method: req.method ?? 'GET', socket: { remoteAddress: req.address ?? '127.0.0.1' }, headers: { host: req.host ?? 'localhost:5173' } };
      bridgeConfigMiddleware(async () => b)(incoming as never, res as never, () => done('next'));
    });

  it('gives loopback GETs the session config, never the agent token', async () => {
    const out = await run({ url: `${BRIDGE_CONFIG_PATH}?x=1` }, bridge);
    expect(out).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });
    const body = JSON.parse((out as Res).body!);
    expect(body).toEqual({ protocol: 1, url: bridge.url, token: bridge.sessionToken });
    expect((out as Res).body).not.toContain(bridge.agentToken);
  });

  it('refuses LAN clients, non-loopback Host names and other methods; passes other paths on; 503 without a bridge', async () => {
    expect(await run({ url: BRIDGE_CONFIG_PATH, address: '192.168.1.9' }, bridge)).toMatchObject({ status: 403 });
    expect(await run({ url: BRIDGE_CONFIG_PATH, host: 'evil.example:5173' }, bridge)).toMatchObject({ status: 403 });
    expect(await run({ url: BRIDGE_CONFIG_PATH, method: 'POST' }, bridge)).toMatchObject({ status: 405 });
    expect(await run({ url: '/playground' }, bridge)).toBe('next');
    expect(await run({ url: BRIDGE_CONFIG_PATH }, null)).toMatchObject({ status: 503 });
  });
});
