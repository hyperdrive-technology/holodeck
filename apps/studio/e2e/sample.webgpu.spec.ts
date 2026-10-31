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

// Small viewport + 1x export: the hosted Linux runner renders WebGPU with
// SwiftShader, which couldn't export this scene at 2x / 1280x800 in minutes
// (holodeck#175). ~8x fewer pixels keeps the full check on CI.
test.use({ viewport: { width: 1080, height: 520 } });

// On the hosted runner this test takes 1.1 to 3.2 min (CI logs, 2026-10-30/31:
// main 2.5 and 3.2 min, other branches 1.1 to 1.9 min) and failed several
// times at the 3 min project limit, waiting for the download. The budget is
// sized for the slow end; waits stay on events, so a fast run stays fast.
test.setTimeout(480_000);

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
  expect(failedAssets).toEqual([]);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByTestId('export-dialog');
  await dialog.getByRole('radio', { name: '1×' }).click();
  await expect(dialog.getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true');
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await dialog.getByTestId('export-png').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('three-tier-web-app@1x.png');
  const file = testInfo.outputPath('sample.png');
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(bytes.readUInt32BE(16)).toBe(Math.round(bounds!.width));
  expect(bytes.readUInt32BE(20)).toBe(Math.round(bounds!.height));
  await expect(dialog).toHaveCount(0);

  // Visual baseline from the engine's own 1x PNG export (deterministic offscreen
  // render), not a browser screenshot: on the CI runner SwiftShader can't
  // produce compositor screenshots of this scene within minutes, while the
  // export path renders fine. Playwright image-compares PNG snapshots with the
  // tolerances below. Update per platform with --update-snapshots (README).
  //
  // Tolerance (holodeck#176): at most 25 differing pixels (~0.01% of the
  // 508x476 export) instead of the old 1% ratio (~2.4k pixels), which could
  // hide a lost threshold tint or a missing part. Measured: the offscreen
  // export is deterministic; three consecutive local darwin runs matched the
  // baseline with maxDiffPixels 0 (threshold 0.2 already absorbs per-pixel
  // antialiasing drift). The small non-zero budget only covers GPU/driver
  // rounding on the SwiftShader linux CI; a real regression changes hundreds
  // of pixels. If linux CI flakes, raise this number (not the ratio) and
  // record the observed diff count here.
  expect(bytes).toMatchSnapshot('three-tier-web-app@1x.png', { threshold: 0.2, maxDiffPixels: 25 });
  expect(failedAssets).toEqual([]);

});
