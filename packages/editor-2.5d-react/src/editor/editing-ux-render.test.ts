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
      // window.__scene (host state) lands a render after the editor's own count: wait on it before reading it.
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 6);
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
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.filter((o) => o.group === 'group-1').length === 3);
      expect(log.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('Mod+V pastes parts copied in another tab from the system clipboard, not the stale editor clipboard (PR #114 review)', async () => {
    const browser = await launchRenderBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    try {
      // "Another tab": a second page in the same browser copies parts with the real keyboard.
      const other = await context.newPage();
      const otherToScreen = await openTopDown(other, 'scene=editing');
      await clickCell(other, otherToScreen, 6, 6);
      expect(await selected(other)).toBe('valve-a');
      await other.keyboard.press('ControlOrMeta+c');

      const page = await context.newPage();
      const toScreen = await openTopDown(page, 'scene=editing');
      // Fill this editor's own clipboard with a tank first: a stale internal paste would add a tank.
      await clickCell(page, toScreen, 0, 0);
      await page.keyboard.press('ControlOrMeta+c');
      // Re-copy in the other tab so the system clipboard holds the valve.
      await other.bringToFront();
      await other.keyboard.press('ControlOrMeta+c');
      await page.bringToFront();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 5);
      const added = (await sceneOf(page)).objects.slice(4);
      expect(added.map((o) => o.object)).toEqual(['valve']);
      expect(await selected(page)).toBe(added[0]!.id);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('a native cut with no keydown (browser Edit > Cut) copies and deletes, once (holodeck#123)', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    try {
      const toScreen = await openTopDown(page, 'scene=editing');
      await clickCell(page, toScreen, 0, 0);
      expect(await selected(page)).toBe('tank-a');
      // Edit > Cut fires only the 'cut' ClipboardEvent: no keydown reaches the editor.
      const written = await page.evaluate(() => {
        const data = new DataTransfer();
        document.body.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }));
        return data.getData('text/plain');
      });
      expect(written).toContain('holodeck.iso.clipboard.v1');
      expect(written).toContain('"tank-a"');
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 3);
      expect((await sceneOf(page)).objects.some((o) => o.id === 'tank-a')).toBe(false);

      // Keyboard cut still deletes exactly once (keydown + its native cut event).
      await clickCell(page, toScreen, 6, 0);
      await page.keyboard.press('ControlOrMeta+x');
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 2);
      await animationFrames(page, 10);
      expect((await sceneOf(page)).objects.map((o) => o.id).sort()).toEqual(['tank-c', 'valve-a']);
      // Undo brings back exactly the keyboard-cut tank (one step), then the menu-cut one.
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 3);
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 4);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it('adds, drags and removes a connector waypoint with the pointer (holodeck#112)', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    try {
      const toScreen = await openTopDown(page, 'scene=editing');
      const viaOf = async () => (await sceneOf(page)).objects.find((o) => o.object === 'connector')?.link?.via;
      // A free line on an empty row (the fitted view shows y = -2..8 or so).
      await page.keyboard.press('c');
      await clickCell(page, toScreen, 0, 3);
      await clickCell(page, toScreen, 10, 3);
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 5);
      await page.keyboard.press('Escape');
      expect(await selected(page)).toBe('connector-1');
      await settle(page);

      // Press the "+" handle at the middle of the line, drag it two cells down, release.
      await moveToCell(page, toScreen, 5, 3);
      await page.mouse.down();
      const target = toScreen(5, 5);
      await page.mouse.move(target.x, target.y, { steps: 6 });
      await moveToCell(page, toScreen, 5, 5);
      await page.mouse.up();
      await page.waitForFunction(() => {
        const c = (window as unknown as { __scene: IsoSceneFile }).__scene.objects.find((o) => o.object === 'connector');
        return c?.link?.via?.[0]?.y === 5;
      });
      expect(await viaOf()).toEqual([{ x: 5, y: 5 }]);
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'editing-waypoint.png'), type: 'png' });

      // Double-click the waypoint handle to remove it.
      const p = await moveToCell(page, toScreen, 5, 5);
      await page.mouse.dblclick(p.x, p.y);
      await page.waitForFunction(() => {
        const c = (window as unknown as { __scene: IsoSceneFile }).__scene.objects.find((o) => o.object === 'connector');
        return c !== undefined && c.link?.via === undefined;
      });
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
      // window.__scene (host state) lands a render after the editor's own count: wait on it before reading it.
      await page.waitForFunction(() => (window as unknown as { __scene: IsoSceneFile }).__scene.objects.length === 5);
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

      // holodeck#133: a host-armed run part (pipe) enters draw-pipe, whose
      // editor state keeps `placing: null`; the host disarming must still
      // leave it, or later canvas clicks keep drawing pipes.
      const mode = () => root.getAttribute('data-mode');
      const setPlacing = (id: string | null) => page.evaluate((v) => (window as unknown as { __setPlacing: (id: string | null) => void }).__setPlacing(v), id);
      await setPlacing('pipe');
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-mode') === 'draw-pipe');
      await setPlacing(null);
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-mode') === 'select');
      expect(await mode()).toBe('select');
      // Escape out of a host-armed pipe is reported to the host (it showed Pipe as armed forever).
      await setPlacing('pipe');
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-mode') === 'draw-pipe');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as unknown as { __placing: string | null }).__placing === null);
      expect(await mode()).toBe('select');
    } finally {
      await browser.close();
    }
  }, 120_000);

  // holodeck#108 / #127: an image in the scene at the fit refits the view
  // when its real aspect arrives; anything else (an image loading elsewhere
  // on the page, a scene edit) never moves a view the user has not touched.
  it('refits for the scene image aspect only, not for images elsewhere', async () => {
    // A 1:4 portrait SVG: at width 2 with height 0 it draws 8 cells tall.
    const portrait = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="400"><rect width="100" height="400" fill="#2a9d8f"/></svg>')}`;
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const view = async () => {
      const root = page.getByTestId('process-editor');
      return [await root.getAttribute('data-zoom'), await root.getAttribute('data-target')].join(' ');
    };
    try {
      // Reference: the same image with its height given explicitly (no late aspect).
      await page.goto(`${harness.origin}/editor.html?scene=editing&image=${encodeURIComponent(portrait)}&imageHeight=8`);
      await page.getByTestId('process-editor').waitFor();
      await waitForRendered(page);
      const explicit = await view();

      await page.goto(`${harness.origin}/editor.html?scene=editing&image=${encodeURIComponent(portrait)}`);
      await page.getByTestId('process-editor').waitFor();
      await waitForRendered(page);
      await page.waitForFunction((src) => (window as unknown as { __imageAspect: (s: string) => number | undefined }).__imageAspect(src) === 0.25, portrait);
      await settle(page);
      expect(await view(), 'late aspect of a scene image refits to the real bounds').toBe(explicit);

      // A scene edit far away: never refits.
      await page.evaluate(() => {
        const editor = (window as unknown as { __editor: { dispatch: (a: unknown) => void } }).__editor;
        editor.dispatch({ type: 'place-mode', object: 'tank' });
        editor.dispatch({ type: 'floor-click', x: 40, y: 40 });
        editor.dispatch({ type: 'select-mode' });
      });
      await page.waitForFunction(() => document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-object-count') === '6');
      await settle(page);
      expect(await view()).toBe(explicit);

      // An image loading in another editor (any src not in this scene at the fit): no refit either.
      await page.evaluate(() => (window as unknown as { __setImageAspect: (s: string, a: number) => void }).__setImageAspect('elsewhere-127.png', 0.2));
      await animationFrames(page, 10);
      await settle(page);
      expect(await view(), 'an unrelated image aspect must not refit').toBe(explicit);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
