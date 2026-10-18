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
 * Two projects:
 *  - `chromium`: the GPU-free suites (documents, placements, persistence,
 *    embed messages; they delete `navigator.gpu`), no WebGPU flags.
 *  - `webgpu`: `*.webgpu.spec.ts` only (PNG export, holodeck#42), with the
 *    same headless-WebGPU flags as the engine's render tests (SwiftShader
 *    software Vulkan on GPU-less Linux CI). Kept to a few interactions:
 *    software WebGPU is slow and starves input events.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Headless WebGPU flags. Same list as RENDER_ARGS in
 * packages/editor-2.5d-react/src/test-support/chromium.ts (keep them in step;
 * that module imports `playwright`, which this app does not depend on).
 */
const WEBGPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  ...(process.platform !== 'linux'
    ? ['--enable-features=WebGPU']
    : [
        '--enable-features=WebGPU,Vulkan',
        '--use-vulkan=swiftshader',
        '--use-webgpu-adapter=swiftshader',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ]),
];
const PORT = 4174;
export const HTTP_FIXTURE_PORT = 4181;

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
      testIgnore: /\.webgpu\.spec\.ts$/,
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: chromiumPath() } },
    },
    {
      name: 'webgpu',
      testMatch: /\.webgpu\.spec\.ts$/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        launchOptions: { executablePath: chromiumPath(), args: WEBGPU_ARGS },
      },
    },
  ],
  webServer: [
    {
      command: `pnpm exec vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Local JSON for the holodeck.http connection tests (e2e/connections.spec.ts).
      command: `node e2e/http-fixture-server.mjs`,
      url: `http://127.0.0.1:${HTTP_FIXTURE_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { HTTP_FIXTURE_PORT: String(HTTP_FIXTURE_PORT) },
    },
  ],
});
