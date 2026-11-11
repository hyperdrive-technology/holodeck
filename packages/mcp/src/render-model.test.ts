/**
 * `SceneRenderer.renderModel` (blender_preview's styled image) without Blender:
 *  - against a FAKE studio page that fetches the model URL, so the in-memory
 *    GLB route and the input shape are checked in a real Chromium;
 *  - against the real studio build with a shipped GLB (valve.glb), so the
 *    `/render` model input is exercised wherever CI has the build and a
 *    Chromium (the studio job), not only on a Mac with Blender.
 * Both skip cleanly without a Chromium.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { footprintOf, validatePartGlb } from './glb';
import { defaultRepoRoot } from './part-files';
import { defaultStudioDist, findChromium, isUniform, RENDER_MODEL_FORMAT, RENDER_MODEL_PATH, SceneRenderer } from './render';
import { tempDir } from './test-support';

let chromium: string | null = null;
try {
  chromium = findChromium();
} catch {
  chromium = null;
}
const studioBuilt = existsSync(join(defaultStudioDist(), 'index.html'));
const valve = () => readFile(join(defaultRepoRoot(), 'packages/editor-2.5d-react/assets/models/valve.glb'));

/**
 * Plays the /render model input: fetch the URL; draw and turn `ready` only when
 * a GLB arrived with the model content type, else list what arrived as problems.
 */
const FAKE_MODEL_INDEX = `<!doctype html><html><body style="margin:0"><script>
const input = window.__HOLODECK_RENDER__;
const root = document.createElement('div');
root.setAttribute('data-testid', 'render');
root.setAttribute('data-render-input', 'model');
root.style.cssText = 'width:100vw;height:100vh;background:#fff';
document.body.appendChild(root);
const ed = document.createElement('div');
ed.setAttribute('data-testid', 'process-editor');
ed.setAttribute('data-render-state', 'pending');
root.appendChild(ed);
const refuse = (what) => {
  root.setAttribute('data-render-input', 'invalid');
  root.innerHTML = '<ul data-testid="render-problems"><li></li></ul>';
  root.querySelector('li').textContent = what;
};
if (!input || input.format !== ${JSON.stringify(RENDER_MODEL_FORMAT)}) refuse('not a model input');
else fetch(input.url).then((r) => r.arrayBuffer().then((b) => {
  const seen = { status: r.status, type: r.headers.get('content-type'), bytes: b.byteLength, head: new TextDecoder().decode(new Uint8Array(b).subarray(0, 4)), footprint: input.footprint, height: input.height };
  if (seen.status !== 200 || seen.type !== 'model/gltf-binary' || seen.head !== 'glTF' || seen.footprint.w !== 2 || seen.footprint.h !== 1 || seen.height !== 0.7) return refuse(JSON.stringify(seen));
  ed.style.cssText = 'width:100%;height:100%;background:linear-gradient(90deg,#c0392b,#2980b9)';
  ed.setAttribute('data-render-state', 'ready');
}), (e) => refuse(String(e)));
</script></body></html>`;

describe.skipIf(!chromium)('renderModel against a fake studio page (real Chromium)', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let renderer: SceneRenderer;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
    await writeFile(join(dir, 'index.html'), FAKE_MODEL_INDEX);
    renderer = new SceneRenderer({ studioDist: dir, chromium, timeoutMs: 10_000 });
  });
  afterAll(async () => {
    await renderer.close();
    await cleanup();
  });

  it('hands the page the model input and answers the GLB URL from memory', async () => {
    const glb = await valve();
    // The page turns ready only after fetching a GLB with the model content type (else: invalid_document listing what it got).
    const png = await renderer.renderModel({ glb, footprint: { w: 2, h: 1 }, height: 0.7 }, { width: 240, height: 160 });
    expect(PNG.sync.read(png).width).toBe(240);
    expect(isUniform(png)).toBe(false);
    // The GLB is never written next to the studio build.
    expect(existsSync(join(dir, RENDER_MODEL_PATH))).toBe(false);
  });
});

describe.skipIf(!chromium || !studioBuilt)('renderModel against the real studio build', () => {
  it('draws a shipped GLB in the Holodeck style, or says WebGPU is missing (never a blank image)', async () => {
    const renderer = new SceneRenderer();
    try {
      const glb = await valve();
      const v = validatePartGlb(new Uint8Array(glb));
      const fp = footprintOf(v.stats!.bounds!);
      let png: Buffer;
      try {
        png = await renderer.renderModel({ glb, footprint: { w: fp.w, h: fp.h }, height: fp.height, label: 'valve' }, { width: 400, height: 300 });
      } catch (error) {
        // CI has software WebGPU (SwiftShader): there "unsupported" is a failure, as in scene_render's real-build test.
        expect(process.env.CI, String(error)).toBeFalsy();
        expect(error).toMatchObject({ code: 'unsupported' });
        return;
      }
      expect([PNG.sync.read(png).width, PNG.sync.read(png).height]).toEqual([400, 300]);
      expect(isUniform(png)).toBe(false);
      if (process.env.HOLODECK_MCP_SHOTS) await writeFile(join(process.env.HOLODECK_MCP_SHOTS, 'render-model-valve.png'), png);
    } finally {
      await renderer.close();
    }
  }, 180_000);

  it('a bad model input is refused by the route with its problems', async () => {
    const renderer = new SceneRenderer();
    try {
      await expect(renderer.render({ format: RENDER_MODEL_FORMAT, url: 'https://example.com/x.glb', footprint: { w: 1, h: 1 }, height: 1 }, { width: 200, height: 150 })).rejects.toMatchObject({
        code: 'invalid_document',
        problems: [expect.stringMatching(/^url:/)],
      });
    } finally {
      await renderer.close();
    }
  }, 180_000);
});
