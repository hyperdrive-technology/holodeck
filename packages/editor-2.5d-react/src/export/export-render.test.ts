/**
 * Tiled PNG export in a real browser (holodeck#42): `ProcessEditorHandle.exportImage`
 * against what the canvas shows, across tile sizes, twice in a row, and with
 * a selection (overlays must not be exported). Harness: export.html / export-main.tsx.
 *
 * No sleeps: the export itself waits on the rendered signal, and the
 * reference screenshot is taken after `waitForRendered`.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { artifactsDir } from '../visual/io';
import { collectPageLog, launchRenderBrowser, startHarness, waitForRendered, type Harness } from '../test-support/render-harness';

let harness: Harness;
let browser: Browser;

beforeAll(async () => {
  if (!CHROMIUM) return;
  harness = await startHarness('export');
  browser = await launchRenderBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await harness?.close();
});

interface Exported {
  width: number;
  height: number;
  tiles: number;
  type: string;
  png: string;
}

interface Diff {
  width: [number, number];
  height: [number, number];
  /** Mean absolute channel difference, 0..255. */
  mean: number;
  /** Share of pixels whose largest channel difference exceeds 48. */
  over: number;
  /** Share of pixels darker than the floor grid (scene content) in `a`. */
  contentA: number;
}

const PANE = { width: 640, height: 400 };

async function open(query = ''): Promise<{ page: Page; logs: string[] }> {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const logs = collectPageLog(page);
  await page.goto(`${harness.origin}/export.html?${query}`);
  await waitForRendered(page.getByTestId('process-editor'));
  return { page, logs };
}

const run = (page: Page, options: Record<string, unknown>) =>
  page.evaluate((o) => (window as unknown as { __export: { run(o: unknown): Promise<Exported> } }).__export.run(o), options);

/** Pixel comparison of two PNGs (base64), in the page (decode + 2D canvas). */
function diff(page: Page, a: string, b: string): Promise<Diff> {
  return page.evaluate(async ([a64, b64]) => {
    const load = async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    };
    const [ia, ib] = [await load(a64!), await load(b64!)];
    const w = Math.min(ia.width, ib.width);
    const h = Math.min(ia.height, ib.height);
    let sum = 0;
    let over = 0;
    let content = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * ia.width + x) * 4;
        const j = (y * ib.width + x) * 4;
        let max = 0;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(ia.data[i + k]! - ib.data[j + k]!);
          sum += d;
          if (d > max) max = d;
        }
        if (max > 48) over++;
        const lum = 0.299 * ia.data[i]! + 0.587 * ia.data[i + 1]! + 0.114 * ia.data[i + 2]!;
        if (lum < 190) content++;
      }
    }
    return { width: [ia.width, ib.width], height: [ia.height, ib.height], mean: sum / (w * h * 3), over: over / (w * h), contentA: content / (w * h) };
  }, [a, b] as const);
}

describe.skipIf(!CHROMIUM)('ProcessEditor.exportImage (tiled PNG)', () => {
  it('at scale 1 matches the canvas on screen (orientation, colour space, content)', async () => {
    const { page, logs } = await open();
    try {
      const shot = (await page.locator('canvas').screenshot()).toString('base64');
      const image = await run(page, { scale: 1, tileSize: 256 });
      expect(image).toMatchObject({ width: PANE.width, height: PANE.height, type: 'image/png', tiles: 6 });
      const d = await diff(page, image.png, shot);
      expect(d.width).toEqual([PANE.width, PANE.width]);
      expect(d.height).toEqual([PANE.height, PANE.height]);
      // A real picture, not a blank or flipped frame.
      expect(d.contentA, logs.join('\n')).toBeGreaterThan(0.02);
      // Same renderer, same camera: only antialiasing differs (the canvas
      // resolves MSAA on its own surface). A vertical flip or a linear
      // (un-converted) colour space puts this far above 2 and `over` above 5 %.
      expect(d.mean, JSON.stringify(d)).toBeLessThan(2);
      expect(d.over, JSON.stringify(d)).toBeLessThan(0.01);
    } finally {
      await page.close();
    }
  }, 120_000);

  it('stitches tiles into the same picture as one big tile, at 2x', async () => {
    const { page } = await open();
    try {
      const tiled = await run(page, { scale: 2, tileSize: 256 });
      const whole = await run(page, { scale: 2, tileSize: 1280 });
      expect(tiled).toMatchObject({ width: 1280, height: 800, tiles: 20 });
      expect(whole).toMatchObject({ width: 1280, height: 800, tiles: 1 });
      // Review shot (CI uploads artifacts/ as render-artifacts).
      writeFileSync(path.join(artifactsDir('render'), 'export-2x-tiled.png'), Buffer.from(tiled.png, 'base64'));
      const d = await diff(page, tiled.png, whole.png);
      expect(d.contentA).toBeGreaterThan(0.02);
      // Seams would show as lines of differing pixels along every tile edge.
      expect(d.mean, JSON.stringify(d)).toBeLessThan(0.5);
      expect(d.over, JSON.stringify(d)).toBeLessThan(0.002);
    } finally {
      await page.close();
    }
  }, 120_000);

  it('is deterministic: the same export twice gives the same PNG bytes', async () => {
    const { page } = await open('mode=run');
    try {
      const a = await run(page, { scale: 1.5, tileSize: 512 });
      const b = await run(page, { scale: 1.5, tileSize: 512 });
      expect(a).toMatchObject({ width: 960, height: 600 });
      expect(b.png === a.png).toBe(true);
    } finally {
      await page.close();
    }
  }, 120_000);

  it('hides the selection and tool overlays in the export', async () => {
    const { page } = await open();
    try {
      const plain = await run(page, { scale: 1, tileSize: 1024 });
      const plainShot = (await page.locator('canvas').screenshot()).toString('base64');
      await page.evaluate(() => (window as unknown as { __export: { select(id: string): void } }).__export.select('holding'));
      await page.waitForSelector('[data-testid="process-editor"][data-selected-ids="holding"]');
      await waitForRendered(page.getByTestId('process-editor'));
      // The halo is on screen (so this test can fail)...
      const selectedShot = (await page.locator('canvas').screenshot()).toString('base64');
      expect((await diff(page, selectedShot, plainShot)).over).toBeGreaterThan(0.0001);
      // ...and not in the export.
      const selected = await run(page, { scale: 1, tileSize: 1024 });
      expect(selected.png === plain.png).toBe(true);
      // ...and the selection is still drawn on screen afterwards.
      expect(await page.getByTestId('process-editor').getAttribute('data-selected-ids')).toBe('holding');
    } finally {
      await page.close();
    }
  }, 120_000);

  it('rejects bad options and an aborted export without breaking the next one', async () => {
    const { page } = await open();
    try {
      const err = (o: Record<string, unknown>) =>
        page.evaluate((opts) => (window as unknown as { __export: { error(o: unknown): Promise<string | null> } }).__export.error(opts), o);
      expect(await err({ scale: 100 })).toMatch(/^ExportSizeError: .*scale/);
      expect(await err({ tileSize: 100 })).toMatch(/^ExportSizeError: .*tileSize/);
      expect(await page.evaluate(() => (window as any).__export.run({ abortNow: true }).then(() => 'ok', (e: Error) => e.message))).toBe('aborted by test');
      const after = await run(page, { scale: 1 });
      expect(after).toMatchObject({ width: PANE.width, height: PANE.height });
    } finally {
      await page.close();
    }
  }, 120_000);

  it('does not retry on an unmounted editor: a scene change during readback then unmount settles every export (holodeck#189)', async () => {
    const { page } = await open();
    try {
      const out = await page.evaluate(() => (window as any).__export.changeAndUnmountDuringReadback() as Promise<{ held: boolean; results: string[] }>);
      expect(out.held).toBe(true);
      expect(out.results).toHaveLength(2);
      for (const r of out.results) expect(r).toMatch(/^ImageExportError: /);
    } finally {
      await page.close();
    }
  }, 120_000);

  type RetryOutcome = { changed: number; calls: number; results: string[] };
  const retry = (page: Page, changes: number) =>
    page.evaluate((n) => (window as any).__export.changeDuringReadbacks(n) as Promise<RetryOutcome>, changes);

  it('one scene change during capture restarts the export, which then succeeds (holodeck#191)', async () => {
    const { page } = await open();
    try {
      const out = await retry(page, 1);
      expect(out.changed).toBe(1);
      // Both queued exports succeed; the first needed a second, full pass.
      expect(out.results.map((r) => r.split(':')[0])).toEqual(['ok', 'ok']);
      const tiles = Number(out.results[0]!.split(':')[1]);
      expect(out.calls).toBe(1 + tiles + tiles);
    } finally {
      await page.close();
    }
  }, 120_000);

  it('continuous changes reject after 3 attempts with the pause-live-data hint and release the queued export (holodeck#191)', async () => {
    const { page } = await open();
    try {
      const out = await retry(page, 3);
      expect(out.changed).toBe(3);
      expect(out.results[0]).toMatch(/^SceneChangedError: .*pause live data/);
      // The queued export was not stuck behind the failure: it ran (quiet scene) and succeeded.
      expect(out.results[1]).toMatch(/^ok:/);
      const tiles = Number(out.results[1]!.split(':')[1]);
      expect(out.calls).toBe(3 + tiles);
      // And the editor still exports afterwards.
      expect(await run(page, { scale: 1 })).toMatchObject({ width: PANE.width, height: PANE.height });
    } finally {
      await page.close();
    }
  }, 120_000);

  it('settles every queued export when the editor unmounts (holodeck#154)', async () => {
    const { page } = await open();
    try {
      const results = await page.evaluate(() => (window as any).__export.queueThenUnmount(3) as Promise<string[]>);
      expect(results).toHaveLength(3);
      // The first may have finished or been rejected by the unmount; the queued ones never start.
      expect(results[0]).toMatch(/^(ok|ImageExportError: )/);
      expect(results.slice(1)).toEqual([
        'ImageExportError: the editor was unmounted before this image export started',
        'ImageExportError: the editor was unmounted before this image export started',
      ]);
    } finally {
      await page.close();
    }
  }, 120_000);
});
