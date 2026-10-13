/**
 * Renders tests/scene.json in a real WebGPU canvas.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { PROCESS_SCENE } from './load-process-scene';
import { REFERENCE_CANVAS } from '../editor/ProcessSceneView';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const scenePath = path.join(pkgRoot, 'tests/scene.json');
const snapDir = path.join(pkgRoot, 'tests/snapshots');
const oursPath = path.join(snapDir, 'scene-json.png');


let server: ViteDevServer;

beforeAll(async () => {
  if (!CHROMIUM) return;
  server = await createServer({
    root: path.join(pkgRoot, 'src/iso'),
    configFile: path.join(pkgRoot, 'src/iso/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [pkgRoot] } },
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
  });
  await server.listen();
}, 30_000);

afterAll(async () => {
  await server?.close();
});

describe.skipIf(!CHROMIUM)('renders scene.json', () => {
  it('places every library object from the scene file onto a canvas', async () => {
    const onDisk = JSON.parse(readFileSync(scenePath, 'utf8')) as {
      id: string;
      objects: Array<{ id: string; object: string; x: number; y: number }>;
    };
    expect(PROCESS_SCENE.id).toBe(onDisk.id);
    expect(PROCESS_SCENE.objects.map((o) => o.id)).toEqual(onDisk.objects.map((o) => o.id));

    const http = server.httpServer;
    if (!http) {
      throw new Error('vite did not bind a port');
    }
    const address = http.address();
    if (!address || typeof address === 'string') {
      throw new Error('vite did not bind a port');
    }

    const browser = await chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist'],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: REFERENCE_CANVAS.width, height: REFERENCE_CANVAS.height },
      });
      const logs: string[] = [];
      page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
      page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
      page.on('requestfailed', (req) => logs.push(`failed: ${req.url()} ${req.failure()?.errorText}`));
      await page.goto(`http://127.0.0.1:${address.port}/render.html`);
      const root = page.getByTestId('scene-root');
      await root.waitFor();
      await page.waitForSelector('canvas');
      const box = await page.locator('canvas').boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect(box?.height).toBeGreaterThan(100);
      await page.waitForTimeout(3500);

      expect(await root.getAttribute('data-scene-id')).toBe(onDisk.id);
      expect(await root.getAttribute('data-object-count')).toBe(String(onDisk.objects.length));
      expect(await root.getAttribute('data-object-ids')).toBe(onDisk.objects.map((o) => o.id).join(','));

      mkdirSync(snapDir, { recursive: true });
      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('[data-label-id]')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-label-id'),
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            w: r.width,
            h: r.height,
          };
        }),
      );
      writeFileSync('/tmp/label-boxes.json', JSON.stringify(boxes, null, 2));
      const holding = boxes.find((b) => b.id === 'label-holding');
      // SnapshotLabelLock pins CSS Html to scene.json screenX/Y (+ nudge).
      expect(holding?.cx).toBeGreaterThan(200);
      expect(holding?.cx).toBeLessThan(270);
      expect(holding?.cy).toBeGreaterThan(330);
      expect(holding?.cy).toBeLessThan(370);
      await page.screenshot({ path: oursPath, type: 'png' });
      if (statSync(oursPath).size < 20_000) {
        throw new Error(`blank snapshot (${statSync(oursPath).size} bytes)\n${logs.join('\n')}`);
      }

      const ref = path.join(snapDir, 'reference.jpg');
      const refCanvas = path.join(snapDir, 'reference-canvas.png');
      const overlay = path.join(snapDir, 'overlay-50.png');
      const diff = path.join(snapDir, 'diff.png');
      const { width, height, cropX } = REFERENCE_CANVAS;
      execSync(
        `magick ${JSON.stringify(ref)} -crop ${width}x${height}+${cropX}+0 +repage ${JSON.stringify(refCanvas)} && magick ${JSON.stringify(refCanvas)} ${JSON.stringify(oursPath)} -gravity center -compose blend -define compose:args=50,50 -composite ${JSON.stringify(overlay)} && magick ${JSON.stringify(refCanvas)} ${JSON.stringify(oursPath)} -compose difference -composite -auto-level ${JSON.stringify(diff)}`,
        { stdio: 'pipe' },
      );
    } finally {
      await browser.close();
    }

    expect(statSync(oursPath).size).toBeGreaterThan(20_000);
    // 60s is enough for one Chromium; a second concurrent vitest races the
    // port/GPU and this it() hangs past the timeout (21min observed).
  }, 60_000);
});
