/**
 * Browser check for drag-and-drop building: drag a vessel with the real mouse
 * and the pipe attached to its port follows (re-routed live, one undo step),
 * Esc cancels, Alt detaches, an unroutable drop position shows the red ghost.
 * Review shots go to artifacts/render (follow-*.png; gitignored, CI uploads).
 * Needs local Chromium + WebGPU like the other *-render tests.
 */
import path from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { calibrateGrid, moveToCell, type GridToScreen } from '../test-support/grid-pointer';
import { animationFrames, collectPageLog, launchRenderBrowser, settle, startHarness, waitForRendered, type Harness } from '../test-support/render-harness';
import { artifactsDir } from '../visual/io';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import type { EditorState } from './editor-state';

const shots = artifactsDir('render');

let harness: Harness;

beforeAll(async () => {
  if (!CHROMIUM) return;
  harness = await startHarness('editor');
}, 30_000);

afterAll(async () => {
  await harness?.close();
});

type Win = { __scene: IsoSceneFile; __editor: { getState: () => EditorState } };
const committed = (page: Page) => page.evaluate(() => (window as unknown as Win).__scene.objects);
const live = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as Win).__editor.getState();
  return { objects: s.scene.objects, dragging: s.drag !== null, blocked: s.drag?.blocked.length ?? 0, past: s.past.length, notice: s.notice };
});
const pipes = (objects: IsoPlacement[]) => objects.filter((o) => o.object === 'pipe');
const tankB = (objects: IsoPlacement[]) => objects.find((o) => o.id === 'tank-b')!;

/** Pipe ends that are neither on another pipe end nor on a tank port (+-1, 0 from its centre). */
function looseEnds(objects: IsoPlacement[]): string[] {
  const ps = pipes(objects);
  const tanks = objects.filter((o) => o.object === 'tank');
  const out: string[] = [];
  for (const p of ps) {
    for (const [x, y, end] of [[p.x, p.y, 'from'], [p.toX!, p.toY!, 'to']] as const) {
      const joined = ps.some((q) => q !== p && ((q.x === x && q.y === y) || (q.toX === x && q.toY === y)));
      const onPort = tanks.some((t) => Math.abs(x - t.x) === 1 && y === t.y);
      if (!joined && !onPort) out.push(`${p.id}.${end}`);
    }
  }
  return out;
}

async function open(page: Page, topDown: boolean, scene = 'follow'): Promise<GridToScreen> {
  await page.goto(`${harness.origin}/editor.html?scene=${scene}`);
  await page.getByTestId('process-editor').waitFor();
  await waitForRendered(page);
  if (topDown) {
    // Top-down (X) so no tank hides a floor cell from the pointer.
    await page.keyboard.press('x');
    await settle(page);
  }
  return calibrateGrid(page);
}

/** Press on a cell (a part there starts a move drag), then walk the real mouse to `to` in small steps. */
async function dragFrom(page: Page, toScreen: GridToScreen, from: [number, number], to: [number, number], opts: { release?: boolean } = {}) {
  await moveToCell(page, toScreen, from[0], from[1]);
  await page.mouse.down();
  const a = toScreen(from[0], from[1]);
  const b = toScreen(to[0], to[1]);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await moveToCell(page, toScreen, to[0], to[1]);
  await animationFrames(page, 3);
  if (opts.release !== false) {
    await page.mouse.up();
    await animationFrames(page, 2);
  }
}

describe.skipIf(!CHROMIUM)('pipes follow a dragged vessel (browser)', () => {
  it('drag, live re-route, one undo step; Esc cancels; Alt detaches; unroutable shows the ghost', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const log = collectPageLog(page);
    try {
      const toScreen = await open(page, true);
      const original = await committed(page);
      expect(looseEnds(original)).toEqual([]);

      // Drag tank-b from (10, 0) to (10, 6): the pipe re-routes around tank-c, live.
      await dragFrom(page, toScreen, [10, 0], [10, 6], { release: false });
      const during = await live(page);
      expect(during.dragging).toBe(true);
      expect(tankB(during.objects)).toMatchObject({ x: 10, y: 6 });
      expect(during.blocked).toBe(0);
      expect(looseEnds(during.objects)).toEqual([]);
      expect(pipes(during.objects).length).toBeGreaterThan(1);
      // Nothing committed while dragging.
      expect(await committed(page)).toEqual(original);
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'follow-topdown-during.png'), type: 'png' });
      await page.mouse.up();
      await animationFrames(page, 2);
      await page.waitForFunction(() => (window as unknown as Win).__scene.objects.find((o) => o.id === 'tank-b')!.y === 6);
      const after = await committed(page);
      expect(looseEnds(after)).toEqual([]);
      expect(pipes(after).some((p) => p.toX === 9 && p.toY === 6)).toBe(true);
      expect((await live(page)).past).toBe(1);

      // One undo step restores the vessel AND the pipe.
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForFunction(() => (window as unknown as Win).__scene.objects.find((o) => o.id === 'tank-b')!.y === 0);
      expect(await committed(page)).toEqual(original);

      // Esc mid-drag: everything goes back, nothing is committed.
      await dragFrom(page, toScreen, [10, 0], [12, 5], { release: false });
      expect(tankB((await live(page)).objects)).toMatchObject({ x: 12, y: 5 });
      await page.keyboard.press('Escape');
      await animationFrames(page, 2);
      expect((await live(page)).objects).toEqual(original);
      await page.mouse.up();
      await animationFrames(page, 2);
      expect((await live(page)).past).toBe(0);

      // Alt-drag: the vessel moves alone, the pipe stays where it was.
      await page.keyboard.down('Alt');
      await dragFrom(page, toScreen, [10, 0], [12, -3]);
      await page.keyboard.up('Alt');
      await page.waitForFunction(() => (window as unknown as Win).__scene.objects.find((o) => o.id === 'tank-b')!.x === 12);
      const detached = await committed(page);
      expect(pipes(detached).map((p) => [p.x, p.y, p.toX, p.toY])).toEqual([[1, 0, 9, 0]]);
      expect(pipes(detached)[0]!.attach).toEqual({ from: { object: 'tank-a', port: 'east' } });
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForFunction(() => (window as unknown as Win).__scene.objects.find((o) => o.id === 'tank-b')!.x === 10);

      // Unroutable: tank-w walls off the only way into b's west port at (10, 9).
      await dragFrom(page, toScreen, [10, 0], [10, 9], { release: false });
      const blocked = await live(page);
      expect(blocked.blocked).toBe(1);
      await expect(page.getByTestId('editor-notice').textContent()).resolves.toMatch(/No clear route/);
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'follow-topdown-blocked.png'), type: 'png' });
      // Dropping there lands on the last position the pipe could follow.
      await page.mouse.up();
      await animationFrames(page, 2);
      const snapped = await committed(page);
      expect(tankB(snapped).y).toBeLessThan(9);
      expect(looseEnds(snapped)).toEqual([]);
      await expect(page.getByTestId('editor-notice').textContent()).resolves.toMatch(/last position/);
      expect(log.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);

  it('2.5D view: before / during / after shots of a vessel drag (visual review)', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const log = collectPageLog(page);
    try {
      // Calibrate on the floor in top-down, press on the tank there, then
      // switch to 2.5D for the pictures (the drag state survives the view toggle).
      const toScreen = await open(page, true);
      await page.keyboard.press('x');
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'follow-iso-before.png'), type: 'png' });
      await page.keyboard.press('x');
      await settle(page);
      await dragFrom(page, toScreen, [10, 0], [11, 6], { release: false });
      await page.keyboard.press('x');
      await settle(page);
      expect((await live(page)).dragging).toBe(true);
      await page.screenshot({ path: path.join(shots, 'follow-iso-during.png'), type: 'png' });
      await page.mouse.up();
      await animationFrames(page, 2);
      await page.waitForFunction(() => (window as unknown as Win).__scene.objects.find((o) => o.id === 'tank-b')!.y === 6);
      await page.mouse.move(5, 5); // pointer off the canvas: no hover ghost in the shot
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'follow-iso-after.png'), type: 'png' });
      expect(looseEnds(await committed(page))).toEqual([]);
      expect(log.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);

  it('drags a tank from the palette onto a free pipe end: ghost follows, port snaps, the pipe then follows it', async () => {
    const browser = await launchRenderBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    const log = collectPageLog(page);
    try {
      const toScreen = await open(page, true, 'palette');
      const item = page.locator('button[data-part="tank"]');
      const box = (await item.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Off the item and across the canvas: past the threshold the tank is armed and its ghost follows.
      const target = toScreen(7.5, 0.5);
      await page.mouse.move(target.x, target.y, { steps: 12 });
      await moveToCell(page, toScreen, 7.5, 0.5);
      await animationFrames(page, 3);
      const armed = await page.evaluate(() => (window as unknown as Win).__editor.getState());
      expect(armed.mode).toBe('place');
      expect(armed.placing).toBe('tank');
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'palette-drag-ghost.png'), type: 'png' });
      await page.mouse.up();
      await page.waitForFunction(() => (window as unknown as Win).__scene.objects.some((o) => o.id === 'tank-1'));
      const placed = (await committed(page)).find((o) => o.id === 'tank-1')!;
      // Cursor (7.5, 0.5); the west port snapped onto the stub's free end at (6, 0).
      expect(placed).toMatchObject({ x: 7, y: 0 });
      const after = await page.evaluate(() => (window as unknown as Win).__editor.getState());
      expect(after.mode).toBe('select');
      expect(after.selectedIds).toEqual(['tank-1']);

      // The stub is attached now: dragging the new tank re-routes it from tank-a.
      await dragFrom(page, toScreen, [7, 0], [6, 3]);
      await page.waitForFunction(() => (window as unknown as Win).__scene.objects.find((o) => o.id === 'tank-1')!.y === 3);
      const moved = await committed(page);
      expect(looseEnds(moved)).toEqual([]);
      expect(pipes(moved).some((p) => p.toX === 5 && p.toY === 3)).toBe(true);
      await page.mouse.move(5, 5);
      await settle(page);
      await page.screenshot({ path: path.join(shots, 'palette-drop-follow.png'), type: 'png' });

      // A palette drag released off the canvas places nothing and drops the tool.
      const count = (await committed(page)).length;
      const valve = (await page.locator('button[data-part="valve"]').boundingBox())!;
      await page.mouse.move(valve.x + valve.width / 2, valve.y + valve.height / 2);
      await page.mouse.down();
      await page.mouse.move(valve.x + valve.width / 2 + 40, valve.y + valve.height / 2 + 30, { steps: 4 });
      await page.mouse.up();
      await animationFrames(page, 2);
      expect((await committed(page)).length).toBe(count);
      expect((await page.evaluate(() => (window as unknown as Win).__editor.getState())).mode).toBe('select');
      expect(log.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);
});
