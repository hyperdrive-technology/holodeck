/** Sample PNG download and visual baseline; runs only in the WebGPU project. */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { seedSampleDocument } from './sample-fixtures';

const pageErrors: Error[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  // Fixed Date.now, but normal timers / requestAnimationFrame: sim readings stay
  // at CPU=25%, requests=300 without stopping asset loading or WebGPU frames.
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:02Z'));
});
test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

test('sample visual baseline and PNG download', async ({ page }, testInfo) => {
  const failedAssets: string[] = [];
  page.on('response', (response) => {
    if (/\.(glb|svg)(\?|$)/.test(response.url()) && !response.ok()) failedAssets.push(response.url());
  });
  await seedSampleDocument(page);
  const editor = page.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-render-state', /ready|unsupported/, { timeout: 120_000 });
  if ((await editor.getAttribute('data-render-state')) === 'unsupported') {
    expect(process.env.CI, 'the webgpu project must have WebGPU on CI').toBeFalsy();
    test.skip(true, 'no WebGPU in this local browser');
  }
  await expect(page.getByLabel('requests-label.text', { exact: true })).toHaveText('Requests 300 req/s');
  await expect(page.getByLabel('cpu-label.value', { exact: true })).toHaveText('0.25');
  const canvas = editor.locator('canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();

  // Taken before the export: its toast overlays the canvas region. Canvas only: exclude timestamped Studio chrome. The editor's ready signal
  // includes pending GLBs/textures; Playwright also waits for stable screenshots.
  // See README for first capture and updates on the same platform/adapter.
  await expect(editor).toHaveAttribute('data-render-state', 'ready', { timeout: 120_000 });
  await expect(canvas).toHaveScreenshot('three-tier-web-app.png', {
    animations: 'disabled', threshold: 0.2, maxDiffPixelRatio: 0.01,
  });

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog.getByRole('radio', { name: '2×' })).toHaveAttribute('aria-checked', 'true');
  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByTestId('export-png').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('three-tier-web-app@2x.png');
  const file = testInfo.outputPath('sample@2x.png');
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(bytes.readUInt32BE(16)).toBe(Math.round(bounds!.width * 2));
  expect(bytes.readUInt32BE(20)).toBe(Math.round(bounds!.height * 2));
  await expect(dialog).toHaveCount(0);
  expect(failedAssets).toEqual([]);

});
