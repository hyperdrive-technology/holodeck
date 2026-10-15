/**
 * Which Chromium the `*-render` browser tests launch, and with which flags.
 *
 * These tests drive a real WebGPU canvas through Playwright. Resolution order
 * for the browser binary:
 *  1. `HOLODECK_SKIP_RENDER_TESTS=1`  -> skip.
 *  2. `HOLODECK_CHROMIUM=/path/to/chrome` -> use it (must exist, else skip).
 *     CI sets this to the hosted runner's preinstalled Google Chrome. We do NOT
 *     `playwright install` on CI: it hangs while unpacking on hosted runners.
 *  3. On CI (`CI` set) with no explicit path -> skip.
 *  4. Playwright's own installed Chromium (`npx playwright install chromium`).
 *  5. A system Google Chrome on macOS (so a fresh dev machine works unchanged).
 *
 * Flags: `RENDER_ARGS` below. They are the same set core's e2e uses to run the
 * WebGPU editor headless on GPU-less Linux (SwiftShader software Vulkan), and
 * are harmless on a Mac with a real GPU. Launch only through
 * `launchRenderBrowser()` (render-harness.ts) so every test gets the same
 * flags. CI wiring: .github/workflows/ci.yml, "Select browser for render tests".
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

function resolveChromium(): string | undefined {
  const env = process.env;
  if (env.HOLODECK_SKIP_RENDER_TESTS === '1') return undefined;
  if (env.HOLODECK_CHROMIUM) {
    return existsSync(env.HOLODECK_CHROMIUM) ? env.HOLODECK_CHROMIUM : undefined;
  }
  if (env.CI) return undefined;
  const candidates: string[] = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    // executablePath() throws on platforms Playwright has no build for.
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return candidates.find((p) => p !== '' && existsSync(p));
}

/**
 * Chromium flags for headless WebGPU. On Linux (the CI runners, no GPU) the
 * SwiftShader flags select a software Vulkan/WebGPU adapter; on macOS Chromium
 * keeps using the real GPU (forcing SwiftShader there would change pixels).
 */
export const RENDER_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  // Chromium honours only one --enable-features, so the list differs per platform.
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

export const CHROMIUM: string | undefined = resolveChromium();
