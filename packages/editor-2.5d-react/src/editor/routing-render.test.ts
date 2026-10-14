/**
 * Browser check for auto-routing: three tanks in a row, draw a pipe from the
 * first tank's (solid-wall) port to a cell beside the last with the real
 * pointer, and assert it goes around the middle tank. Needs local Chromium + WebGPU like the other *-render tests.
 */
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM, RENDER_ARGS } from '../test-support/chromium';
import { animationFrames, settle, waitForPageRendered } from '../test-support/render-harness';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { footprintCells } from '../routing/occupancy';
import { runCells } from '../routing/occupancy';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const snapDir = path.join(pkgRoot, 'tests/snapshots');
const shotPath = path.join(snapDir, 'auto-route.png');


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

/** Orthographic camera => screen = affine(grid). Probe three pointer positions and invert. */
async function calibrate(page: Page) {
  const root = page.getByTestId('process-editor');
  const box = (await page.locator('canvas').boundingBox())!;
  const probe = async (px: number, py: number) => {
    await page.mouse.move(px, py);
    await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-cursor'));
    // Let the reducer commit this pointer position.
    await animationFrames(page, 2);
    const [gx, gy] = (await root.getAttribute('data-cursor'))!.split(',').map(Number);
    return { px, py, gx: gx!, gy: gy! };
  };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Large offsets so half-cell snapping error is small relative to the baseline.
  const a = await probe(cx, cy);
  const b = await probe(cx + 200, cy);
  const c = await probe(cx, cy + 200);
  // grid = M * (px - a.px, py - a.py) + a.g ; solve M columns from b and c.
  const m = {
    xx: (b.gx - a.gx) / 200,
    yx: (b.gy - a.gy) / 200,
    xy: (c.gx - a.gx) / 200,
    yy: (c.gy - a.gy) / 200,
  };
  const det = m.xx * m.yy - m.xy * m.yx;
  return (gx: number, gy: number) => {
    const dx = gx - a.gx;
    const dy = gy - a.gy;
    return {
      x: a.px + (m.yy * dx - m.xy * dy) / det,
      y: a.py + (-m.yx * dx + m.xx * dy) / det,
    };
  };
}

describe.skipIf(!CHROMIUM)('auto pipe routing in the editor', () => {
  it('routes a pipe around the middle tank', async () => {
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('vite did not bind a port');
    }
    const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: RENDER_ARGS });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`http://127.0.0.1:${address.port}/editor.html?scene=routing`);
      const root = page.getByTestId('process-editor');
      await root.waitFor();
      await page.waitForSelector('canvas');
      await waitForPageRendered(page);

      // Top-down (X) so no tank hides a floor cell from the pointer.
      await page.keyboard.press('x');
      await settle(page);
      const toScreen = await calibrate(page);

      await page.keyboard.press('p');
      const click = async (gx: number, gy: number) => {
        // Half-cell snapping makes the affine fit approximate: nudge by the residual until exact.
        let target = { gx, gy };
        for (let i = 0; i < 6; i += 1) {
          const { x, y } = toScreen(target.gx, target.gy);
          await page.mouse.move(x, y);
          await animationFrames(page, 2);
          const [cx, cy] = (await root.getAttribute('data-cursor'))!.split(',').map(Number);
          if (cx === gx && cy === gy) break;
          target = { gx: target.gx + (gx - cx!) * 0.5, gy: target.gy + (gy - cy!) * 0.5 };
        }
        expect(await root.getAttribute('data-cursor')).toBe(`${gx},${gy}`);
        await page.mouse.down();
        await page.mouse.up();
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
      await settle(page);
      mkdirSync(snapDir, { recursive: true });
      await page.screenshot({ path: shotPath, type: 'png' });
    } finally {
      await browser.close();
    }
    expect(statSync(shotPath).size).toBeGreaterThan(20_000);
  }, 90_000);
});
