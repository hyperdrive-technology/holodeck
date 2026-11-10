/**
 * The playground tools against a fake bridge (a loopback WebSocket server
 * that plays both the bridge and one playground tab), so the MCP side is
 * tested without a browser: reading the bridge file, the agent handshake
 * (token, no Origin), `@playground` edits as ONE `apply` per tool call,
 * error codes from the tab, and the provider tools on files and on the tab.
 * The real bridge server is tested in apps/studio/bridge/mcp-bridge.test.ts,
 * the whole chain (tool call -> live page) in the studio e2e.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseBridgeFile, PlaygroundBridge, PLAYGROUND_PATH } from './playground';
import { createPlaygroundDocument, PLAYGROUND_CONNECTION_ID } from './studio';
import { harness, tempDir, type Harness } from './test-support';

type Doc = ReturnType<typeof createPlaygroundDocument>;
type Handler = (method: string, params: Record<string, unknown> | undefined) => unknown;

interface FakeBridge {
  file: string;
  url: string;
  token: string;
  /** Every request a tab received (bridge.status excluded). */
  requests: Array<{ method: string; params: Record<string, unknown> | undefined }>;
  /** `Origin` header of each agent connection (undefined = none sent). */
  origins: Array<string | undefined>;
  connections: number;
  /** Replace what the tab answers (default: the fake tab below). */
  handler: Handler;
  /** No tab connected: everything but bridge.status answers `no_session`. */
  noTab: boolean;
  close: () => Promise<void>;
}

interface FakeTab {
  readonly doc: Doc;
  /** `edit` or `viewer`. */
  view: string;
  handle: Handler;
}

/** A fake tab holding the playground starter: etags count versions, `apply` / `connect` check them. */
function fakeTab(): FakeTab {
  let doc: Doc = createPlaygroundDocument();
  let version = 1;
  const etag = () => `tab.${version}`;
  const tab: FakeTab = {
    get doc() {
      return doc;
    },
    view: 'edit',
    handle: ((method, params) => {
      switch (method) {
        case 'state':
          return {
            etag: etag(),
            document: doc,
            tab: tab.view,
            save: { status: 'saved', revision: version, dirty: false },
            selectedId: null,
            busy: null,
            connections: { sim: { provider: 'holodeck.sim', state: 'live' } },
            ...(params?.metrics === false ? {} : { metrics: { 'tank-1': { level: 42 } } }),
          };
        case 'apply': {
          if (tab.view !== 'edit') throw Object.assign(new Error('viewer'), { code: 'viewer' });
          if (params?.etag !== etag()) throw Object.assign(new Error('the playground scene changed since it was read'), { code: 'conflict', problems: ['read it again'] });
          doc = { ...doc, body: params.scene as Doc['body'] };
          version += 1;
          return { etag: etag(), document: doc };
        }
        case 'connect': {
          const c = params?.connection as NonNullable<Doc['connections']>[number];
          doc = { ...doc, connections: [...(doc.connections ?? []).filter((x) => x.id !== c.id), c] };
          version += 1;
          return { etag: etag(), document: doc };
        }
        case 'browse':
          return { nodes: [{ path: 'tanks', label: 'Tanks', hasChildren: true }], truncated: false };
        case 'screenshot': {
          const png = new PNG({ width: 4, height: 3 });
          png.data.fill(200);
          return { mimeType: 'image/png', data: PNG.sync.write(png).toString('base64'), width: 4, height: 3 };
        }
        default:
          throw Object.assign(new Error(`unknown method "${method}"`), { code: 'invalid' });
      }
    }) as Handler,
  };
  return tab;
}

async function startFakeBridge(dir: string, handler: Handler, token = 'agent-token-1'): Promise<FakeBridge> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((done) => wss.once('listening', () => done()));
  const port = (wss.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}/`;
  const file = join(dir, '.holodeck-mcp.json');
  const fake: FakeBridge = {
    file,
    url,
    token,
    requests: [],
    origins: [],
    connections: 0,
    handler,
    noTab: false,
    close: () => new Promise<void>((done) => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => done());
    }),
  };
  wss.on('connection', (ws: WebSocket, req) => {
    const q = new URL(req.url ?? '/', 'ws://x').searchParams;
    fake.origins.push(req.headers.origin);
    if (q.get('role') !== 'agent' || q.get('token') !== fake.token) return ws.close();
    fake.connections += 1;
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { id: string; method: string; params?: Record<string, unknown> };
      const reply = (body: Record<string, unknown>) => ws.send(JSON.stringify({ type: 'response', id: msg.id, ...body }));
      if (msg.method === 'bridge.status') {
        return reply({ ok: true, result: { protocol: 1, sessions: fake.noTab ? [] : [{ documentId: 'playground', documentName: 'Playground', tab: 'edit', sessionId: 's1' }] } });
      }
      if (fake.noTab) return reply({ ok: false, error: { message: 'no playground tab is connected', code: 'no_session' } });
      fake.requests.push({ method: msg.method, params: msg.params });
      try {
        reply({ ok: true, result: fake.handler(msg.method, msg.params) });
      } catch (error) {
        const e = error as Error & { code?: string; problems?: string[] };
        reply({ ok: false, error: { message: e.message, code: e.code, ...(e.problems ? { problems: e.problems } : {}) } });
      }
    });
  });
  await writeFile(file, JSON.stringify({ protocol: 1, url, token, pid: process.pid, studio: 'http://localhost:5173/playground', startedAt: new Date().toISOString() }));
  return fake;
}

let h: Harness;
let tab: FakeTab;
let bridge: FakeBridge;
let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  tab = fakeTab();
  bridge = await startFakeBridge(dir, tab.handle);
  h = await harness({ bridge: new PlaygroundBridge({ file: bridge.file, timeoutMs: 2_000 }) });
});
afterEach(async () => {
  await h.close();
  await bridge.close();
  await cleanup();
});

const applies = () => bridge.requests.filter((r) => r.method === 'apply');

describe('parseBridgeFile', () => {
  const good = { protocol: 1, url: 'ws://127.0.0.1:4321/', token: 't', pid: 1, studio: null, startedAt: '' };
  it('accepts a loopback bridge file', () => {
    expect(parseBridgeFile(JSON.stringify(good), 'f').url).toBe(good.url);
  });
  it.each([
    ['not JSON', '{'],
    ['no token', JSON.stringify({ ...good, token: '' })],
    ['another protocol', JSON.stringify({ ...good, protocol: 2 })],
    ['a remote host', JSON.stringify({ ...good, url: 'ws://evil.example:4321/' })],
    ['localhost by name (only 127.0.0.1 is written)', JSON.stringify({ ...good, url: 'ws://localhost:4321/' })],
    ['wss / a path', JSON.stringify({ ...good, url: 'ws://127.0.0.1:4321/x' })],
  ])('refuses %s with no_bridge', (_what, text) => {
    expect(() => parseBridgeFile(text, 'f')).toThrow(expect.objectContaining({ code: 'no_bridge' }));
  });
});

describe('playground_status', () => {
  it('reports the running bridge and its tab', async () => {
    const r = await h.call('playground_status');
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({ running: true, connected: true, url: bridge.url, studio: 'http://localhost:5173/playground' });
    expect(r.data.sessions).toEqual([expect.objectContaining({ documentId: 'playground', tab: 'edit' })]);
  });

  it('connects with the agent token and no Origin header (as no browser can)', async () => {
    await h.call('playground_status');
    expect(bridge.connections).toBe(1);
    expect(bridge.origins).toEqual([undefined]);
    // One socket is reused while the file names the same bridge.
    await h.call('playground_status');
    await h.call('playground_state');
    expect(bridge.connections).toBe(1);
  });

  it('is not an error when nothing runs (no file), with a hint', async () => {
    await rm(bridge.file);
    const r = await h.call('playground_status');
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({ running: false });
    expect(String(r.data.hints)).toMatch(/pnpm playground/);
  });

  it('a stale file (bridge stopped) reads as not running', async () => {
    await bridge.close();
    const r = await h.call('playground_status');
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({ running: false });
    expect(String(r.data.reason)).toMatch(/not reachable/);
  });

  it('says when the bridge runs but no tab is open', async () => {
    bridge.noTab = true;
    const r = await h.call('playground_status');
    expect(r.data).toMatchObject({ running: true, connected: false });
    expect(String(r.data.hints)).toMatch(/open the playground page/);
  });

  it('follows a restarted bridge (new port and token in the file)', async () => {
    await h.call('playground_status');
    const second = await startFakeBridge(dir, tab.handle, 'agent-token-2');
    try {
      const r = await h.call('playground_state');
      expect(r.isError, r.text).toBe(false);
      expect(second.connections).toBe(1);
    } finally {
      await second.close();
    }
  });
});

describe('playground_state / playground_screenshot', () => {
  it('summarises the live scene with its etag, tab, save status and live values', async () => {
    const r = await h.call('playground_state');
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({ path: PLAYGROUND_PATH, etag: 'tab.1', tab: 'edit', busy: null, metrics: { 'tank-1': { level: 42 } } });
    expect((r.data.objects as unknown[]).length).toBe(tab.doc.body.objects.length);
    expect(r.data.connectionStates).toEqual({ sim: { provider: 'holodeck.sim', state: 'live' } });
  });

  it('full view returns the document; metrics:false leaves the values out', async () => {
    const r = await h.call('playground_state', { view: 'full', metrics: false });
    expect((r.data.document as Doc).id).toBe(tab.doc.id);
    expect(r.data.metrics).toBeUndefined();
    expect(bridge.requests.at(-1)).toEqual({ method: 'state', params: { metrics: false } });
  });

  it('no tab: an error naming what to do', async () => {
    bridge.noTab = true;
    const r = await h.call('playground_state');
    expect(r.isError).toBe(true);
    expect(r.data.error?.code).toBe('no_session');
  });

  it('no bridge file: no_bridge, pointing at pnpm playground and at document files', async () => {
    await rm(bridge.file);
    const r = await h.call('playground_state');
    expect(r.data.error?.code).toBe('no_bridge');
    expect(r.text).toMatch(/pnpm playground/);
    expect(r.text).toMatch(/pass path/);
  });

  it('screenshot returns the tab image and can write it (tier author)', async () => {
    const r = await h.client.callTool({ name: 'playground_screenshot', arguments: { scale: 2, out: 'shots/live.png' } });
    expect(r.isError).toBeFalsy();
    const content = r.content as Array<{ type: string; mimeType?: string }>;
    expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(bridge.requests.at(-1)).toEqual({ method: 'screenshot', params: { scale: 2 } });
    const written = await readFile(join(h.dir, 'shots/live.png'));
    expect(PNG.sync.read(written).width).toBe(4);
  });

  it('screenshot refuses to write at tier read', async () => {
    const ro = await harness({ tier: 'read', bridge: new PlaygroundBridge({ file: bridge.file }) });
    try {
      const r = await ro.call('playground_screenshot', { out: 'x.png' });
      expect(r.data.error?.code).toBe('tier');
    } finally {
      await ro.close();
    }
  });
});

describe('scene tools on @playground', () => {
  it('scene_add_object applies ONE edit, based on the etag it read, and returns the new etag', async () => {
    const before = tab.doc.body.objects.length;
    const r = await h.call('scene_add_object', { path: PLAYGROUND_PATH, part: 'valve', x: 30, y: 30 });
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({ path: PLAYGROUND_PATH, etag: 'tab.2', objectCount: before + 1 });
    expect(applies()).toHaveLength(1);
    expect(applies()[0]!.params!.etag).toBe('tab.1');
    expect(tab.doc.body.objects).toHaveLength(before + 1);
    expect(tab.doc.body.objects.at(-1)).toMatchObject({ object: 'valve', x: 30, y: 30 });
  });

  it('scene_open @playground makes it the default target', async () => {
    const opened = await h.call('scene_open', { path: PLAYGROUND_PATH });
    expect(opened.isError, opened.text).toBe(false);
    expect(opened.data).toMatchObject({ path: PLAYGROUND_PATH, id: tab.doc.id });
    const id = tab.doc.body.objects[0]!.id;
    const moved = await h.call('scene_move', { id, x: 40, y: 41 });
    expect(moved.isError, moved.text).toBe(false);
    expect(tab.doc.body.objects.find((o) => o.id === id)).toMatchObject({ x: 40, y: 41 });
    const got = await h.call('scene_get', { objectIds: [id] });
    expect(got.data.path).toBe(PLAYGROUND_PATH);
  });

  it('an edit based on a stale etag is refused before anything is sent', async () => {
    const r = await h.call('scene_add_object', { path: PLAYGROUND_PATH, etag: 'tab.0', part: 'valve', x: 30, y: 30 });
    expect(r.data.error?.code).toBe('conflict');
    expect(applies()).toHaveLength(0);
  });

  it('the user editing between read and apply: the tab refuses (conflict) and nothing changes', async () => {
    const original = tab.handle;
    bridge.handler = (method, params) => (method === 'apply' ? original(method, { ...params, etag: 'stale' }) : original(method, params));
    const r = await h.call('scene_add_object', { path: PLAYGROUND_PATH, part: 'valve', x: 30, y: 30 });
    expect(r.data.error).toMatchObject({ code: 'conflict', problems: ['read it again'] });
  });

  it('an invalid edit is refused by the server, never sent to the tab', async () => {
    const id = tab.doc.body.objects[0]!.id;
    const r = await h.call('scene_bind', { path: PLAYGROUND_PATH, id, param: 'level', binding: { connection: 'nope', source: 'sine:1:0:1' } });
    expect(r.isError).toBe(true);
    expect(applies()).toHaveLength(0);
  });

  it('Viewer tab: the tab\'s refusal reaches the agent with its code', async () => {
    tab.view = 'viewer';
    const r = await h.call('scene_add_object', { path: PLAYGROUND_PATH, part: 'valve', x: 30, y: 30 });
    expect(r.data.error?.code).toBe('viewer');
  });

  it('concurrent edits apply one after another', async () => {
    const [a, b] = await Promise.all([
      h.call('scene_add_object', { path: PLAYGROUND_PATH, part: 'valve', x: 30, y: 30 }),
      h.call('scene_add_object', { path: PLAYGROUND_PATH, part: 'valve', x: 34, y: 30 }),
    ]);
    expect(a.isError, a.text).toBe(false);
    expect(b.isError, b.text).toBe(false);
    expect(applies().map((r) => r.params!.etag)).toEqual(['tab.1', 'tab.2']);
  });

  it('scene_validate / scene_export read the live document', async () => {
    const v = await h.call('scene_validate', { path: PLAYGROUND_PATH });
    expect(v.data).toMatchObject({ valid: true });
    const e = await h.call('scene_export', { path: PLAYGROUND_PATH, format: 'components-csv' });
    expect(String(e.data.text)).toMatch(/tank/);
  });

  it('scene_new cannot create @playground', async () => {
    const r = await h.call('scene_new', { path: PLAYGROUND_PATH });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/always exists/);
  });
});

describe('provider tools', () => {
  it('provider_list shows ids, config schemas and secret names (never values)', async () => {
    const r = await h.call('provider_list');
    const list = r.data.providers as Array<{ id: string; secrets: Array<{ key: string }> }>;
    expect(list.map((p) => p.id)).toEqual(expect.arrayContaining(['holodeck.sim', 'holodeck.http']));
  });

  it('provider_connect adds and replaces a connection in a file', async () => {
    await h.call('scene_new', { path: 'a.holodeck.json' });
    const added = await h.call('provider_connect', { connection: { id: 'sim2', provider: 'holodeck.sim', label: 'Sim' } });
    expect(added.isError, added.text).toBe(false);
    expect(added.data).toMatchObject({ replaced: false });
    const again = await h.call('provider_connect', { etag: added.data.etag, connection: { id: 'sim2', provider: 'holodeck.sim', label: 'Renamed' } });
    expect(again.data).toMatchObject({ replaced: true });
    const doc = JSON.parse(await readFile(join(h.dir, 'a.holodeck.json'), 'utf8'));
    expect(doc.connections).toEqual([{ id: 'sim2', provider: 'holodeck.sim', label: 'Renamed' }]);
  });

  it('provider_connect refuses credentials in the config and unknown providers', async () => {
    await h.call('scene_new', { path: 'a.holodeck.json' });
    const secret = await h.call('provider_connect', {
      connection: { id: 'api', provider: 'holodeck.http', config: { url: 'https://example.com/data', headers: { Authorization: 'Bearer abc' } } },
    });
    expect(secret.data.error?.code).toBe('invalid_connection');
    const password = await h.call('provider_connect', { connection: { id: 'x', provider: 'holodeck.sim', config: { password: 'hunter2' } } });
    expect(password.data.error?.code).toBe('invalid_connection');
    const unknown = await h.call('provider_connect', { connection: { id: 'x', provider: 'no.such' } });
    expect(unknown.data.error?.code).toBe('not_found');
    const doc = JSON.parse(await readFile(join(h.dir, 'a.holodeck.json'), 'utf8'));
    expect(doc.connections ?? []).toEqual([]);
  });

  it('provider_connect on @playground goes to the tab', async () => {
    const r = await h.call('provider_connect', { path: PLAYGROUND_PATH, connection: { id: 'sim2', provider: 'holodeck.sim' } });
    expect(r.isError, r.text).toBe(false);
    expect(bridge.requests.at(-1)).toEqual({ method: 'connect', params: { connection: { id: 'sim2', provider: 'holodeck.sim' } } });
    expect(tab.doc.connections?.map((c) => c.id)).toContain('sim2');
  });

  it('provider_browse lists a simulator connection of a file in-process', async () => {
    await h.call('scene_new', { path: 's.holodeck.json', template: 'starter' });
    const r = await h.call('provider_browse', { connection: PLAYGROUND_CONNECTION_ID });
    expect(r.isError, r.text).toBe(false);
    expect((r.data.nodes as unknown[]).length).toBeGreaterThan(0);
    expect(r.data.truncated).toBe(false);
  });

  it('provider_browse on a file refuses network providers (use the playground) and unknown connections', async () => {
    await h.call('scene_new', { path: 'a.holodeck.json' });
    await h.call('provider_connect', { connection: { id: 'api', provider: 'holodeck.http', config: { url: 'https://example.com/data' } } });
    const net = await h.call('provider_browse', { connection: 'api' });
    expect(net.data.error?.code).toBe('needs_playground');
    const missing = await h.call('provider_browse', { connection: 'nope' });
    expect(missing.data.error?.code).toBe('not_found');
  });

  it('provider_browse on @playground asks the tab', async () => {
    const r = await h.call('provider_browse', { path: PLAYGROUND_PATH, connection: 'sim', signalPath: 'tanks' });
    expect(r.data).toMatchObject({ nodes: [{ path: 'tanks', label: 'Tanks', hasChildren: true }], truncated: false });
    expect(bridge.requests.at(-1)).toEqual({ method: 'browse', params: { connection: 'sim', path: 'tanks' } });
  });
});
