/**
 * Pointer helpers for editor browser tests: map grid cells to screen pixels
 * (the orthographic camera makes screen an affine function of the grid) and
 * move the real mouse onto an exact cell. Shared by routing-render and
 * editing-ux-render. The editor publishes the hovered cell as
 * `data-cursor="x,y"` on `[data-testid="process-editor"]`.
 */
import type { Page } from 'playwright';
import { animationFrames } from './render-harness';

export type GridToScreen = (gx: number, gy: number) => { x: number; y: number };

/** Probe three pointer positions and invert the affine grid -> screen map. */
export async function calibrateGrid(page: Page): Promise<GridToScreen> {
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

/**
 * Move the mouse until `data-cursor` reads exactly (gx, gy). Half-cell
 * snapping makes the affine fit approximate: nudge by the residual.
 * Returns the final screen point.
 */
export async function moveToCell(page: Page, toScreen: GridToScreen, gx: number, gy: number): Promise<{ x: number; y: number }> {
  const root = page.getByTestId('process-editor');
  let target = { gx, gy };
  let point = toScreen(gx, gy);
  for (let i = 0; i < 6; i += 1) {
    point = toScreen(target.gx, target.gy);
    await page.mouse.move(point.x, point.y);
    await animationFrames(page, 2);
    const [cx, cy] = (await root.getAttribute('data-cursor'))!.split(',').map(Number);
    if (cx === gx && cy === gy) break;
    target = { gx: target.gx + (gx - cx!) * 0.5, gy: target.gy + (gy - cy!) * 0.5 };
  }
  const landed = await root.getAttribute('data-cursor');
  if (landed !== `${gx},${gy}`) throw new Error(`pointer landed on cell ${landed}, wanted ${gx},${gy}`);
  return point;
}

/** Click a grid cell with the real mouse (press + release on the same point). */
export async function clickCell(page: Page, toScreen: GridToScreen, gx: number, gy: number): Promise<void> {
  await moveToCell(page, toScreen, gx, gy);
  await page.mouse.down();
  await page.mouse.up();
}
