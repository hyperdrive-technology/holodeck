/**
 * scene_render. Three layers:
 *  - the loopback static server and the flat-image check (no browser);
 *  - the capture protocol against a FAKE studio build (a page that plays the
 *    /render route's signals), so ready / unsupported / invalid / blank /
 *    timeout are each exercised deterministically in a real Chromium;
 *  - the real studio build (apps/studio/dist), when it and a Chromium exist.
 * Browser tests skip cleanly without a Chromium (findChromium); on CI the
 * studio job sets HOLODECK_CHROMIUM, so they run there. The browser
 * lifecycle (crash, relaunch, close with renders pending) and the image size
 * cap are also covered by a FAKE browser (`launch` option), so they run
 * everywhere and deterministically.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { MAX_IMAGE_BYTES } from './limits';
import { defaultStudioDist, findChromium, isUniform, MAX_SIDE, SceneRenderer, serveStatic } from './render';
import { harness, tempDir } from './test-support';

const solid = (w: number, h: number, rgba: [number, number, number, number]) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) png.data.set(rgba, i);
  return PNG.sync.write(png);
};

describe('serveStatic', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let base: string;
  let close: () => void;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><p>app</p>');
    await writeFile(join(dir, 'assets', 'a.js'), 'export {}');
    const served = await serveStatic(dir);
    base = served.baseUrl;
    close = () => served.server.close();
  });
  afterAll(async () => {
    close();
    await cleanup();
  });

  it('binds to loopback and serves files with their content type', async () => {
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const js = await fetch(`${base}/assets/a.js`);
    expect(js.headers.get('content-type')).toContain('text/javascript');
    expect(await js.text()).toBe('export {}');
  });

  it('client routes fall back to index.html; missing assets are 404', async () => {
    expect(await (await fetch(`${base}/render`)).text()).toContain('app');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('never serves outside its folder; only GET / HEAD', async () => {
    for (const p of ['/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/hosts.txt', '/assets/..%2f..%2f..%2fx.js']) {
      expect((await fetch(`${base}${p}`)).status, p).toBe(404);
    }
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('isUniform', () => {
  it('tells a flat image from one with anything drawn', () => {
    expect(isUniform(solid(8, 8, [255, 255, 255, 255]))).toBe(true);
    const drawn = PNG.sync.read(solid(8, 8, [255, 255, 255, 255]));
    drawn.data.set([0, 0, 0, 255], 4 * 27);
    expect(isUniform(PNG.sync.write(drawn))).toBe(false);
  });
});

// HOLODECK_SKIP_RENDER_TESTS=1 is the repo-wide opt-out for browser tests (scripts/ci-package.sh,
// dev-check.sh). Without this check findChromium() falls back to the macOS Chrome and the browser
// tests ran anyway on a Mac (dev-check full, 2026-11-12).
let chromiumPath: string | null = null;
try {
  chromiumPath = process.env.HOLODECK_SKIP_RENDER_TESTS === '1' ? null : findChromium();
} catch {
  chromiumPath = null;
}

/** A stand-in studio build: /render plays the route's signals, chosen by the document's name. */
const FAKE_INDEX = `<!doctype html><html><body style="margin:0"><script>
const doc = window.__HOLODECK_RENDER__;
const mode = doc && doc.name;
const root = document.createElement('div');
root.setAttribute('data-testid', 'render');
root.style.cssText = 'width:100vw;height:100vh;background:#fff';
document.body.appendChild(root);
if (!doc) root.setAttribute('data-render-input', 'missing');
else if (mode === 'invalid') {
  root.setAttribute('data-render-input', 'invalid');
  root.innerHTML = '<ul data-testid="render-problems"><li>body.objects: must be an array</li></ul>';
} else {
  root.setAttribute('data-render-input', 'ok');
  const ed = document.createElement('div');
  ed.setAttribute('data-testid', 'process-editor');
  ed.setAttribute('data-render-state', 'pending');
  root.appendChild(ed);
  if (mode === 'ready') {
    ed.style.cssText = 'width:100%;height:100%;background:linear-gradient(90deg,#c0392b,#2980b9)';
    setTimeout(() => ed.setAttribute('data-render-state', 'ready'), 50);
  } else if (mode === 'noise') {
    // Random pixels do not compress: a big PNG (the inline image cap).
    const c = document.createElement('canvas');
    c.width = innerWidth;
    c.height = innerHeight;
    c.style.cssText = 'display:block';
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 256;
      img.data[i + 1] = Math.random() * 256;
      img.data[i + 2] = Math.random() * 256;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    ed.appendChild(c);
    setTimeout(() => ed.setAttribute('data-render-state', 'ready'), 50);
  } else if (mode === 'blank') setTimeout(() => ed.setAttribute('data-render-state', 'ready'), 50);
  else if (mode === 'unsupported') ed.setAttribute('data-render-state', 'unsupported');
}
</script></body></html>`;

describe.skipIf(!chromiumPath)('SceneRenderer (fake studio build, real Chromium)', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let renderer: SceneRenderer;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
    await writeFile(join(dir, 'index.html'), FAKE_INDEX);
    renderer = new SceneRenderer({ studioDist: dir, chromium: chromiumPath, timeoutMs: 3000 });
  });
  afterAll(async () => {
    await renderer.close();
    expect(renderer.running).toBe(false);
    await cleanup();
  });

  const refusal = async (name: string) => {
    try {
      await renderer.render({ name }, { width: 200, height: 120 });
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      return error as ToolError;
    }
    throw new Error('expected a refusal');
  };

  it('ready: a PNG of the viewport size with something in it', async () => {
    const png = await renderer.render({ name: 'ready' }, { width: 200, height: 120 });
    const decoded = PNG.sync.read(png);
    expect([decoded.width, decoded.height]).toEqual([200, 120]);
    expect(isUniform(png)).toBe(false);
    expect(renderer.running).toBe(true);
  });

  it('unsupported (no WebGPU) is an explicit error, not an image', async () => {
    expect((await refusal('unsupported')).code).toBe('unsupported');
  });

  it('a document the studio refuses returns its problems', async () => {
    const error = await refusal('invalid');
    expect(error.code).toBe('invalid_document');
    expect(error.problems).toEqual(['body.objects: must be an array']);
  });

  it('a flat capture is refused as blank', async () => {
    expect((await refusal('blank')).code).toBe('blank_image');
  });

  it('a canvas that never becomes ready times out with its last state', async () => {
    const error = await refusal('hang');
    expect(error.code).toBe('timeout');
    expect(error.problems[0]).toContain('pending');
  });

  it('renders run one at a time and the browser is reused', async () => {
    const [a, b] = await Promise.all([renderer.render({ name: 'ready' }, { width: 100, height: 100 }), renderer.render({ name: 'ready' }, { width: 120, height: 90 })]);
    expect(PNG.sync.read(a).width).toBe(100);
    expect(PNG.sync.read(b).width).toBe(120);
  });

  it('refuses sizes outside the bounds before starting anything', () => {
    expect(() => renderer.render({ name: 'ready' }, { width: 10, height: 100 })).toThrow(ToolError);
    expect(() => renderer.render({ name: 'ready' }, { width: 100, height: 4096 })).toThrow(ToolError);
  });

  it('closes an idle browser by itself', async () => {
    const quick = new SceneRenderer({ studioDist: dir, chromium: chromiumPath, idleCloseMs: 50 });
    await quick.render({ name: 'ready' }, { width: 100, height: 100 });
    await expect.poll(() => quick.running, { timeout: 5000 }).toBe(false);
    await quick.close();
  });

  it('a browser that goes away between renders is relaunched (#270)', async () => {
    const { launch, browsers } = spyLauncher();
    const r = new SceneRenderer({ studioDist: dir, chromium: chromiumPath, timeoutMs: 3000, launch });
    try {
      await r.render({ name: 'ready' }, { width: 100, height: 100 });
      await browsers[0]!.close(); // as a crash or a cleanup script would: 'disconnected' fires
      await expect.poll(() => r.running).toBe(false);
      const png = await r.render({ name: 'ready' }, { width: 110, height: 100 });
      expect(PNG.sync.read(png).width).toBe(110);
      expect(browsers).toHaveLength(2);
    } finally {
      await r.close();
    }
    expect(browsers.every((b) => !b.isConnected())).toBe(true);
  });

  it('close() aborts the capture in progress and refuses the queued ones (#273)', async () => {
    const { launch, browsers } = spyLauncher();
    const r = new SceneRenderer({ studioDist: dir, chromium: chromiumPath, timeoutMs: 60_000, launch });
    const hanging = r.render({ name: 'hang' }, { width: 100, height: 100 });
    const queued = r.render({ name: 'ready' }, { width: 100, height: 100 });
    hanging.catch(() => undefined);
    queued.catch(() => undefined);
    await expect.poll(() => browsers.length, { timeout: 15_000 }).toBe(1);
    await new Promise((ok) => setTimeout(ok, 300)); // the capture is waiting on the canvas
    const started = Date.now();
    await r.close();
    expect(Date.now() - started).toBeLessThan(10_000); // not the 60 s render timeout
    await expect(hanging).rejects.toMatchObject({ code: 'closed' });
    await expect(queued).rejects.toMatchObject({ code: 'closed' });
    expect(browsers).toHaveLength(1);
    expect(browsers[0]!.isConnected()).toBe(false);
    expect(r.running).toBe(false);
  });
});

/** Real Playwright launches, recorded so a test can kill a browser. */
function spyLauncher(): { launch: (exe: string, args: readonly string[]) => Promise<Browser>; browsers: Browser[] } {
  const browsers: Browser[] = [];
  return {
    browsers,
    launch: async (executablePath, args) => {
      const { chromium } = await import('playwright-core');
      const b = await chromium.launch({ executablePath, headless: true, args: [...args] });
      browsers.push(b);
      return b;
    },
  };
}

// ---------------------------------------------------------------------------
// A fake browser: just the Playwright surface SceneRenderer uses. A document
// named 'ready' renders a small drawn PNG, 'big' a PNG over MAX_IMAGE_BYTES,
// anything else hangs until its context is closed.

const CLOSED = 'Target page, context or browser has been closed';

const drawnPng = (() => {
  const png = PNG.sync.read(solid(8, 8, [255, 255, 255, 255]));
  png.data.set([0, 0, 0, 255], 0);
  return PNG.sync.write(png);
})();

/** Random RGBA does not compress, so 1024 x 1024 is ~4 MB of PNG. */
const bigPng = (() => {
  const png = new PNG({ width: 1024, height: 1024 });
  let seed = 1;
  for (let i = 0; i < png.data.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    png.data[i] = seed >>> 24;
  }
  return PNG.sync.write(png);
})();

class FakeContext {
  closed = false;
  private onClose: Array<() => void> = [];
  constructor(private readonly browser: FakeBrowser) {}
  check(): void {
    if (this.closed || !this.browser.isConnected()) throw new Error(CLOSED);
  }
  whenClosed(fn: () => void): void {
    if (this.closed) fn();
    else this.onClose.push(fn);
  }
  async newPage(): Promise<FakePage> {
    this.check();
    return new FakePage(this);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.onClose.splice(0)) fn();
  }
}

class FakePage {
  private doc: { name?: string } | undefined;
  constructor(private readonly context: FakeContext) {}
  on(): void {}
  async addInitScript(_fn: unknown, arg: { value: { name?: string } }): Promise<void> {
    this.doc = arg.value;
  }
  async goto(): Promise<void> {
    this.context.check();
  }
  waitForFunction(): Promise<{ jsonValue: () => Promise<unknown> }> {
    this.context.check();
    const name = this.doc?.name;
    if (name === 'ready' || name === 'big') return Promise.resolve({ jsonValue: async () => ({ state: 'ready', problems: [] }) });
    return new Promise((_ok, fail) => this.context.whenClosed(() => fail(new Error(CLOSED))));
  }
  locator(): { getAttribute: () => Promise<string> } {
    return {
      getAttribute: async () => {
        this.context.check();
        return 'pending';
      },
    };
  }
  async screenshot(): Promise<Buffer> {
    this.context.check();
    return this.doc?.name === 'big' ? bigPng : drawnPng;
  }
}

class FakeBrowser {
  private connected = true;
  private contexts: FakeContext[] = [];
  private onDisconnect: Array<() => void> = [];
  contextsCreated = 0;
  on(event: string, fn: () => void): this {
    if (event === 'disconnected') this.onDisconnect.push(fn);
    return this;
  }
  isConnected(): boolean {
    return this.connected;
  }
  failNextContext = false;
  async newContext(): Promise<FakeContext> {
    if (!this.connected) throw new Error(CLOSED);
    if (this.failNextContext) {
      this.failNextContext = false;
      throw new Error('newContext failed');
    }
    this.contextsCreated++;
    const c = new FakeContext(this);
    this.contexts.push(c);
    return c;
  }
  async close(): Promise<void> {
    this.crash();
  }
  /** The process went away: every context dies, then 'disconnected' fires (unless `silent`: not delivered yet). */
  crash({ silent = false } = {}): void {
    if (!this.connected) return;
    this.connected = false;
    for (const c of this.contexts) void c.close();
    if (!silent) for (const fn of this.onDisconnect.splice(0)) fn();
  }
}

function fakeLauncher(): { launch: () => Promise<Browser>; browsers: FakeBrowser[] } {
  const browsers: FakeBrowser[] = [];
  return {
    browsers,
    launch: async () => {
      const b = new FakeBrowser();
      browsers.push(b);
      return b as unknown as Browser;
    },
  };
}

describe('SceneRenderer lifecycle (fake browser)', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
    await writeFile(join(dir, 'index.html'), FAKE_INDEX);
  });
  afterAll(async () => {
    await cleanup();
  });
  const make = (extra: { idleCloseMs?: number; timeoutMs?: number } = {}) => {
    const fake = fakeLauncher();
    const renderer = new SceneRenderer({ studioDist: dir, chromium: '/fake/chrome', launch: fake.launch, timeoutMs: 60_000, ...extra });
    return { ...fake, renderer };
  };
  const size = { width: 100, height: 100 };

  it('reuses one browser while it is alive', async () => {
    const { renderer, browsers } = make();
    await renderer.render({ name: 'ready' }, size);
    await renderer.render({ name: 'ready' }, size);
    expect(browsers).toHaveLength(1);
    expect(browsers[0]!.contextsCreated).toBe(2);
    await renderer.close();
    expect(browsers[0]!.isConnected()).toBe(false);
  });

  it('a browser that crashes between renders is dropped and relaunched (#270)', async () => {
    const { renderer, browsers } = make();
    await renderer.render({ name: 'ready' }, size);
    browsers[0]!.crash();
    expect(renderer.running).toBe(false);
    expect(await renderer.render({ name: 'ready' }, size)).toEqual(drawnPng);
    expect(browsers).toHaveLength(2);
    expect(browsers[1]!.isConnected()).toBe(true);
    await renderer.close();
    expect(browsers[1]!.isConnected()).toBe(false);
  });

  it('a crash whose disconnect event has not arrived yet still relaunches (#270)', async () => {
    const { renderer, browsers } = make();
    await renderer.render({ name: 'ready' }, size);
    browsers[0]!.crash({ silent: true });
    expect(await renderer.render({ name: 'ready' }, size)).toEqual(drawnPng);
    expect(browsers).toHaveLength(2);
    await renderer.close();
  });

  it('a crash during a capture is browser_closed, and the next render relaunches (#270)', async () => {
    const { renderer, browsers } = make();
    const hanging = renderer.render({ name: 'hang' }, size);
    await expect.poll(() => browsers[0]?.contextsCreated).toBe(1);
    browsers[0]!.crash();
    await expect(hanging).rejects.toMatchObject({ code: 'browser_closed' });
    expect(await renderer.render({ name: 'ready' }, size)).toEqual(drawnPng);
    expect(browsers).toHaveLength(2);
    await renderer.close();
  });

  it('the idle close is re-armed when opening a page fails (#270)', async () => {
    const { renderer, browsers } = make({ idleCloseMs: 50 });
    await renderer.render({ name: 'ready' }, size);
    browsers[0]!.failNextContext = true; // the browser is alive, but newContext throws
    await expect(renderer.render({ name: 'ready' }, size)).rejects.toThrow('newContext failed');
    expect(renderer.running).toBe(true);
    await expect.poll(() => renderer.running, { timeout: 5000 }).toBe(false);
    expect(browsers[0]!.isConnected()).toBe(false);
    await renderer.close();
  });

  it('close() aborts the capture in progress and refuses queued renders (#273)', async () => {
    const { renderer, browsers } = make();
    const hanging = renderer.render({ name: 'hang' }, size);
    const queued = [renderer.render({ name: 'ready' }, size), renderer.render({ name: 'ready' }, size)];
    for (const p of [hanging, ...queued]) p.catch(() => undefined);
    await expect.poll(() => browsers[0]?.contextsCreated).toBe(1);
    await renderer.close();
    await expect(hanging).rejects.toMatchObject({ code: 'closed' });
    for (const p of queued) await expect(p).rejects.toMatchObject({ code: 'closed' });
    expect(browsers).toHaveLength(1);
    expect(browsers[0]!.contextsCreated).toBe(1); // the queued renders never opened a page
    expect(browsers[0]!.isConnected()).toBe(false);
    expect(renderer.running).toBe(false);
    await expect(renderer.render({ name: 'ready' }, size)).rejects.toMatchObject({ code: 'closed' });
  });

  it('close() while the browser is still starting: nothing renders, the browser is closed (#273)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const browsers: FakeBrowser[] = [];
    const renderer = new SceneRenderer({
      studioDist: dir,
      chromium: '/fake/chrome',
      launch: async () => {
        await gate;
        const b = new FakeBrowser();
        browsers.push(b);
        return b as unknown as Browser;
      },
    });
    const pending = renderer.render({ name: 'ready' }, size);
    pending.catch(() => undefined);
    await new Promise((ok) => setTimeout(ok, 20));
    const closing = renderer.close();
    release();
    await closing;
    await expect(pending).rejects.toMatchObject({ code: 'closed' });
    expect(browsers[0]!.contextsCreated).toBe(0);
    expect(browsers[0]!.isConnected()).toBe(false);
  });
});

describe('scene_render image size cap (fake browser) (#271)', () => {
  it('a PNG over MAX_IMAGE_BYTES is too_large without `out`; with `out` it is written and only metadata returns', async () => {
    expect(bigPng.byteLength).toBeGreaterThan(MAX_IMAGE_BYTES);
    const { dir: studio, cleanup } = await tempDir();
    await writeFile(join(studio, 'index.html'), FAKE_INDEX);
    const { launch } = fakeLauncher();
    const h = await harness({ renderer: new SceneRenderer({ studioDist: studio, chromium: '/fake/chrome', launch }) });
    try {
      await h.call('scene_new', { path: 'a.holodeck.json', name: 'big' });
      const refused = await h.call('scene_render', { width: 1024, height: 1024 });
      expect(refused.isError).toBe(true);
      expect(refused.data.error?.code).toBe('too_large');
      expect(refused.data.error?.problems.join('\n')).toMatch(/`out`/);
      expect(refused.data.error?.problems.join('\n')).toMatch(/smaller width/);
      expect(refused.text.length).toBeLessThan(2000);

      const raw = await h.client.callTool({ name: 'scene_render', arguments: { width: 1024, height: 1024, out: 'shots/big.png' } });
      expect(raw.isError).toBeFalsy();
      const content = raw.content as Array<{ type: string; text?: string }>;
      expect(content.every((c) => c.type === 'text')).toBe(true);
      expect(raw.structuredContent).toMatchObject({ out: 'shots/big.png', inline: false, bytes: bigPng.byteLength });
      expect(String((raw.structuredContent as { note: string }).note)).toContain('shots/big.png');
      expect(await readFile(join(h.dir, 'shots/big.png'))).toEqual(bigPng);

      // A small render is still returned inline.
      await h.call('scene_new', { path: 'b.holodeck.json', name: 'ready' });
      const small = await h.client.callTool({ name: 'scene_render', arguments: { path: 'b.holodeck.json' } });
      expect((small.content as Array<{ type: string }>)[0]!.type).toBe('image');
    } finally {
      await h.close();
      await cleanup();
    }
  });
});

describe('SceneRenderer without prerequisites', () => {
  it('no studio build: says how to make one', async () => {
    const { dir, cleanup } = await tempDir();
    const r = new SceneRenderer({ studioDist: dir, chromium: '/bin/true' });
    await expect(r.render({}, { width: 100, height: 100 })).rejects.toMatchObject({ code: 'no_studio_build' });
    await r.close();
    await cleanup();
  });

  it('no browser: says how to get one', async () => {
    const { dir, cleanup } = await tempDir();
    await writeFile(join(dir, 'index.html'), FAKE_INDEX);
    const r = new SceneRenderer({ studioDist: dir, chromium: null });
    await expect(r.render({}, { width: 100, height: 100 })).rejects.toMatchObject({ code: 'no_browser' });
    await r.close();
    await cleanup();
  });

  it('a HOLODECK_CHROMIUM that does not exist is an error', () => {
    expect(() => findChromium({ HOLODECK_CHROMIUM: '/no/such/chrome' })).toThrow(/does not exist/);
  });
});

describe.skipIf(!chromiumPath)('scene_render tool (fake studio build)', () => {
  it('returns the PNG as image content and writes `out`; tier and path rules apply', async () => {
    const { dir: studio, cleanup } = await tempDir();
    await writeFile(join(studio, 'index.html'), FAKE_INDEX);
    const h = await harness({ renderer: new SceneRenderer({ studioDist: studio, chromium: chromiumPath, timeoutMs: 3000 }) });
    try {
      await h.call('scene_new', { path: 'a.holodeck.json', name: 'ready' });
      const raw = await h.client.callTool({ name: 'scene_render', arguments: { width: 160, height: 100, out: 'shots/a.png' } });
      const content = raw.content as Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
      expect(raw.isError).toBeFalsy();
      expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
      const png = Buffer.from(content[0]!.data!, 'base64');
      expect(PNG.sync.read(png).width).toBe(160);
      expect(await readFile(join(h.dir, 'shots/a.png'))).toEqual(png);
      expect(JSON.parse(content[1]!.text!)).toMatchObject({ out: 'shots/a.png', width: 160, height: 100 });
      expect((await h.call('scene_render', { width: 160, height: 100, out: 'shots/a.png' })).data.error?.code).toBe('conflict');
      expect((await h.call('scene_render', { out: 'shots/a.jpg' })).data.error?.code).toBe('invalid_path');
      await h.call('scene_new', { path: 'b.holodeck.json', name: 'unsupported' });
      const unsupported = await h.call('scene_render');
      expect(unsupported.isError).toBe(true);
      expect(unsupported.data.error?.code).toBe('unsupported');
    } finally {
      await h.close();
      await cleanup();
    }
  });

  it(`a busy render at MAX_SIDE (${MAX_SIDE}) is too_large inline but can be written to \`out\` (#271)`, async () => {
    const { dir: studio, cleanup } = await tempDir();
    await writeFile(join(studio, 'index.html'), FAKE_INDEX);
    const h = await harness({ renderer: new SceneRenderer({ studioDist: studio, chromium: chromiumPath, timeoutMs: 30_000 }) });
    try {
      await h.call('scene_new', { path: 'noise.holodeck.json', name: 'noise' });
      const refused = await h.call('scene_render', { width: MAX_SIDE, height: MAX_SIDE });
      expect(refused.data.error?.code).toBe('too_large');
      const written = await h.call('scene_render', { width: MAX_SIDE, height: MAX_SIDE, out: 'noise.png' });
      expect(written.isError).toBe(false);
      expect(written.data).toMatchObject({ out: 'noise.png', inline: false });
      const png = await readFile(join(h.dir, 'noise.png'));
      expect(png.byteLength).toBeGreaterThan(MAX_IMAGE_BYTES);
      expect(PNG.sync.read(png).width).toBe(MAX_SIDE);
    } finally {
      await h.close();
      await cleanup();
    }
  }, 120_000);
});

const studioBuilt = existsSync(join(defaultStudioDist(), 'index.html'));

describe.skipIf(!chromiumPath || !studioBuilt)('scene_render against the real studio build', () => {
  it('renders the playground starter, or says WebGPU is missing (never a blank image)', async () => {
    const h = await harness();
    try {
      await h.call('scene_new', { path: 'starter.holodeck.json', template: 'starter' });
      const raw = await h.client.callTool({ name: 'scene_render', arguments: { width: 800, height: 500 } });
      const content = raw.content as Array<{ type: string; data?: string; text?: string }>;
      if (raw.isError) {
        // CI has software WebGPU (SwiftShader): there "unsupported" is a failure, as in the studio's webgpu e2e.
        expect(process.env.CI, content[0]?.text).toBeFalsy();
        expect(JSON.stringify(raw.structuredContent)).toContain('"unsupported"');
        return;
      }
      const png = Buffer.from(content[0]!.data!, 'base64');
      const decoded = PNG.sync.read(png);
      expect([decoded.width, decoded.height]).toEqual([800, 500]);
      expect(isUniform(png)).toBe(false);
      if (process.env.HOLODECK_MCP_SHOTS) await writeFile(join(process.env.HOLODECK_MCP_SHOTS, 'scene-render-starter.png'), png);
    } finally {
      await h.close();
    }
  }, 180_000);
});
