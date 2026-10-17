/**
 * Shared e2e fixtures for the export / embed specs (holodeck#42).
 */
import { expect, type Page } from '@playwright/test';

/** A bare legacy scene (the importer wraps it in a holodeck.document.v1 envelope). The tank's metadata carries a formula to check CSV defusing end to end. */
export const EMBED_SCENE = {
  id: 'e2e-embed',
  name: 'Embed Plant',
  gridCellSize: 1,
  objects: [
    { id: 'tank-1', object: 'tank', x: 0, y: 0, meta: { tag: '=HYPERLINK("http://evil.example","x")', volume: 20 } },
    { id: 'valve-1', object: 'valve', x: 4, y: 0 },
  ],
};

/** Import `EMBED_SCENE` through the file input and wait until it is open. */
export async function seedEmbedDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('import-input').setInputFiles({
    name: 'embed-plant.holodeck.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(EMBED_SCENE)),
  });
  await expect(page).toHaveURL(/\/d\/e2e-embed$/);
  await expect(page.getByTestId('process-editor')).toHaveAttribute('data-object-count', '2');
}

/** Removes WebGPU in every frame: the GPU-free suites check documents and messages, not pixels. */
export async function withoutWebGPU(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu;
  });
}
