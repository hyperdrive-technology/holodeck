/**
 * E2E over the PRODUCTION build (`pnpm build` first): `vite preview` serves
 * dist/, Playwright drives a real Chromium.
 *
 * Browser: `HOLODECK_CHROMIUM` (CI sets it to the runner's preinstalled
 * Google Chrome; `playwright install` hangs on GitHub-hosted runners,
 * holodeck#29), else a local Google Chrome on macOS, else Playwright's own
 * Chromium (`pnpm exec playwright install chromium`). On CI a missing
 * HOLODECK_CHROMIUM is an error, not a silent fallback.
 *
 * The flow under test needs no GPU (it checks documents, placements and
 * persistence, not pixels), so no WebGPU flags are passed.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4174;

function chromiumPath(): string | undefined {
  const explicit = process.env.HOLODECK_CHROMIUM;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`HOLODECK_CHROMIUM=${explicit} does not exist`);
    return explicit;
  }
  if (process.env.CI) throw new Error('set HOLODECK_CHROMIUM to a Chrome binary on CI (see .github/workflows/ci.yml)');
  return existsSync(MAC_CHROME) ? MAC_CHROME : undefined;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // Generous: the app boots three.js + the engine (~2 MB) and a loaded dev
  // machine can take 10+ s for that. Waits are on DOM state, so a fast run
  // stays fast.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: chromiumPath() } },
    },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
