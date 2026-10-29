/**
 * Renders vessels.html (the base-Tank preset family at brewhouse spacing)
 * in a real WebGPU canvas and saves artifacts/render/brewhouse-vessels.png
 * plus a close-up crop per vessel. Visual check: all vessels must read as
 * the same object (cutaway, solid liquid, no lines inside the window) with
 * different radius / height / closures.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { launchRenderBrowser, waitForRendered } from '../test-support/render-harness';
import { artifactsDir } from '../visual/io';
import { TANK_PRESETS } from '../../assets/process/tank-presets';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
/** Review shots: gitignored, uploaded by CI's render-artifacts step (holodeck#73). */
const snapDir = artifactsDir('render');
const snapPath = path.join(snapDir, 'brewhouse-vessels.png');
const VIEW = { width: 1400, height: 520 };
/** One vessel at 3x the row zoom: interior rings, agitator and nozzle flange at reviewable size. */
const CLOSEUP_VIEW = { width: 520, height: 640 };
const CLOSEUPS = ['mash-tun', 'whirlpool', 'hlt'] as const;
const CLOSEUP_ZOOM = 160;


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
    const browser = await launchRenderBrowser();
    const logs: string[] = [];
    try {
      const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
      page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
      page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
      await page.goto(`http://127.0.0.1:${address.port}/vessels.html?level=0.5&agitate=1`);
      const root = page.getByTestId('vessels-root');
      await root.waitFor();
      await page.waitForSelector('canvas');
      await waitForRendered(page);
      expect(await root.getAttribute('data-vessels')).toBe(Object.keys(TANK_PRESETS).join(','));
      expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
      await page.screenshot({ path: snapPath, type: 'png' });
      if (statSync(snapPath).size < 20_000) {
        throw new Error(`blank snapshot (${statSync(snapPath).size} bytes)\n${logs.join('\n')}`);
      }
      // Close-up crops (2x device pixels): one per vessel, left to right.
      // Playwright clips in CSS pixels, so no image tool (ImageMagick) is needed.
      const names = Object.keys(TANK_PRESETS);
      const stride = VIEW.width / names.length;
      for (const [i, name] of names.entries()) {
        await page.screenshot({
          path: path.join(snapDir, `brewhouse-vessel-${name}.png`),
          type: 'png',
          clip: { x: Math.round(i * stride), y: 0, width: Math.round(stride), height: VIEW.height },
        });
      }
      // Close-ups: one vessel centred at CLOSEUP_ZOOM (vessels.html?only=<id>).
      for (const name of CLOSEUPS) {
        const close = await browser.newPage({ viewport: CLOSEUP_VIEW, deviceScaleFactor: 2 });
        close.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
        await close.goto(
          `http://127.0.0.1:${address.port}/vessels.html?level=0.5&agitate=1&only=${name}&zoom=${CLOSEUP_ZOOM}`,
        );
        const closeRoot = close.getByTestId('vessels-root');
        await closeRoot.waitFor();
        await waitForRendered(close);
        expect(await closeRoot.getAttribute('data-vessels')).toBe(name);
        const out = path.join(snapDir, `brewhouse-vessel-${name}-closeup.png`);
        await close.screenshot({ path: out, type: 'png' });
        if (statSync(out).size < 20_000) throw new Error(`blank close-up ${name}\n${logs.join('\n')}`);
        await close.close();
      }
      expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 90_000);
});
