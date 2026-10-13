/**
 * Renders vessels.html (the base-Tank preset family at brewhouse spacing)
 * in a real WebGPU canvas and saves tests/snapshots/brewhouse-vessels.png
 * plus a close-up crop per vessel. Visual check: all vessels must read as
 * the same object (cutaway, solid liquid, no lines inside the window) with
 * different radius / height / closures.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { TANK_PRESETS } from '../../assets/process/tank-presets';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const snapDir = path.join(pkgRoot, 'tests/snapshots');
const snapPath = path.join(snapDir, 'brewhouse-vessels.png');
const VIEW = { width: 1400, height: 520 };


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

describe.skipIf(!CHROMIUM)('vessel family workbench', () => {
  it('renders every Tank preset and snapshots them', async () => {
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
    const browser = await chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist'],
    });
    const logs: string[] = [];
    try {
      const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
      page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
      page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
      await page.goto(`http://127.0.0.1:${address.port}/vessels.html?level=0.5&agitate=1`);
      const root = page.getByTestId('vessels-root');
      await root.waitFor();
      await page.waitForSelector('canvas');
      await page.waitForTimeout(3000);
      expect(await root.getAttribute('data-vessels')).toBe(Object.keys(TANK_PRESETS).join(','));
      expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
      mkdirSync(snapDir, { recursive: true });
      await page.screenshot({ path: snapPath, type: 'png' });
      if (statSync(snapPath).size < 20_000) {
        throw new Error(`blank snapshot (${statSync(snapPath).size} bytes)\n${logs.join('\n')}`);
      }
      // Close-up crops (2x device pixels): one per vessel, left to right.
      const names = Object.keys(TANK_PRESETS);
      const stride = (VIEW.width * 2) / names.length;
      for (const [i, name] of names.entries()) {
        const out = path.join(snapDir, `brewhouse-vessel-${name}.png`);
        execSync(
          `magick ${JSON.stringify(snapPath)} -crop ${Math.round(stride)}x${VIEW.height * 2}+${Math.round(i * stride)}+0 +repage ${JSON.stringify(out)}`,
          { stdio: 'pipe' },
        );
      }
    } finally {
      await browser.close();
    }
  }, 60_000);
});
