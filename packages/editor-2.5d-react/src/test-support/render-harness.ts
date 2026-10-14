/**
 * Shared plumbing for the `*-render` browser tests: a Vite dev server rooted at
 * one harness directory, Chromium with WebGPU, and the rendered-signal wait.
 *
 * Wait on the editor's / canvas's `data-render-state="ready"` (render-signal.tsx),
 * never on `waitForTimeout`: the attribute flips only after a presented frame
 * shows the current revision with every GLB loaded.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { CHROMIUM, RENDER_ARGS } from './chromium';

export const PKG_ROOT = path.resolve(import.meta.dirname, '../..');

export interface Harness {
  server: ViteDevServer;
  /** `http://127.0.0.1:<port>` */
  origin: string;
  close(): Promise<void>;
}

/** Serves `src/<dir>` with the iso vite config (GLB reload plugin, fs allow-list). */
export async function startHarness(dir: string): Promise<Harness> {
  const server = await createServer({
    root: path.join(PKG_ROOT, 'src', dir),
    configFile: path.join(PKG_ROOT, 'src/iso/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [PKG_ROOT] } },
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  return { server, origin: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

export function launchRenderBrowser(): Promise<Browser> {
  if (!CHROMIUM) throw new Error('no Chromium for render tests (see test-support/chromium.ts)');
  return chromium.launch({ executablePath: CHROMIUM, headless: true, args: RENDER_ARGS });
}

/** Collects console errors, page errors and failed requests for failure messages. */
export function collectPageLog(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => logs.push(`failed: ${req.url()} ${req.failure()?.errorText}`));
  return logs;
}

/**
 * Resolves once `root` reports `data-render-state="ready"` for its current
 * revision; returns that revision. Throws on `unsupported` (no WebGPU) rather
 * than timing out.
 */
export async function waitForRendered(root: Locator, timeout = 60_000): Promise<number> {
  const handle = await root.elementHandle({ timeout });
  if (!handle) throw new Error('render root not found');
  await root.page().waitForFunction(
    (el) => {
      const state = el.getAttribute('data-render-state');
      return state === 'ready' || state === 'unsupported';
    },
    handle,
    { timeout },
  );
  const state = await root.getAttribute('data-render-state');
  if (state !== 'ready') throw new Error(`render state is ${state} (WebGPU unavailable?)`);
  return Number(await root.getAttribute('data-holodeck-rendered'));
}

/** Resolves after `n` animation frames in the page (frame-counted, not timed). */
export function animationFrames(page: Page, n: number): Promise<void> {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

/**
 * Resolves once at least one `[data-render-state]` element exists and every
 * one reports `ready` (several IsoCanvases on one page, or editor + inner
 * canvas). Throws on `unsupported` instead of timing out. Unlike
 * `waitForRendered` it needs no locator, for tests that own a whole page.
 */
export async function waitForPageRendered(page: Page, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const els = [...document.querySelectorAll('[data-render-state]')];
      if (els.length === 0) return false;
      const states = els.map((el) => el.getAttribute('data-render-state'));
      return states.every((s) => s === 'ready') || states.includes('unsupported');
    },
    undefined,
    { timeout },
  );
  const states = await page.$$eval('[data-render-state]', (els) => els.map((el) => el.getAttribute('data-render-state')));
  if (states.some((s) => s !== 'ready')) throw new Error(`render state is ${states.join(',')} (WebGPU unavailable?)`);
}

/**
 * After a pointer / keyboard / viewport interaction: lets the page commit the
 * resulting state (two animation frames: input handlers and rAF-batched
 * updates run, React commits) and then waits for the new picture to be
 * presented. Replaces `waitForTimeout(<guess>)` after an input.
 */
export async function settle(page: Page, timeout = 60_000): Promise<void> {
  await animationFrames(page, 2);
  await waitForPageRendered(page, timeout);
}

/**
 * ImageMagick's CLI: `magick` (v7, macOS/Homebrew) or `convert` (v6, which is
 * what GitHub's ubuntu runners ship; `magick` does not exist there, found from
 * a CI failure). Both take the same options for the crop/compose calls we use.
 */
export const IMAGEMAGICK = (() => {
  for (const bin of ['magick', 'convert']) {
    if (spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0) return bin;
  }
  return 'magick'; // absent: the command fails with a clear "not found"
})();
