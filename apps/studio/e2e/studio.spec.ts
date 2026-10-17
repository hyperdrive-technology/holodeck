/**
 * Studio golden path over the production build:
 * create a document -> place parts from the library -> reload -> still there;
 * then export, re-import (as a copy), reject a bad file, and the shortcuts dialog.
 *
 * Waits are on DOM state (data attributes, roles), never sleeps.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const editor = (page: Page) => page.getByTestId('process-editor');
const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  // GPU-free on purpose: this suite checks documents, placements and
  // persistence, not pixels (the engine's render tests in
  // packages/editor-2.5d-react cover drawing). Headless WebGPU on a busy or
  // GPU-less runner takes seconds per frame and starves input events, which
  // made every click here time out. Without `navigator.gpu` the editor mounts
  // with `data-render-state="unsupported"` and all editing state intact.
  await page.addInitScript(() => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  });
});

test.afterEach(() => {
  // Uncaught exceptions in the app fail the test even when the UI looked fine.
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

test('create, place, reload, export, import', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();

  // Create.
  await page.getByTestId('welcome').getByRole('button', { name: 'New document' }).click();
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}$/);
  await expect(editor(page)).toHaveAttribute('data-object-count', '0');
  await expect(editor(page)).toHaveAttribute('data-render-state', 'unsupported');
  await expect(page.getByTestId('document-list').getByRole('link', { name: 'Untitled' })).toBeVisible();

  // Rename from the inspector.
  const name = page.getByLabel('Document name');
  await name.fill('E2E Plant');
  await name.press('Enter');
  await expect(page.getByTestId('document-list').getByRole('link', { name: 'E2E Plant' })).toBeVisible();

  // Place from the library: a tank, then a valve found by search.
  await page.locator('[data-library-item="tank"]').click();
  await expect(editor(page)).toHaveAttribute('data-object-count', '1');
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('tank-1');

  await page.getByLabel('Search the library').fill('valve');
  await expect(page.locator('[data-library-item="tank"]')).toHaveCount(0);
  await page.locator('[data-library-item="valve"]').click();
  await expect(editor(page)).toHaveAttribute('data-object-count', '2');
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('valve-1');

  // Reload: the document, its name and both placements come back from IndexedDB.
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(editor(page)).toHaveAttribute('data-object-count', '2');
  await expect(page.getByTestId('inspector-object-count')).toHaveText('2');
  await expect(page.getByLabel('Document name')).toHaveValue('E2E Plant');

  // Export.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('e2e-plant.holodeck.json');
  const exportedPath = testInfo.outputPath('exported.holodeck.json');
  await download.saveAs(exportedPath);
  const exported = JSON.parse(await readFile(exportedPath, 'utf8'));
  expect(exported).toMatchObject({ format: 'holodeck.document.v1', name: 'E2E Plant', engine: 'holodeck.iso', requires: { 'holodeck.iso': '^1.0' } });
  expect(exported.body.objects.map((o: { id: string }) => o.id)).toEqual(['tank-1', 'valve-1']);

  // Re-import the same file: the id exists, so it lands as a copy and opens.
  await page.getByTestId('import-input').setInputFiles(exportedPath);
  await expect(page.getByTestId('notice').filter({ hasText: 'imported as a copy' })).toBeVisible();
  await expect(page.getByTestId('document-list').getByRole('link', { name: 'E2E Plant' })).toHaveCount(2);
  await expect(page).not.toHaveURL(url);
  await expect(editor(page)).toHaveAttribute('data-object-count', '2');

  // A broken file is refused with its problems listed.
  await page.getByTestId('import-input').setInputFiles({
    name: 'broken.holodeck.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'holodeck.document.v1', id: 'x', name: 'X', engine: 'holodeck.flow', body: {} })),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'Could not import broken.holodeck.json' })).toContainText('holodeck.flow');
  await expect(page.getByTestId('document-list').getByRole('listitem')).toHaveCount(2);
});

test('keyboard shortcuts dialog and panel toggles', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page.getByTestId('sidebar')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+b');
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  // Mod+K reopens the sidebar and focuses the library search.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByLabel('Search the library')).toBeFocused();
});
