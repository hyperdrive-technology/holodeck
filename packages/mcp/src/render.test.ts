/**
 * scene_render. Three layers:
 *  - the loopback static server and the flat-image check (no browser);
 *  - the capture protocol against a FAKE studio build (a page that plays the
 *    /render route's signals), so ready / unsupported / invalid / blank /
 *    timeout are each exercised deterministically in a real Chromium;
 *  - the real studio build (apps/studio/dist), when it and a Chromium exist.
 * Browser tests skip cleanly without a Chromium (findChromium); on CI the
 * studio job sets HOLODECK_CHROMIUM, so they run there.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { defaultStudioDist, findChromium, isUniform, SceneRenderer, serveStatic } from './render';
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

let chromiumPath: string | null = null;
try {
  chromiumPath = findChromium();
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
