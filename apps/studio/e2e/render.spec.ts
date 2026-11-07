/**
 * `/render` (headless capture for @holodeck/mcp scene_render): the document
 * comes from a window global set before load, is validated like an import,
 * and is drawn in run mode. GPU-free: WebGPU is removed, so the canvas must
 * say `unsupported` (the MCP turns that into an explicit error, never a blank PNG).
 */
import { expect, test, type Page } from '@playwright/test';
import { EMBED_SCENE, withoutWebGPU } from './fixtures';

async function inject(page: Page, doc: unknown) {
  await page.addInitScript((value) => {
    (window as unknown as Record<string, unknown>).__HOLODECK_RENDER__ = value;
  }, doc);
}

test('a valid document renders in run mode; without WebGPU the state is unsupported', async ({ page }) => {
  await withoutWebGPU(page);
  await inject(page, EMBED_SCENE);
  await page.goto('/render');
  await expect(page.getByTestId('render')).toHaveAttribute('data-render-input', 'ok');
  const editor = page.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-host-mode', 'run');
  await expect(editor).toHaveAttribute('data-object-count', '2');
  await expect(editor).toHaveAttribute('data-render-state', 'unsupported');
});

test('an invalid document lists its problems and draws nothing', async ({ page }) => {
  await inject(page, { format: 'holodeck.document.v1', id: 'x' });
  await page.goto('/render');
  await expect(page.getByTestId('render')).toHaveAttribute('data-render-input', 'invalid');
  await expect(page.getByTestId('render-problems').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('process-editor')).toHaveCount(0);
});

test('no input: says so', async ({ page }) => {
  await page.goto('/render');
  await expect(page.getByTestId('render')).toHaveAttribute('data-render-input', 'missing');
});
