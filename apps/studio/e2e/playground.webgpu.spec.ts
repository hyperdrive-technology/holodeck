/**
 * The playground with WebGPU (`webgpu` project): real canvas drag and drop
 * from the library, a move drag on the canvas, then the Viewer re-rendering
 * as live data arrives. Waits on the engine's render signals
 * (`data-render-state`, `data-holodeck-revision`, `data-holodeck-rendered`),
 * never sleeps. Kept to a few interactions: software WebGPU (SwiftShader on
 * Linux CI) is slow and starves input events.
 */
import { expect, test, type Page } from '@playwright/test';

const STARTER_OBJECTS = 12;
const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
});
test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

/** The engine has presented the current revision (every GLB loaded, no camera animation). */
async function rendered(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="process-editor"]');
      return el?.getAttribute('data-render-state') === 'ready' && el.getAttribute('data-holodeck-rendered') === el.getAttribute('data-holodeck-revision');
    },
    null,
    { timeout: 120_000 },
  );
}

const rect = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test('drag a tank from the library onto the canvas, move it, bind it, and watch the Viewer re-render it from live data', async ({ page }) => {
  await page.goto('/playground');
  const editor = page.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-render-state', /ready|unsupported/, { timeout: 120_000 });
  if ((await editor.getAttribute('data-render-state')) === 'unsupported') {
    // CI has software WebGPU (SwiftShader flags in playwright.config.ts): there a missing adapter is a failure, not a skip.
    expect(process.env.CI, 'the webgpu project must have WebGPU on CI').toBeFalsy();
    test.skip(true, 'no WebGPU in this local browser');
  }
  await rendered(page);
  await expect(editor).toHaveAttribute('data-object-count', String(STARTER_OBJECTS));

  // Drag from the library: pointer events, past the 4 px threshold the tank is armed and the ghost follows.
  const item = (await page.locator('[data-library-item="tank"]').boundingBox())!;
  const canvas = await rect(page, 'canvas');
  const drop = { x: canvas.x + canvas.width * 0.3, y: canvas.y + canvas.height * 0.8 };
  await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 10 });
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-placing', 'tank');
  await expect(page.locator('[data-library-item="tank"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.up();
  await expect(editor).toHaveAttribute('data-object-count', String(STARTER_OBJECTS + 1));
  await expect(page.getByTestId('inspector-selected-id')).toHaveText('tank-1');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-placing', '');
  const x = page.getByLabel('X', { exact: true });
  const y = page.getByLabel('Y', { exact: true });
  const dropped = { x: await x.inputValue(), y: await y.inputValue() };

  // Move it on the canvas: press on the new tank (where it was dropped) and drag.
  await rendered(page);
  await page.mouse.move(drop.x, drop.y);
  await page.mouse.down();
  await page.mouse.move(drop.x + 120, drop.y - 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => ({ x: await x.inputValue(), y: await y.inputValue() })).not.toEqual(dropped);
  await expect(editor).toHaveAttribute('data-object-count', String(STARTER_OBJECTS + 1));

  // Bind its level to a sim signal from the browse list.
  await page.getByRole('button', { name: 'Bind Level' }).click();
  const binding = page.getByTestId('binding-dialog');
  await binding.locator('[data-browse-path="sine:10"]').click();
  await binding.getByRole('button', { name: 'Bind' }).click();
  await expect(binding).toHaveCount(0);

  // Viewer: run mode; every new reading is a new picture.
  await page.getByRole('tab', { name: /Viewer/ }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-mode', 'run');
  await expect(page.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live');
  await rendered(page);
  const output = page.getByTestId('live-values').getByLabel('tank-1.level', { exact: true });
  const before = { value: await output.textContent(), presented: Number(await editor.getAttribute('data-holodeck-rendered')) };
  await expect(output).not.toHaveText(before.value!);
  await expect.poll(async () => Number(await editor.getAttribute('data-holodeck-rendered')), { timeout: 60_000 }).toBeGreaterThan(before.presented);

  // Reload: still there, still bound.
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  await page.reload();
  await expect(editor).toHaveAttribute('data-object-count', String(STARTER_OBJECTS + 1));
  await expect(page.getByTestId('live-values').getByLabel('tank-1.level', { exact: true })).toHaveText(/^0(\.\d+)?$|^1$/);
});
