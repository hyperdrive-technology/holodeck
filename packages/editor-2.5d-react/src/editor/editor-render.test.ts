/**
 * Renders the process editor chrome + scene in a real WebGL canvas.
 */
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { PROCESS_SCENE } from '../iso/load-process-scene';
import { WCAG_AA_NORMAL, contrastRatioL, luminanceRgb } from './contrast';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const snapDir = path.join(pkgRoot, 'tests/snapshots');
const oursPath = path.join(snapDir, 'editor.png');


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

describe.skipIf(!CHROMIUM)('process editor', () => {
  it('loads the scene into the editor chrome', async () => {
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
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`http://127.0.0.1:${address.port}/editor.html`);
      const root = page.getByTestId('process-editor');
      await root.waitFor();
      await page.waitForSelector('canvas');
      const box = await page.locator('canvas').boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect(box?.height).toBeGreaterThan(100);
      await page.waitForTimeout(1500);

      expect(await root.getAttribute('data-mode')).toBe('select');
      expect(await root.getAttribute('data-object-count')).toBe(String(PROCESS_SCENE.objects.length));

      // holodeck#72: the toolbar "N items" label must meet WCAG AA against the bar it sits on.
      const count = page.getByTestId('item-count');
      await expect(count.textContent()).resolves.toMatch(/^\d+ items$/);
      const [fg, bg] = await count.evaluate((el) => {
        const rgb = (c: string) => (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
        return [rgb(getComputedStyle(el).color), rgb(getComputedStyle(el.parentElement as Element).backgroundColor)];
      });
      const ratio = contrastRatioL(
        luminanceRgb(fg as [number, number, number]),
        luminanceRgb(bg as [number, number, number]),
      );
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);

      await page.getByRole('button', { name: /2×2 vessel/ }).click();
      expect(await root.getAttribute('data-mode')).toBe('place');

      mkdirSync(snapDir, { recursive: true });
      await page.screenshot({ path: oursPath, type: 'png' });
    } finally {
      await browser.close();
    }

    expect(statSync(oursPath).size).toBeGreaterThan(20_000);
  }, 60_000);
});
