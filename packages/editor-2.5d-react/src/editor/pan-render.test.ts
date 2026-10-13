/**
 * Browser check for view panning (pan.ts / use-view-pan.ts) with the real
 * pointer: left drag on empty canvas pans in Edit mode, left drag on a part
 * still moves the part, Run mode pans from anywhere, trackpad scroll pans,
 * pinch zooms, and a pan stops auto-fit on resize. Needs local Chromium +
 * WebGPU like the other *-render tests.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import type { Vector3Tuple } from 'three';
import type { IsoSceneFile } from '../iso/scene';
import { panTarget } from '../iso/pan';
import { initialIsoPose } from '../iso/pose';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const snapDir = path.join(pkgRoot, 'tests/snapshots');


let server: ViteDevServer;
let browser: Browser;
let base = '';

beforeAll(async () => {
  if (!CHROMIUM) return;
  server = await createServer({
    root: path.join(pkgRoot, 'src/editor'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist'],
  });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function open(query: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/editor.html?${query}`);
  await page.getByTestId('process-editor').waitFor();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1500); // first fit + WebGPU init
  return page;
}

const editorAttr = (page: Page, name: string) =>
  page.getByTestId('process-editor').getAttribute(name).then((v) => v ?? '');
const target = async (page: Page): Promise<Vector3Tuple> =>
  (await editorAttr(page, 'data-target')).split(',').map(Number) as Vector3Tuple;
const zoom = async (page: Page) => Number(await editorAttr(page, 'data-zoom'));
const scene = (page: Page) => page.evaluate(() => (window as unknown as { __scene: IsoSceneFile }).__scene);
const canvasBox = async (page: Page) => (await page.locator('canvas').boundingBox())!;

async function drag(page: Page, from: [number, number], by: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  // Several steps, like a real pointer (first step crosses the pan threshold).
  for (let i = 1; i <= 6; i++) await page.mouse.move(from[0] + (by[0] * i) / 6, from[1] + (by[1] * i) / 6);
  await page.mouse.up();
  await page.waitForTimeout(150); // rAF flush + React commit
}

function expectNear(a: Vector3Tuple, b: Vector3Tuple, tol: number) {
  a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(tol));
}

describe.skipIf(!CHROMIUM)('view pan', () => {
  it('Edit mode: left drag on empty canvas pans by the screen-space amount, leaves parts alone, and stops auto-fit', async () => {
    const page = await open('scene=routing');
    try {
      const box = await canvasBox(page);
      const before = await target(page);
      const objectsBefore = (await scene(page)).objects;
      const z = await zoom(page);
      // Top-left corner of the canvas: empty floor in the 3-tank routing scene.
      await drag(page, [box.x + 60, box.y + 60], [140, 70]);
      const after = await target(page);
      expect(after).not.toEqual(before);
      expect(after[1]).toBeCloseTo(before[1], 6); // no vertical drift
      // data-zoom is rounded to 0.1, hence the loose tolerance.
      expectNear(after, panTarget(before, initialIsoPose(18), z, 140, 70), 0.05);
      expect((await scene(page)).objects).toEqual(objectsBefore);

      // A pan is a user view change: a canvas resize must not re-fit it away.
      await page.setViewportSize({ width: 1100, height: 700 });
      await page.waitForTimeout(400);
      expect(await target(page)).toEqual(after);
      mkdirSync(snapDir, { recursive: true });
      await page.screenshot({ path: path.join(snapDir, 'pan-edit.png') });
    } finally {
      await page.close();
    }
  }, 60_000);

  it('Edit mode: left drag on a part moves the part, not the view', async () => {
    const page = await open('scene=routing');
    try {
      const box = await canvasBox(page);
      const before = await target(page);
      const tankBefore = (await scene(page)).objects.find((o) => o.id === 'tank-2')!;
      // The fit centres the scene, so the middle tank's body is at the canvas centre.
      await drag(page, [box.x + box.width / 2, box.y + box.height / 2], [160, 0]);
      const tankAfter = (await scene(page)).objects.find((o) => o.id === 'tank-2')!;
      expect([tankAfter.x, tankAfter.y]).not.toEqual([tankBefore.x, tankBefore.y]);
      expect(await target(page)).toEqual(before);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('Run mode: left drag pans even when it starts on a part, with a grab / grabbing cursor', async () => {
    const page = await open('scene=routing&mode=run');
    try {
      const box = await canvasBox(page);
      const surface = page.locator('[data-iso-target]');
      expect(await surface.evaluate((el) => getComputedStyle(el).cursor)).toBe('grab');
      const before = await target(page);
      const objectsBefore = (await scene(page)).objects;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 40, cy + 10);
      await page.mouse.move(cx - 100, cy + 30);
      await page.waitForTimeout(100);
      expect(await surface.getAttribute('data-panning')).toBe('true');
      expect(await surface.evaluate((el) => getComputedStyle(el).cursor)).toBe('grabbing');
      await page.mouse.up();
      await page.waitForTimeout(150);
      expect(await surface.getAttribute('data-panning')).toBe('false');
      const after = await target(page);
      expect(after).not.toEqual(before);
      expect(after[1]).toBeCloseTo(before[1], 6);
      expect((await scene(page)).objects).toEqual(objectsBefore);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('a plain click on empty floor does not pan', async () => {
    const page = await open('scene=routing&mode=run');
    try {
      const box = await canvasBox(page);
      const before = await target(page);
      await page.mouse.click(box.x + 60, box.y + 60);
      await page.waitForTimeout(150);
      expect(await target(page)).toEqual(before);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('trackpad scroll pans, pinch (Ctrl + wheel) zooms about the cursor', async () => {
    const page = await open('scene=routing&mode=run');
    try {
      const box = await canvasBox(page);
      await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2);
      const z0 = await zoom(page);
      const t0 = await target(page);
      // deltaX present => two-finger scroll, never a mouse wheel.
      await page.mouse.wheel(30, 20);
      await page.waitForTimeout(150);
      const t1 = await target(page);
      expect(t1).not.toEqual(t0);
      expect(await zoom(page)).toBe(z0);

      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -40);
      await page.keyboard.up('Control');
      await page.waitForTimeout(150);
      expect(await zoom(page)).toBeGreaterThan(z0);
      // Off-centre cursor: the zoom also shifts the look-at toward it.
      expect(await target(page)).not.toEqual(t1);
    } finally {
      await page.close();
    }
  }, 60_000);
});
