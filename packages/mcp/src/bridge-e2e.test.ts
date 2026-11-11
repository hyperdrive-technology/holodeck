/**
 * The whole playground bridge chain: the studio's production build under
 * `vite preview` with the bridge on (HOLODECK_MCP_BRIDGE=1), a real Chromium
 * tab on /playground, and this server's tools over the bridge file the plugin
 * writes. An agent's `scene_add_object` must land in the live page as ONE
 * undo step, and `playground_state` / `playground_screenshot` must read the
 * page back.
 *
 * Needs the studio build (apps/studio: pnpm build) and a Chromium
 * (findChromium); skips cleanly without them locally, fails on CI (holodeck#280).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PlaygroundBridge, PLAYGROUND_PATH } from './playground';
import { defaultStudioDist, findChromium } from './render';
import { harness, tempDir, type Harness } from './test-support';

const dist = defaultStudioDist();
const studio = dirname(dist);
const vite = join(studio, 'node_modules', 'vite', 'bin', 'vite.js');
let chromiumPath: string | null = null;
try {
  chromiumPath = findChromium();
} catch {
  chromiumPath = null;
}
const ready = chromiumPath !== null && existsSync(join(dist, 'index.html')) && existsSync(vite);
const BOOT_TIMEOUT_MS = 60_000;

/** process.env without the test runner's own variables. */
function plainEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('VITEST') || key === 'NODE_ENV' || key === 'TEST') delete env[key];
  return env;
}

/** A free loopback port (vite preview needs a fixed one for --strictPort). */
const freePort = () =>
  new Promise<number>((done, failed) => {
    const server = createServer();
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });

/** Resolve when `check` is true, re-checking after each `step` ms; reject at `timeoutMs`. Waits on state, never a fixed sleep. */
async function until(what: string, check: () => Promise<boolean> | boolean, timeoutMs = BOOT_TIMEOUT_MS, step = 100) {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((d) => setTimeout(d, step));
  }
}

// On CI (the studio job, after its build and Chrome steps) a missing
// prerequisite fails instead of skipping the chain silently (holodeck#280).
it.runIf(!!process.env.CI)('CI has the studio build, vite and a Chromium for the bridge e2e', () => {
  expect({ chromium: chromiumPath !== null, build: existsSync(join(dist, 'index.html')), vite: existsSync(vite) }).toEqual({ chromium: true, build: true, vite: true });
});

describe.skipIf(!ready)('playground bridge end to end (studio build + Chromium)', () => {
  let preview: ChildProcess;
  let output = '';
  const log: string[] = [];
  let browser: Browser;
  let page: Page;
  let h: Harness;
  let cleanup: () => Promise<void>;
  let file: string;

  beforeAll(async () => {
    let dir: string;
    ({ dir, cleanup } = await tempDir());
    file = join(dir, '.holodeck-mcp.json');
    const port = await freePort();
    preview = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], {
      cwd: studio,
      // Not vitest's own variables (NODE_ENV=test, VITEST...): the child is a plain `vite preview`.
      env: { ...plainEnv(), HOLODECK_MCP_BRIDGE: '1', HOLODECK_MCP_BRIDGE_FILE: file },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    preview.stdout!.on('data', (d) => (output += String(d)));
    preview.stderr!.on('data', (d) => (output += String(d)));
    await until('the bridge file', () => existsSync(file)).catch((error: Error) => {
      throw new Error(`${error.message}; vite preview said:\n${output.slice(-2000)}`);
    });
    browser = await chromium.launch({ executablePath: chromiumPath!, headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // GPU-free on purpose, like the studio's own e2e suites (apps/studio/e2e/studio.spec.ts):
    // headless WebGPU on a busy machine takes seconds per frame and starved
    // the page's main thread here, so bridge requests went unanswered (seen
    // 2026-11-11 at load ~15; a plain node script on the same machine passed).
    // Without `navigator.gpu` the editor keeps all editing state; pixels are
    // covered by scene_render's tests on the real build.
    await page.addInitScript(() => {
      delete (Navigator.prototype as { gpu?: unknown }).gpu;
    });
    // What the page did, printed when a step fails.
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && log.push(`console: ${m.text().slice(0, 300)}`));
    page.on('websocket', (ws) => {
      ws.on('framesent', (f) => log.push(`tab-> ${String(f.payload).slice(0, 120)}`));
      ws.on('framereceived', (f) => log.push(`tab<- ${String(f.payload).slice(0, 120)}`));
      ws.on('close', () => log.push('tab socket closed'));
    });
    await page.goto(`http://localhost:${port}/playground`);
    // The tab registered with the bridge (the header shows it).
    await page
      .getByTestId('playground-agent')
      .waitFor({ timeout: BOOT_TIMEOUT_MS })
      .catch((error: Error) => {
        throw new Error(`${error.message}\npage log:\n${log.join('\n')}\nvite preview said:\n${output.slice(-2000)}`);
      });
    h = await harness({ bridge: new PlaygroundBridge({ file }) });
  }, 120_000);

  afterEach((ctx) => {
    if (ctx.task.result?.state === 'fail') console.error(`page log:\n${log.slice(-60).join('\n')}`);
    log.length = 0;
  });

  afterAll(async () => {
    await h?.close();
    await browser?.close();
    if (preview && preview.exitCode === null) {
      const exited = new Promise((done) => preview.once('exit', done));
      preview.kill('SIGKILL');
      await exited;
    }
    await cleanup?.();
  });

  it('writes the agent file with a loopback url, and lists the tab', async () => {
    const written = JSON.parse(await readFile(file, 'utf8'));
    expect(written.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/$/);
    const r = await h.call('playground_status');
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({ running: true, connected: true });
    expect(r.data.sessions).toEqual([expect.objectContaining({ documentId: 'playground', tab: 'edit' })]);
  });

  it('scene_add_object lands in the live page as one undo step', async () => {
    const before = await h.call('playground_state', { metrics: false });
    expect(before.isError, before.text).toBe(false);
    const count = before.data.objectCount as number;
    const revision = Number(await page.getByTestId('canvas').getAttribute('data-revision'));

    const added = await h.call('scene_add_object', { path: PLAYGROUND_PATH, etag: before.data.etag, part: 'valve', x: 40, y: 40 });
    expect(added.isError, added.text).toBe(false);
    const id = (added.data.added as string[])[0]!;

    const after = await h.call('playground_state', { metrics: false });
    expect(after.data.objectCount).toBe(count + 1);
    expect((after.data.objects as Array<{ id: string }>).map((o) => o.id)).toContain(id);
    expect(after.data.etag).toBe(added.data.etag);
    // The page autosaved the agent's edit like any edit.
    await until('the autosave', async () => Number(await page.getByTestId('canvas').getAttribute('data-revision')) > revision, 30_000);

    // One Undo in the page removes exactly the agent's edit.
    await page.getByRole('button', { name: 'Undo' }).click();
    await until('the undo', async () => ((await h.call('playground_state', { metrics: false })).data.objectCount as number) === count, 10_000);
    const undone = await h.call('playground_state', { metrics: false });
    expect((undone.data.objects as Array<{ id: string }>).map((o) => o.id)).not.toContain(id);
  });

  it('an edit from a stale read is refused with conflict', async () => {
    const read = await h.call('playground_state', { metrics: false });
    const first = await h.call('scene_add_object', { path: PLAYGROUND_PATH, etag: read.data.etag, part: 'valve', x: 44, y: 40 });
    expect(first.isError, first.text).toBe(false);
    const stale = await h.call('scene_add_object', { path: PLAYGROUND_PATH, etag: read.data.etag, part: 'valve', x: 48, y: 40 });
    expect(stale.data.error?.code).toBe('conflict');
  });

  it('playground_screenshot without WebGPU is an explicit error, never a blank image', async () => {
    const r = (await h.client.callTool({ name: 'playground_screenshot', arguments: {} })) as CallToolResult;
    const text = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    expect(r.isError, text).toBe(true);
    expect(r.content.some((c) => c.type === 'image')).toBe(false);
    expect((r.structuredContent as { error: { code: string } }).error.code).toBe('unsupported');
  });
});
