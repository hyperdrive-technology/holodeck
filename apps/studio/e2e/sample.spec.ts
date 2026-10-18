/** S3 golden path, over the production build. Pixels and PNG live in sample.webgpu.spec.ts. */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { withoutWebGPU } from './fixtures';
import { SAMPLE_OBJECT_COUNT, seedSampleDocument } from './sample-fixtures';

const pageErrors: Error[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await withoutWebGPU(page);
});
test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

test('sample: placements, connectors, live labels, JSON / CSV, reload and read-only live embed', async ({ page, context }, testInfo) => {
  const id = await seedSampleDocument(page);
  const editor = page.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-render-state', 'unsupported');
  await expect(page.getByLabel('Document name')).toHaveValue('Three-tier web app');
  // The installed cloud package is also available for further placement.
  await expect(page.locator('[data-library-add="cloud:server"]')).toBeVisible();
  await page.getByRole('tab', { name: /Connections \(1\)/ }).click();
  await expect(page.getByTestId('connection-status-demo')).toHaveAttribute('data-state', 'live');

  const label = page.getByLabel('requests-label.text', { exact: true });
  await expect(label).toHaveText(/^Requests \d+ req\/s$/);
  const first = await label.textContent();
  await expect(label).not.toHaveText(first!);
  await expect(page.getByLabel('web-1.color', { exact: true })).toHaveText(/^#(22c55e|f59e0b|ef4444)$/);
  await expect.poll(async () => Number(await page.getByLabel('cpu-label.value', { exact: true }).textContent())).toBeGreaterThanOrEqual(0);
  expect(Number(await page.getByLabel('cpu-label.value', { exact: true }).textContent())).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  let downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Download JSON' }).click();
  let download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('three-tier-web-app.holodeck.json');
  const jsonPath = testInfo.outputPath('sample.holodeck.json');
  await download.saveAs(jsonPath);
  const doc = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(doc).toMatchObject({ format: 'holodeck.document.v1', id, name: 'Three-tier web app', engine: 'holodeck.iso', requires: { 'holodeck.cloud': '^0.1', 'holodeck.sim': '^1.0' } });
  expect(doc.body.objects).toHaveLength(Number(SAMPLE_OBJECT_COUNT));
  expect(doc.body.objects).toContainEqual(expect.objectContaining({ id: 'web-1', object: 'cloud:server', x: 6, y: -4 }));
  const connectors = doc.body.objects.filter((o: { object: string }) => o.object === 'connector');
  expect(connectors).toHaveLength(14);
  expect(connectors).toContainEqual(expect.objectContaining({
    id: 'users-to-cdn', link: { from: { object: 'users' }, to: { object: 'cdn' } }, params: expect.objectContaining({ label: 'HTTPS', endTip: 'arrow' }),
  }));
  expect(doc.body.objects.filter((o: { object: string }) => o.object === 'area').map((o: { id: string }) => o.id)).toEqual(['vpc', 'public-subnet', 'private-subnet']);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Download CSV' }).click();
  download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('three-tier-web-app.components.csv');
  const csvPath = testInfo.outputPath('sample.components.csv');
  await download.saveAs(csvPath);
  const csv = await readFile(csvPath, 'utf8');
  const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
  expect(lines).toHaveLength(Number(SAMPLE_OBJECT_COUNT) + 1);
  expect(lines[0]).toContain('meta:service');
  expect(csv).toMatch(/web-1,cloud:server,/);
  expect(csv).toMatch(/users-to-cdn,connector,/);

  await page.reload();
  await expect(editor).toHaveAttribute('data-object-count', SAMPLE_OBJECT_COUNT);
  await expect(label).toHaveText(/^Requests \d+ req\/s$/);
  const revision = await page.getByTestId('canvas').getAttribute('data-revision');

  const embed = await context.newPage();
  embed.on('pageerror', (error) => pageErrors.push(error));
  await withoutWebGPU(embed);
  await embed.goto(`/embed/${id}`);
  await expect(embed.getByTestId('embed')).toHaveAttribute('data-connections', 'demo:live');
  const view = embed.getByTestId('process-editor');
  await expect(view).toHaveAttribute('data-host-mode', 'run');
  await expect(view).toHaveAttribute('data-object-count', SAMPLE_OBJECT_COUNT);
  await expect(embed.getByTestId('sidebar')).toHaveCount(0);
  await expect(embed.getByTestId('inspector-panel')).toHaveCount(0);
  await expect(embed.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
  const embeddedLabel = embed.getByLabel('requests-label.text', { exact: true });
  await expect(embeddedLabel).toHaveText(/^Requests \d+ req\/s$/);
  const embeddedFirst = await embeddedLabel.textContent();
  await expect(embeddedLabel).not.toHaveText(embeddedFirst!);
  await view.click({ position: { x: 20, y: 20 } });
  await embed.keyboard.press('ControlOrMeta+a');
  await embed.keyboard.press('Delete');
  await expect(view).toHaveAttribute('data-object-count', SAMPLE_OBJECT_COUNT);
  await page.reload();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-revision', revision!);
});

test('New from sample creates independent documents; the bundled JSON also imports', async ({ page }) => {
  const firstId = await seedSampleDocument(page);
  await page.getByRole('button', { name: 'New from sample', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`/d/${firstId}$`));
  await expect(page.getByTestId('process-editor')).toHaveAttribute('data-object-count', SAMPLE_OBJECT_COUNT);
  await expect(page.getByTestId('document-list').getByRole('link', { name: 'Three-tier web app', exact: true })).toHaveCount(2);
  await page.getByTestId('import-input').setInputFiles(new URL('../samples/three-tier-web-app.holodeck.json', import.meta.url).pathname);
  await expect(page).toHaveURL(/\/d\/sample-three-tier-web-app$/);
  await expect(page.getByTestId('process-editor')).toHaveAttribute('data-object-count', SAMPLE_OBJECT_COUNT);
});
