/**
 * Browser check for the E3 editing UX (holodeck#37, #91, #92, #100) with the
 * real pointer and keyboard: click / shift-click / marquee selection, copy +
 * paste + undo, the shortcut overlay, layers (hide), the connector tool, and
 * the host props (chrome="canvas", controlled camera, `placing`).
 * Needs local Chromium + WebGPU like the other *-render tests; review shots
 * go to artifacts/render (gitignored, uploaded by CI).
 */
import path from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { calibrateGrid, clickCell, moveToCell } from '../test-support/grid-pointer';
import { animationFrames, collectPageLog, launchRenderBrowser, settle, startHarness, waitForRendered, type Harness } from '../test-support/render-harness';
import { artifactsDir } from '../visual/io';
import type { IsoSceneFile } from '../iso/scene';
import type { EditorCamera } from './camera';

const shots = artifactsDir('render');

let harness: Harness;

beforeAll(async () => {
  if (!CHROMIUM) return;
  harness = await startHarness('editor');
}, 30_000);

afterAll(async () => {
  await harness?.close();
});

const sceneOf = (page: Page) => page.evaluate(() => (window as unknown as { __scene: IsoSceneFile }).__scene);
const selected = async (page: Page) => (await page.getByTestId('process-editor').getAttribute('data-selected-ids')) ?? '';

async function openTopDown(page: Page, query: string) {
  await page.goto(`${harness.origin}/editor.html?${query}`);
  const root = page.getByTestId('process-editor');
  await root.waitFor();
  await waitForRendered(page);
  // Top-down (X) so no tank hides a floor cell from the pointer.
  await page.keyboard.press('x');
  await settle(page);
  return calibrateGrid(page);
}

describe.skipIf(!CHROMIUM)('editing UX in the editor (E3)', () => {
  it('selects with click, shift-click and marquee; copies, pastes and undoes from the keyboard', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const log = collectPageLog(page);
    try {
      const toScreen = await openTopDown(page, 'scene=editing');
      const root = page.getByTestId('process-editor');

      await clickCell(page, toScreen, 0, 0);
      expect(await selected(page)).toBe('tank-a');

      await page.keyboard.down('Shift');
      await clickCell(page, toScreen, 6, 0);
      await page.keyboard.up('Shift');
      expect(await selected(page)).toBe('tank-a,tank-b');
      await expect(page.getByTestId('inspector').getAttribute('data-selection-count')).resolves.toBe('2');

      // Copy + paste: two new tanks, selected, one cell down-right.
      await page.keyboard.press('ControlOrMeta+c');
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-object-count') === '6');
      expect(await selected(page)).toBe('tank-1,tank-2');
      const pasted = (await sceneOf(page)).objects.filter((o) => o.id === 'tank-1' || o.id === 'tank-2');
      expect(pasted.map((o) => [o.x, o.y])).toEqual([[1, 1], [7, 1]]);

      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-object-count') === '4');

      // Escape clears the selection, then a Shift+drag marquee around the three tanks selects them (not the valve).
      await page.keyboard.press('Escape');
      expect(await selected(page)).toBe('');
      const a = await moveToCell(page, toScreen, -1, -2);
      await page.keyboard.down('Shift');
      await page.mouse.down();
      const b = toScreen(13, 2);
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
      await page.mouse.move(b.x, b.y, { steps: 4 });
      await expect(page.getByTestId('marquee').isVisible()).resolves.toBe(true);
      await page.mouse.up();
      await page.keyboard.up('Shift');
      expect((await selected(page)).split(',').sort()).toEqual(['tank-a', 'tank-b', 'tank-c']);
      await expect(page.getByTestId('marquee').count()).resolves.toBe(0);

      // Align centres on y is a no-op here (one row); group them, then a click on one selects all three.
      await page.keyboard.press('ControlOrMeta+g');
      await page.keyboard.press('Escape');
      await clickCell(page, toScreen, 12, 0);
      expect((await selected(page)).split(',').sort()).toEqual(['tank-a', 'tank-b', 'tank-c']);
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'editing-multi-select.png'), type: 'png' });
      expect((await sceneOf(page)).objects.filter((o) => o.group === 'group-1')).toHaveLength(3);
      expect(log.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('shows the shortcut overlay, hides a layer and draws a connector', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    try {
      const toScreen = await openTopDown(page, 'scene=editing');
      const root = page.getByTestId('process-editor');

      await page.keyboard.press('?');
      const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await help.waitFor();
      await expect(help.locator('[data-shortcut="duplicate"]').textContent()).resolves.toMatch(/Duplicate/);
      await page.screenshot({ path: path.join(shots, 'editing-shortcuts.png'), type: 'png' });
      await page.keyboard.press('Escape');
      await expect(help.count()).resolves.toBe(0);

      // Connector tool: click tank-a's east port cell, then tank-c.
      await page.keyboard.press('c');
      expect(await root.getAttribute('data-mode')).toBe('draw-connector');
      await clickCell(page, toScreen, 1, 0);
      await clickCell(page, toScreen, 12, 0);
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-object-count') === '5');
      const connector = (await sceneOf(page)).objects.find((o) => o.object === 'connector')!;
      expect(connector.link?.from).toEqual({ object: 'tank-a', port: 'east' });
      expect(connector.link?.to && 'object' in connector.link.to ? connector.link.to.object : null).toBe('tank-c');
      await page.keyboard.press('Escape');

      // Layers: new layer, move the valve there, hide it.
      await page.getByRole('tab', { name: 'layers' }).click();
      await page.getByRole('button', { name: '+ layer' }).click();
      await clickCell(page, toScreen, 6, 6);
      expect(await selected(page)).toBe('valve-a');
      await page.getByRole('button', { name: 'Move selection to layer Layer 2' }).click();
      await page.getByRole('button', { name: 'Hide layer Layer 2' }).click();
      expect(await selected(page)).toBe('');
      // onChange -> host setState -> window.__scene lands on the next render.
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.layers?.[0]?.hidden === true);
      const scene = await sceneOf(page);
      expect(scene.layers).toEqual([{ id: 'layer-1', name: 'Layer 2', hidden: true }]);
      expect(scene.objects.find((o) => o.id === 'valve-a')?.layer).toBe('layer-1');
      // A click where the hidden valve is selects nothing.
      await clickCell(page, toScreen, 6, 6);
      expect(await selected(page)).toBe('');
      await page.keyboard.press('x');
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'editing-layers-connector.png'), type: 'png' });
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('host props: canvas-only chrome, a stored camera, onCameraChange and host-armed placing', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    try {
      const camera: EditorCamera = { zoom: 33, target: [3, 0, 2], yaw: Math.PI / 4, topDown: false };
      await page.goto(`${harness.origin}/editor.html?scene=editing&chrome=canvas&camera=${encodeURIComponent(JSON.stringify(camera))}`);
      const root = page.getByTestId('process-editor');
      await root.waitFor();
      await waitForRendered(page);
      await expect(page.getByTestId('inspector').count()).resolves.toBe(0);
      await expect(page.getByRole('button', { name: 'Pipe' }).count()).resolves.toBe(0);
      await expect(page.getByTestId('item-count').count()).resolves.toBe(0);
      expect(await root.getAttribute('data-zoom')).toBe('33.0');
      expect(await root.getAttribute('data-target')).toBe('3.000,0.000,2.000');
      // Opening on the stored camera reports nothing.
      expect(await page.evaluate(() => (window as unknown as { __cameras: unknown[] }).__cameras.length)).toBe(0);

      // A user gesture (wheel zoom) is reported once, after it settles.
      const box = (await page.locator('canvas').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -300);
      await page.waitForFunction(() => (window as unknown as { __cameras: unknown[] }).__cameras.length > 0);
      await animationFrames(page, 20);
      const cams = await page.evaluate(() => (window as unknown as { __cameras: EditorCamera[] }).__cameras);
      expect(cams.length).toBeLessThanOrEqual(2);
      expect(cams[cams.length - 1]!.zoom).toBeCloseTo(Number(await root.getAttribute('data-zoom')), 0);

      // Host arms the place tool; the floor click stamps and reports onPlaced.
      await page.keyboard.press('x');
      await settle(page);
      const toScreen = await calibrateGrid(page);
      await page.evaluate(() => (window as unknown as { __setPlacing: (id: string) => void }).__setPlacing('valve'));
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-mode') === 'place');
      await clickCell(page, toScreen, 3, 8);
      await page.waitForFunction(() => (window as unknown as { __placed: string[] }).__placed.length === 1);
      expect(await page.evaluate(() => (window as unknown as { __placed: string[] }).__placed)).toEqual(['valve-1']);
      // Escape inside the editor disarms; the host hears it through onPlacingChange.
      await page.keyboard.press('Escape');
      expect(await root.getAttribute('data-mode')).toBe('select');
    } finally {
      await browser.close();
    }
  }, 120_000);
});
