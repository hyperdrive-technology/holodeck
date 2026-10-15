/**
 * Renders parts.html (Blender GLBs + style layer beside their code twins)
 * in a real WebGPU canvas and saves tests/snapshots/parts.png.
 */
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { launchRenderBrowser, waitForRendered } from '../test-support/render-harness';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const snapDir = path.join(pkgRoot, 'tests/snapshots');
const snapPath = path.join(snapDir, 'parts.png');
const modelNames = readdirSync(path.join(pkgRoot, 'assets/models'))
  .filter((f) => f.endsWith('.glb'))
  .map((f) => f.replace(/\.glb$/, ''))
  .sort();


let server: ViteDevServer;

beforeAll(async () => {
  if (!CHROMIUM) return;
  server = await createServer({
    root: path.join(pkgRoot, 'src/iso'),
    configFile: path.join(pkgRoot, 'src/iso/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [pkgRoot] } },
    logLevel: 'error',
  });
  await server.listen();
}, 30_000);

afterAll(async () => {
  await server?.close();
});

describe.skipIf(!CHROMIUM)('parts workbench', () => {
  it('loads and styles every GLB in assets/models', async () => {
    expect(modelNames.length).toBeGreaterThan(0);
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('vite did not bind a port');
    }
    const browser = await launchRenderBrowser();
    const logs: string[] = [];
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 380 * modelNames.length } });
      page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
      page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
      // Chromium's console 404 line has no URL; log it here. The favicon miss is expected.
      page.on('response', (res) => {
        if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) {
          logs.push(`http ${res.status()}: ${res.url()}`);
        }
      });
      await page.goto(`http://127.0.0.1:${address.port}/parts.html`);
      const root = page.getByTestId('parts-root');
      await root.waitFor();
      expect(await root.getAttribute('data-part-names')).toBe(modelNames.join(','));
      await page.waitForFunction(
        (expected) => document.querySelector('[data-testid="parts-root"]')?.getAttribute('data-loaded') === expected,
        modelNames.join(','),
        { timeout: 20_000 },
      );
      await waitForRendered(page);

      // Every unknown-material / style warning from applyHolodeckStyle is a contract break.
      expect(logs.filter((l) => l.includes('applyHolodeckStyle')), logs.join('\n')).toEqual([]);
      expect(logs.filter((l) => l.startsWith('pageerror') || l.startsWith('http ')), logs.join('\n')).toEqual([]);

      mkdirSync(snapDir, { recursive: true });
      await page.screenshot({ path: snapPath, type: 'png', fullPage: true });
    } finally {
      await browser.close();
    }
    // A white-only frame compresses to a few KB.
    expect(statSync(snapPath).size, logs.join('\n')).toBeGreaterThan(15_000);
  }, 60_000);
});
