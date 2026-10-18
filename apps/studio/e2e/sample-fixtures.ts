import { expect, type Page } from '@playwright/test';
import sample from '../samples/three-tier-web-app.holodeck.json' with { type: 'json' };

export const SAMPLE_OBJECT_COUNT = String(sample.body.objects.length);

/** Exercise the same creation path as a Studio user; never seed IndexedDB directly. */
export async function seedSampleDocument(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByTestId('welcome').getByRole('button', { name: 'New from sample: Three-tier web app' }).click();
  await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('process-editor')).toHaveAttribute('data-object-count', SAMPLE_OBJECT_COUNT);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  return page.url().split('/').pop()!;
}
