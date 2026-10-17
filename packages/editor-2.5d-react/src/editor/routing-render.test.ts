/**
 * Browser check for auto-routing: three tanks in a row, draw a pipe from the
 * first tank's (solid-wall) port to a cell beside the last with the real
 * pointer, and assert it goes around the middle tank. Needs local Chromium + WebGPU like the other *-render tests.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { launchRenderBrowser, settle, waitForRendered } from '../test-support/render-harness';
import { calibrateGrid, clickCell } from '../test-support/grid-pointer';
import { artifactsDir } from '../visual/io';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { footprintCells } from '../routing/occupancy';
import { runCells } from '../routing/occupancy';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
// Review screenshot only (nothing compares it): gitignored artifacts, not the tracked tree.
const shotPath = path.join(artifactsDir('render'), 'auto-route.png');

let server: ViteDevServer;

beforeAll(async () => {
  if (!CHROMIUM) return;
  server = await createServer({
    root: path.join(pkgRoot, 'src/editor'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
  });
  await server.listen();
}, 30_000);

afterAll(async () => {
  await server?.close();
});

describe.skipIf(!CHROMIUM)('auto pipe routing in the editor', () => {
  it('routes a pipe around the middle tank', async () => {
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('vite did not bind a port');
    }
    const browser = await launchRenderBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`http://127.0.0.1:${address.port}/editor.html?scene=routing`);
      const root = page.getByTestId('process-editor');
      await root.waitFor();
      await page.waitForSelector('canvas');
      await waitForRendered(page);

      // Top-down (X) so no tank hides a floor cell from the pointer.
      await page.keyboard.press('x');
      await settle(page);
      const toScreen = await calibrateGrid(page);

      await page.keyboard.press('p');
      const click = async (gx: number, gy: number) => {
        await clickCell(page, toScreen, gx, gy);
      };
      // Click inside tank-1: it snaps to the east port (ties with west resolve in
      // declaration order). Window ports are valid: the pipe is clipped at the
      // wall when drawn (routing/vessel-ports.ts clipPipeEnd).
      await click(0, 0);
      expect(await root.getAttribute('data-pipe-start')).toBe('1,0');
      await click(10, 0);
      await settle(page);

      const scene = (await page.evaluate(() => (window as unknown as { __scene: IsoSceneFile }).__scene));
      const pipes = scene.objects.filter((o: IsoPlacement) => o.object === 'pipe');
      const elbows = scene.objects.filter((o: IsoPlacement) => o.object === 'elbow');
      expect(elbows.length).toBeGreaterThanOrEqual(2);
      const middle = new Set(footprintCells(6, 0, 2, 2).map((c) => `${c.x},${c.y}`));
      const cells = pipes.flatMap((p: IsoPlacement) => runCells(p));
      expect(cells.length).toBeGreaterThan(8);
      expect(cells.some((c) => middle.has(`${c.x},${c.y}`))).toBe(false);
      expect(await root.getAttribute('data-object-count')).toBe(String(3 + pipes.length + elbows.length));

      // Back to the iso view for a reviewable screenshot.
      await page.keyboard.press('Escape');
      await page.keyboard.press('x');
      // The 2D -> 2.5D pose animation holds the rendered signal until it lands.
      await settle(page);
      await page.screenshot({ path: shotPath, type: 'png' });
    } finally {
      await browser.close();
    }
    expect(statSync(shotPath).size).toBeGreaterThan(20_000);
  }, 90_000);
});
