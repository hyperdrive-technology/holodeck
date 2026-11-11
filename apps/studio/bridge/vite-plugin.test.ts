// @vitest-environment node
/**
 * `mcpBridgePlugin` inside a real Vite dev server (holodeck#277): Vite's own
 * CORS middleware runs before plugin middlewares and allows every localhost
 * origin by default, so only a test against Vite itself shows whether another
 * localhost page can read the session token from the config endpoint.
 */
import { request } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { BRIDGE_CONFIG_PATH, type BridgeFile } from '../src/playground/bridge-protocol';
import { mcpBridgePlugin } from './vite-plugin';

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function get(port: number, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((done, failed) => {
    const req = request({ host: '127.0.0.1', port, path: BRIDGE_CONFIG_PATH, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.once('error', failed);
    req.end();
  });
}

describe('mcpBridgePlugin in a real Vite dev server', () => {
  let dir: string;
  let server: ViteDevServer;
  let port: number;
  const env = { ...process.env };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hd-vite-bridge-'));
    process.env.HOLODECK_MCP_BRIDGE = '1';
    process.env.HOLODECK_MCP_BRIDGE_FILE = join(dir, '.holodeck-mcp.json');
    delete process.env.HOLODECK_MCP_BRIDGE_PORT;
    server = await createServer({ configFile: false, root: dir, logLevel: 'silent', plugins: [mcpBridgePlugin()], server: { host: '127.0.0.1', port: 0, strictPort: false } });
    await server.listen();
    port = (server.httpServer!.address() as { port: number }).port;
    // The bridge starts asynchronously: 503 until it is up (bounded, state-driven).
    for (let i = 0; i < 200 && (await get(port)).status === 503; i += 1) await new Promise((d) => setTimeout(d, 10));
  });
  afterAll(async () => {
    await server?.close();
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  });

  it('gives the studio’s own page the session token and writes the agent file', async () => {
    const own = await get(port);
    expect(own.status).toBe(200);
    const config = JSON.parse(own.body) as { token: string; url: string };
    expect(config.token).toMatch(/^[\w-]{40,}$/);
    const file = JSON.parse(await readFile(process.env.HOLODECK_MCP_BRIDGE_FILE!, 'utf8')) as BridgeFile;
    expect(file.url).toBe(config.url);
    expect(file.token).not.toBe(config.token);
    expect((await get(port, { origin: `http://localhost:${port}` })).status).toBe(200);
  });

  it('another localhost page gets 403 and no CORS grant, though Vite’s default cors would allow it', async () => {
    for (const origin of ['http://localhost:6006', `http://evil.localhost:${port}`, 'http://127.0.0.1:1']) {
      const answer = await get(port, { origin });
      expect(answer.status, origin).toBe(403);
      expect(answer.headers['access-control-allow-origin'], origin).toBeUndefined();
      expect(answer.body).toBe('');
    }
    expect((await get(port, { 'sec-fetch-site': 'same-site' })).status).toBe(403);
  });
});
