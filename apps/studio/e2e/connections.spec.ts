/**
 * Connections, secrets, bindings and live values (holodeck#101), over the
 * production build: holodeck.sim, and holodeck.http against the local
 * fixture server (e2e/http-fixture-server.mjs). No real AWS or network.
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { withoutWebGPU } from './fixtures';

const FIXTURE = 'http://127.0.0.1:4181';
const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await withoutWebGPU(page);
});
test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

async function newDocumentWithTank(page: Page) {
  await page.goto('/');
  await page.getByTestId('welcome').getByRole('button', { name: 'New document' }).click();
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}$/);
  await page.locator('[data-library-add="tank"]').click();
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('tank-1');
}

async function addConnection(page: Page, fill: (dialog: ReturnType<Page['getByTestId']>) => Promise<void>) {
  await page.getByRole('tab', { name: /Connections/ }).click();
  await page.getByTestId('connections-panel').getByRole('button', { name: /Add/ }).click();
  const dialog = page.getByTestId('connection-dialog');
  await fill(dialog);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toHaveCount(0);
}

async function bindLevel(page: Page, connection: string, source: string) {
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.getByRole('button', { name: 'Bind Level' }).click();
  const dialog = page.getByTestId('binding-dialog');
  await dialog.getByLabel('Connection', { exact: true }).selectOption(connection);
  await dialog.getByLabel('Source', { exact: true }).fill(source);
  await dialog.getByRole('button', { name: 'Bind' }).click();
  await expect(dialog).toHaveCount(0);
}

test('holodeck.sim: connect, bind, live value, persisted, undoable, live in the embed', async ({ page, context }) => {
  await newDocumentWithTank(page);
  const url = page.url();
  await addConnection(page, async (dialog) => {
    await dialog.getByLabel('Provider', { exact: true }).selectOption('holodeck.sim');
    await dialog.getByLabel('Id', { exact: true }).fill('plant');
  });
  await expect(page.getByTestId('connection-status-plant')).toHaveAttribute('data-state', 'live');

  await bindLevel(page, 'plant', 'const:0.42');
  await expect(page.getByTestId('live-level')).toHaveText('0.42');

  // Saved with the document: a reload reconnects and streams again.
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  await page.reload();
  await expect(page.getByTestId('inspector-object-count')).toHaveText('1');
  await page.getByRole('tab', { name: /Connections \(1\)/ }).click();
  await expect(page.getByTestId('connection-status-plant')).toHaveAttribute('data-state', 'live');

  // The embed of the document streams the same secret-free connection.
  const id = url.split('/').pop()!;
  const embed = await context.newPage();
  await withoutWebGPU(embed);
  await embed.goto(`/embed/${id}`);
  await expect(embed.getByTestId('embed')).toHaveAttribute('data-connections', 'plant:live');
});

test('binding edits are undoable on the canvas', async ({ page }) => {
  await newDocumentWithTank(page);
  await addConnection(page, async (dialog) => {
    await dialog.getByLabel('Provider', { exact: true }).selectOption('holodeck.sim');
    await dialog.getByLabel('Id', { exact: true }).fill('plant');
  });
  await bindLevel(page, 'plant', 'const:0.42');
  await expect(page.getByTestId('live-level')).toHaveText('0.42');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: 'Bind Level' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('live-level')).toHaveText('0.42');
});

test('holodeck.http with a bearer token: live data; the token stays in this tab and never in the document', async ({ page, context }, testInfo) => {
  await newDocumentWithTank(page);
  const url = page.url();
  const docId = url.split('/').pop()!;
  await addConnection(page, async (dialog) => {
    await dialog.getByLabel('Provider', { exact: true }).selectOption('holodeck.http');
    await dialog.getByLabel('Id', { exact: true }).fill('api');
    await dialog.getByLabel('Url *', { exact: true }).fill(`${FIXTURE}/secure`);
    await dialog.getByLabel('Interval Ms', { exact: true }).fill('200');
    await dialog.getByLabel('Auth', { exact: true }).selectOption('bearer');
    await dialog.getByLabel('API token', { exact: true }).fill('e2e-token');
  });
  await expect(page.getByTestId('connection-status-api')).toHaveAttribute('data-state', 'live');

  // Browse the endpoint and pick a signal.
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.getByRole('button', { name: 'Bind Level' }).click();
  const dialog = page.getByTestId('binding-dialog');
  await dialog.getByLabel('Connection', { exact: true }).selectOption('api');
  await dialog.getByRole('button', { name: /Browse/ }).click();
  await dialog.locator('[data-browse-path="/tank"]').click();
  await dialog.locator('[data-browse-path="/tank/level"]').click();
  await expect(dialog.getByLabel('Source', { exact: true })).toHaveValue('/tank/level');
  await dialog.getByRole('button', { name: 'Bind' }).click();
  await expect(page.getByTestId('live-level')).toHaveText('0.73');

  // Export: the connection is there, the token is not.
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Download JSON' }).click();
  const download = await downloadPromise;
  const exportedPath = testInfo.outputPath('exported.json');
  await download.saveAs(exportedPath);
  const exported = await readFile(exportedPath, 'utf8');
  expect(exported).toContain('"provider": "holodeck.http"');
  expect(exported).not.toContain('e2e-token');

  // Storage: the token is in sessionStorage only, never in IndexedDB or localStorage.
  const storage = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('holodeck-studio');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const dump = async (name: string) =>
      new Promise<unknown[]>((resolve) => {
        const req = db.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
      });
    return {
      idb: JSON.stringify([...(await dump('documents')), ...(await dump('views'))]),
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
    };
  });
  expect(storage.session).toContain('e2e-token');
  expect(storage.idb).not.toContain('e2e-token');
  expect(storage.local).not.toContain('e2e-token');

  // Another tab has no secret: the connection asks for it and does not get data.
  const other = await context.newPage();
  await withoutWebGPU(other);
  await other.goto(`/d/${docId}`);
  await other.getByRole('tab', { name: /Connections/ }).click();
  await expect(other.getByTestId('connection-api')).toContainText('Not set in this tab: API token');
  await expect(other.getByTestId('connection-status-api')).not.toHaveAttribute('data-state', 'live');

  // The embed of the same document has no credentials either.
  await other.goto(`/embed/${docId}`);
  await expect(other.getByTestId('embed')).not.toHaveAttribute('data-connections', 'api:live');
});

test('holodeck.http public endpoint works in the editor and in the embed (no secrets needed)', async ({ page, context }) => {
  await newDocumentWithTank(page);
  const docId = page.url().split('/').pop()!;
  await addConnection(page, async (dialog) => {
    await dialog.getByLabel('Provider', { exact: true }).selectOption('holodeck.http');
    await dialog.getByLabel('Id', { exact: true }).fill('pub');
    await dialog.getByLabel('Url *', { exact: true }).fill(`${FIXTURE}/public`);
    await dialog.getByLabel('Interval Ms', { exact: true }).fill('200');
  });
  await bindLevel(page, 'pub', '/tank/level');
  await expect(page.getByTestId('live-level')).toHaveText('0.73');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  const embed = await context.newPage();
  await withoutWebGPU(embed);
  await embed.goto(`/embed/${docId}`);
  await expect(embed.getByTestId('embed')).toHaveAttribute('data-connections', 'pub:live');
});
