/**
 * PNG export from the Export dialog, with WebGPU (playwright.config.ts
 * `webgpu` project), over the production build (holodeck#42). The engine's
 * export-render.test.ts checks pixels in depth (tiling, colour, determinism);
 * this checks the studio wiring: dialog -> exportImage -> a real PNG download
 * of the right size with the scene in it.
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { seedEmbedDocument } from './fixtures';

const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
});

test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

/** Width and height from a PNG's IHDR chunk (bytes 16-23, big-endian). */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('Export dialog downloads a 2x PNG of the canvas with the scene in it', async ({ page }, testInfo) => {
  await seedEmbedDocument(page);
  const editor = page.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-render-state', /ready|unsupported/, { timeout: 120_000 });
  if ((await editor.getAttribute('data-render-state')) === 'unsupported') {
    // CI has software WebGPU (SwiftShader flags in playwright.config.ts): there a missing adapter is a failure, not a skip.
    expect(process.env.CI, 'the webgpu project must have WebGPU on CI').toBeFalsy();
    test.skip(true, 'no WebGPU in this local browser');
  }

  const canvas = await editor.locator('canvas').boundingBox();
  expect(canvas).not.toBeNull();

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog.getByRole('radio', { name: '2×' })).toHaveAttribute('aria-checked', 'true');
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByTestId('export-png').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('embed-plant@2x.png');
  const file = testInfo.outputPath('export@2x.png');
  await download.saveAs(file);
  const bytes = await readFile(file);
  const size = pngSize(bytes);
  expect(size.width).toBe(Math.round(canvas!.width * 2));
  expect(size.height).toBe(Math.round(canvas!.height * 2));
  await expect(page.getByTestId('notice').filter({ hasText: `Exported embed-plant@2x.png (${size.width} × ${size.height} px)` })).toBeVisible();

  // Not blank: decode it in the page and count pixels darker than the floor grid.
  const content = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! < 190) dark++;
    return dark / (c.width * c.height);
  }, bytes.toString('base64'));
  expect(content).toBeGreaterThan(0.002);
});
