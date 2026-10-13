/**
 * Which Chromium the `*-render` browser tests launch, or `undefined` to skip them.
 *
 * These tests drive a real WebGPU canvas through Playwright. They need a GPU
 * and a Chromium build that exposes WebGPU headless, which GitHub's hosted
 * runners do not have, so CI must skip them cleanly instead of failing.
 *
 * Resolution order:
 *  1. `HOLODECK_SKIP_RENDER_TESTS=1`  -> skip.
 *  2. `HOLODECK_CHROMIUM=/path/to/chrome` -> use it (must exist; also the way to
 *     opt in on a CI runner that does have a GPU).
 *  3. On CI (`CI` set) with no explicit path -> skip. Even if Playwright's
 *     browser happened to be installed, hosted runners have no GPU.
 *  4. Playwright's own installed Chromium (`npx playwright install chromium`).
 *  5. The macOS chromium-1193 build these tests were first written against
 *     (kept so existing dev machines keep working unchanged).
 *
 * Previously every test hard-coded (5); on any other machine the launch failed
 * instead of skipping.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
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
  candidates.push(
    path.join(
      env.HOME ?? '',
      'Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ),
  );
  return candidates.find((p) => p !== '' && existsSync(p));
}

export const CHROMIUM: string | undefined = resolveChromium();
