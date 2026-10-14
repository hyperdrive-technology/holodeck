/**
 * holodeck#34 in a real browser: the rendered signal and fit-on-load when the
 * editor is embedded by a host (core#69: editor taller than its pane, scene
 * not fitted). Harness: embed.html / embed-main.tsx.
 *
 * No sleeps: every wait is on `data-render-state` or on a frame count.
 */
import type { Browser, Page, Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import {
  animationFrames,
  collectPageLog,
  launchRenderBrowser,
  startHarness,
  waitForRendered,
  type Harness,
} from '../test-support/render-harness';

let harness: Harness;
let browser: Browser;

beforeAll(async () => {
  if (!CHROMIUM) return;
  harness = await startHarness('editor');
  browser = await launchRenderBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await harness?.close();
});

type Box = { x: number; y: number; width: number; height: number };

/**
 * Bounding box (in canvas pixels) of everything darker than the floor grid in
 * a screenshot of the canvas area. The grid's darkest line is #CCC (204), so
 * luminance < 190 is scene content: outlines, shading, liquid, labels.
 */
async function contentBox(page: Page, png: Buffer): Promise<Box & { canvasW: number; canvasH: number }> {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 190) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, canvasW: c.width, canvasH: c.height };
  }, png.toString('base64'));
}

async function open(query: string, viewport: { width: number; height: number }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const logs = collectPageLog(page);
  await page.goto(`${harness.origin}/embed.html?${query}`);
  const editor = page.getByTestId('process-editor');
  await editor.waitFor();
  return { page, editor, logs };
}

const EMBEDS = [
  { name: 'app shell, 1440x900, edit', query: 'layout=flex&mode=edit', viewport: { width: 1440, height: 900 } },
  { name: 'app shell, 1024x600, edit', query: 'layout=flex&mode=edit', viewport: { width: 1024, height: 600 } },
  { name: 'app shell, 1440x900, run', query: 'layout=flex&mode=run', viewport: { width: 1440, height: 900 } },
  { name: '640x360 box, run', query: 'layout=box&mode=run', viewport: { width: 1280, height: 720 } },
] as const;

describe.skipIf(!CHROMIUM)('ProcessEditor embedded in a host', () => {
  for (const embed of EMBEDS) {
    it(`stays inside its pane and fits the scene on load: ${embed.name}`, async () => {
      const { page, editor, logs } = await open(embed.query, embed.viewport);
      try {
        const rendered = await waitForRendered(editor);
        expect(rendered).toBe(Number(await editor.getAttribute('data-holodeck-revision')));

        // 1. No overflow: the editor is exactly its pane and inside the viewport.
        const pane = (await page.getByTestId('pane').boundingBox())!;
        const box = (await editor.boundingBox())!;
        expect(box.height, logs.join('\n')).toBeLessThanOrEqual(pane.height + 0.5);
        expect(box.width).toBeLessThanOrEqual(pane.width + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(embed.viewport.height + 0.5);
        const scroll = await page.evaluate(() => ({
          h: document.documentElement.scrollHeight,
          w: document.documentElement.scrollWidth,
        }));
        expect(scroll.h).toBeLessThanOrEqual(embed.viewport.height);
        expect(scroll.w).toBeLessThanOrEqual(embed.viewport.width);

        // 2. Fitted: the drawn scene is inside the canvas (not clipped) and fills
        //    most of it along at least one axis (not small / off-centre).
        const canvas = page.locator('[data-testid="process-editor"] canvas');
        const cbox = (await canvas.boundingBox())!;
        expect(cbox.height).toBeGreaterThan(100);
        const shot = await page.screenshot({ clip: cbox, type: 'png' });
        const content = await contentBox(page, shot);
        expect(Number.isFinite(content.x), 'nothing drawn').toBe(true);
        expect(content.x).toBeGreaterThan(0);
        expect(content.y).toBeGreaterThan(0);
        expect(content.x + content.width).toBeLessThan(content.canvasW);
        expect(content.y + content.height).toBeLessThan(content.canvasH);
        const fill = Math.max(content.width / content.canvasW, content.height / content.canvasH);
        expect(fill, JSON.stringify(content)).toBeGreaterThan(0.6);
        // Centred: the content's centre is within 15 % of the canvas centre on each axis.
        expect(Math.abs(content.x + content.width / 2 - content.canvasW / 2) / content.canvasW).toBeLessThan(0.15);
        expect(Math.abs(content.y + content.height / 2 - content.canvasH / 2) / content.canvasH).toBeLessThan(0.15);

        // onRendered reported the same revision as the attribute.
        const reported = await page.evaluate(() => (window as any).__embed.rendered as number[]);
        expect(reported[reported.length - 1]).toBe(rendered);
      } finally {
        await page.close();
      }
    }, 90_000);
  }

  it('holds the rendered signal while a GLB part is loading, then reports it', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      const logs = collectPageLog(page);
      // Park the pump GLB request until the test releases it.
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requested!: () => void;
      const glbRequested = new Promise<void>((resolve) => {
        requested = resolve;
      });
      // Only the binary fetch: Vite also serves `pump.glb?import&url` as the JS
      // module that yields the URL, and parking that one blocks the page itself.
      const isGlbFetch = (url: URL) => url.pathname.endsWith('/pump.glb') && !url.search.includes('import');
      await page.route(isGlbFetch, async (route: Route) => {
        requested();
        await released;
        await route.continue();
      });
      await page.goto(`${harness.origin}/embed.html?layout=flex&mode=run`);
      const editor = page.getByTestId('process-editor');
      await editor.waitFor();
      await glbRequested;
      // The canvas is up and drawing; the fitted scene minus the pump is on screen.
      await page.waitForSelector('[data-testid="process-editor"] canvas');
      await animationFrames(page, 30);
      expect(await editor.getAttribute('data-render-state'), logs.join('\n')).toBe('pending');
      expect(await page.evaluate(() => (window as any).__embed.rendered.length)).toBe(0);

      release();
      const rendered = await waitForRendered(editor);
      expect(rendered).toBe(Number(await editor.getAttribute('data-holodeck-revision')));
      expect(await page.evaluate(() => (window as any).__embed.rendered as number[])).toEqual([rendered]);
    } finally {
      await page.close();
    }
  }, 90_000);

  it('goes pending on a view change and ready again for the new revision', async () => {
    const { page, editor } = await open('layout=flex&mode=run', { width: 1280, height: 720 });
    try {
      const first = await waitForRendered(editor);
      const zoomBefore = await editor.getAttribute('data-zoom');
      await page.getByRole('button', { name: '+', exact: true }).click();
      // The revision moves in the same commit as the zoom: never a stale "ready".
      const revision = Number(await editor.getAttribute('data-holodeck-revision'));
      expect(revision).toBeGreaterThan(first);
      expect(await editor.getAttribute('data-zoom')).not.toBe(zoomBefore);
      const second = await waitForRendered(editor);
      expect(second).toBe(revision);
    } finally {
      await page.close();
    }
  }, 90_000);
});
