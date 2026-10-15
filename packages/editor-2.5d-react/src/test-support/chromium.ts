/**
 * Which Chromium the `*-render` browser tests (and
 * scripts/make-reference-canvas.mjs) launch, and with which flags.
 *
 * These tests drive a real WebGPU canvas through Playwright. Resolution order
 * for the browser binary (`resolveChromium`, unit-tested in chromium.test.ts):
 *  1. `HOLODECK_SKIP_RENDER_TESTS=1`  -> skip (the only sanctioned opt-out).
 *  2. `HOLODECK_CHROMIUM=/path/to/chrome` -> use it. A path that does not exist
 *     resolves to nothing (no fallback: the caller asked for that binary).
 *     CI sets this to the hosted runner's preinstalled Google Chrome. We do NOT
 *     `playwright install` on CI: it hangs while unpacking on hosted runners.
 *  3. On CI (`isCi()`) with no explicit path -> nothing.
 *  4. Playwright's own Chromium for the pinned `playwright` devDependency
 *     (`pnpm exec playwright install chromium`): a fixed build, so the
 *     Arcentry fidelity score is reproducible (holodeck#68).
 *  5. A system Google Chrome on macOS, so a fresh dev machine still runs the
 *     render tests. It auto-updates, so it is `pinned: false` and the fidelity
 *     gate (scene-render.test.ts) refuses to judge on it.
 *
 * In CI (`required`) a run with no browser FAILS instead of skipping: see the
 * guard in render-harness.test.ts (holodeck#78).
 *
 * Flags: `RENDER_ARGS` below. They are the same set core's e2e uses to run the
 * WebGPU editor headless on GPU-less Linux (SwiftShader software Vulkan), and
 * are harmless on a Mac with a real GPU. Launch only through
 * `launchRenderBrowser()` (render-harness.ts) so every test gets the same
 * flags. CI wiring: .github/workflows/ci.yml, "Select browser for render tests".
 *
 * Note the `./ci.ts` import extension: scripts/make-reference-canvas.mjs imports
 * this file directly with Node's TypeScript type stripping, which (unlike Vite)
 * does not guess extensions. tsconfig sets `allowImportingTsExtensions` for it.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { isCi } from './ci.ts';

export type ChromiumSource = 'env' | 'playwright' | 'system';

export interface ChromiumResolution {
  /** Browser binary, or undefined when render tests cannot run. */
  path?: string;
  source?: ChromiumSource;
  /** A fixed build (explicit HOLODECK_CHROMIUM or Playwright's): fidelity scores are comparable. */
  pinned: boolean;
  /** Render tests must run here (CI, not opted out): no browser is a failure, not a skip. */
  required: boolean;
  /** Human-readable: why `path` is undefined, or what was picked. */
  reason: string;
}

export interface ResolveChromiumDeps {
  exists?: (path: string) => boolean;
  /** Playwright's Chromium for its pinned version; may throw on unsupported platforms. */
  playwrightPath?: () => string;
  systemChrome?: readonly string[];
}

const SYSTEM_CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const INSTALL_HINT = 'run `pnpm exec playwright install chromium` (pinned build) or set HOLODECK_CHROMIUM';

export function resolveChromium(
  env: Readonly<Record<string, string | undefined>> = process.env,
  {
    exists = existsSync,
    playwrightPath = () => chromium.executablePath(),
    systemChrome = SYSTEM_CHROME,
  }: ResolveChromiumDeps = {},
): ChromiumResolution {
  if (env.HOLODECK_SKIP_RENDER_TESTS === '1') {
    return { pinned: false, required: false, reason: 'HOLODECK_SKIP_RENDER_TESTS=1' };
  }
  const required = isCi(env);
  if (env.HOLODECK_CHROMIUM) {
    const p = env.HOLODECK_CHROMIUM;
    return exists(p)
      ? { path: p, source: 'env', pinned: true, required, reason: `HOLODECK_CHROMIUM=${p}` }
      : { pinned: false, required, reason: `HOLODECK_CHROMIUM=${p} does not exist` };
  }
  if (required) {
    return {
      pinned: false,
      required,
      reason:
        'CI without HOLODECK_CHROMIUM: CI must point it at a browser (ci.yml "Select browser for render tests") ' +
        'or opt out with HOLODECK_SKIP_RENDER_TESTS=1',
    };
  }
  let pw: string | undefined;
  try {
    pw = playwrightPath();
  } catch {
    // executablePath() throws on platforms Playwright has no build for.
  }
  if (pw && exists(pw)) return { path: pw, source: 'playwright', pinned: true, required, reason: `Playwright Chromium ${pw}` };
  const sys = systemChrome.find((p) => exists(p));
  if (sys) {
    return {
      path: sys,
      source: 'system',
      pinned: false,
      required,
      reason: `system Chrome ${sys} (auto-updates, unpinned: ${INSTALL_HINT} for fidelity runs)`,
    };
  }
  return { pinned: false, required, reason: `no Chromium found: ${INSTALL_HINT}` };
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

export const CHROMIUM_RESOLUTION: ChromiumResolution = resolveChromium();
export const CHROMIUM: string | undefined = CHROMIUM_RESOLUTION.path;
