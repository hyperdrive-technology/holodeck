/**
 * The playground (`/playground`) over the production build, without WebGPU
 * (the `chromium` project): everything that does not need pixels. Library
 * "+" adds objects (a canvas drag needs the rendered canvas: see
 * playground.webgpu.spec.ts), the inspector moves / configures / binds them,
 * the Viewer tab streams live values. Waits are on DOM state, never sleeps.
 */
import { expect, test, type Page } from '@playwright/test';
import { withoutWebGPU } from './fixtures';

const STARTER_OBJECTS = 12;
const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await withoutWebGPU(page);
});
test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

async function openPlayground(page: Page, tab?: 'edit' | 'viewer') {
  await page.goto(tab ? `/playground?tab=${tab}` : '/playground');
  await expect(page.getByTestId('process-editor')).toHaveAttribute('data-render-state', 'unsupported');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
}

const objectCount = (page: Page) => page.getByTestId('process-editor');

/** A number from a live value output, polled until it differs from `before`. */
async function expectValueToChange(page: Page, label: string) {
  const output = page.getByTestId('live-values').getByLabel(label, { exact: true });
  await expect(output).toHaveText(/^-?\d/);
  const before = await output.textContent();
  await expect(output).not.toHaveText(before!);
}

test('zero config: the starter scene animates in the Viewer, the tab is linkable and survives a reload', async ({ page }) => {
  await openPlayground(page);
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS));
  await expect(page.getByRole('tab', { name: /Edit/ })).toHaveAttribute('aria-selected', 'true');
  // No studio document list or welcome on this page.
  await expect(page.getByTestId('welcome')).toHaveCount(0);
  await expect(page.getByTestId('document-list')).toHaveCount(0);

  await page.getByRole('tab', { name: /Viewer/ }).click();
  await expect(page).toHaveURL(/\/playground\?tab=viewer$/);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'run');
  await expect(page.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('library')).toHaveCount(0);
  await expectValueToChange(page, 'feed-tank.level');
  await expectValueToChange(page, 'mixer.rpm');

  await page.reload();
  await expect(page.getByRole('tab', { name: /Viewer/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live');
  await page.goBack();
  // The route writes the default tab into the URL (validateSearch).
  await expect(page).toHaveURL(/\/playground(\?tab=edit)?$/);
  await expect(page.getByRole('tab', { name: /Edit/ })).toHaveAttribute('aria-selected', 'true');
});

test('build without WebGPU: add a tank, move it, edit a param, add a sim connection, bind, watch it in the Viewer; reload keeps it; Reset restores', async ({ page }) => {
  await openPlayground(page);
  await page.locator('[data-library-add="tank"]').click();
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS + 1));
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('tank-1');

  // Move it and edit a parameter in the inspector (undoable editor actions).
  const x = page.getByLabel('X', { exact: true });
  await x.fill('-8');
  await x.press('Enter');
  await expect(x).toHaveValue('-8');
  const temperature = page.getByLabel('Temperature', { exact: true });
  await temperature.fill('55');
  await temperature.press('Enter');
  await expect(temperature).toHaveValue('55');

  // A provider source of our own: a second sim connection.
  await page.getByRole('tab', { name: /Connections/ }).click();
  await page.getByTestId('connections-panel').getByRole('button', { name: /Add/ }).click();
  const connection = page.getByTestId('connection-dialog');
  await connection.getByLabel('Provider', { exact: true }).selectOption('holodeck.sim');
  await connection.getByLabel('Id', { exact: true }).fill('plant');
  await connection.getByRole('button', { name: 'Add' }).click();
  await expect(connection).toHaveCount(0);
  await expect(page.getByTestId('connection-status-plant')).toHaveAttribute('data-state', 'live');

  // Bind the new tank's level: the dialog lists the signals and suggests the 0-100 -> 0..1 scale.
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.getByRole('button', { name: 'Bind Level' }).click();
  const binding = page.getByTestId('binding-dialog');
  await binding.getByLabel('Connection', { exact: true }).selectOption('plant');
  await binding.locator('[data-browse-path="sine:10"]').click();
  await expect(binding.getByLabel('Source', { exact: true })).toHaveValue('sine:10');
  await expect(binding.getByTestId('binding-suggested-scale')).toContainText('0–1');
  await binding.getByRole('button', { name: 'Bind' }).click();
  await expect(binding).toHaveCount(0);
  const inspectorLevel = page.getByTestId('live-level');
  await expect(inspectorLevel).toHaveText(/^0(\.\d+)?$|^1$/);

  await page.getByRole('tab', { name: /Viewer/ }).click();
  await expect(page.getByTestId('viewer-status-plant')).toHaveAttribute('data-state', 'live');
  await expectValueToChange(page, 'tank-1.level');
  const level = Number(await page.getByTestId('live-values').getByLabel('tank-1.level', { exact: true }).textContent());
  expect(level).toBeGreaterThanOrEqual(0);
  expect(level).toBeLessThanOrEqual(1);

  // Reload: scene, connection and binding are kept.
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  await page.reload();
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS + 1));
  await expect(page.getByTestId('viewer-status-plant')).toHaveAttribute('data-state', 'live');
  await expectValueToChange(page, 'tank-1.level');

  // Reset: back to the starter (scene and connections).
  await page.getByRole('button', { name: /Reset/ }).click();
  await page.getByTestId('reset-dialog').getByRole('button', { name: 'Reset' }).click();
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS));
  await expect(page.getByTestId('viewer-connection-plant')).toHaveCount(0);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  await page.reload();
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS));
});

test('undo / redo from the header; tab switches keep the selection and the history', async ({ page }) => {
  await openPlayground(page);
  await page.locator('[data-library-add="valve"]').click();
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS + 1));
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('valve-1');
  await page.getByRole('tab', { name: /Viewer/ }).click();
  await page.getByRole('tab', { name: /Edit/ }).click();
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('valve-1');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS));
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(objectCount(page)).toHaveAttribute('data-object-count', String(STARTER_OBJECTS + 1));
});

test('a broken HTTP source: error badge and message in the Viewer, the rest keeps streaming, no crash', async ({ page }) => {
  await openPlayground(page);
  await page.getByRole('tab', { name: /Connections/ }).click();
  await page.getByTestId('connections-panel').getByRole('button', { name: /Add/ }).click();
  const dialog = page.getByTestId('connection-dialog');
  await dialog.getByLabel('Provider', { exact: true }).selectOption('holodeck.http');
  await dialog.getByLabel('Id', { exact: true }).fill('broken');
  // Nothing listens on port 9 (discard).
  await dialog.getByLabel('Url *', { exact: true }).fill('http://127.0.0.1:9/plant.json');
  await dialog.getByLabel('Interval Ms', { exact: true }).fill('200');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toHaveCount(0);
  // A provider only fetches what something is bound to: bind a new tank's level to it.
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.locator('[data-library-add="tank"]').click();
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('tank-1');
  await page.getByRole('button', { name: 'Bind Level' }).click();
  const binding = page.getByTestId('binding-dialog');
  await binding.getByLabel('Connection', { exact: true }).selectOption('broken');
  await binding.getByLabel('Source', { exact: true }).fill('/tank/level');
  await binding.getByRole('button', { name: 'Bind' }).click();
  await expect(binding).toHaveCount(0);

  await page.getByRole('tab', { name: /Viewer/ }).click();
  await expect(page.getByTestId('viewer-status-broken')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('viewer-message-broken')).not.toBeEmpty();
  await expect(page.getByTestId('viewer-problems')).toContainText('broken');
  await expect(page.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live');
  await expectValueToChange(page, 'feed-tank.level');
  // The tank it drives has no reading (it keeps its own params): nothing invented.
  await expect(page.getByTestId('live-values').getByLabel('tank-1.level', { exact: true })).toHaveCount(0);
});

test('Pause freezes the Viewer values; Resume follows the feed again', async ({ page }) => {
  await openPlayground(page, 'viewer');
  await expect(page.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live');
  await expectValueToChange(page, 'feed-tank.level');
  await page.getByTestId('viewer-pause').click();
  await expect(page.getByTestId('viewer-paused')).toBeVisible();
  const output = page.getByTestId('live-values').getByLabel('feed-tank.level', { exact: true });
  const frozen = await output.textContent();
  // Several sim intervals (250 ms) later, still the frozen value; the provider's own stream is not stopped.
  await page.waitForFunction(() => new Promise((resolve) => setTimeout(() => resolve(true), 1000)));
  await expect(output).toHaveText(frozen!);
  await page.getByTestId('viewer-pause').click();
  await expect(output).not.toHaveText(frozen!);
});
