/**
 * Shared plumbing for the `*-render` browser tests: a Vite dev server rooted at
 * one harness directory, Chromium with WebGPU, and the rendered-signal wait.
 *
 * Wait on the editor's / canvas's `data-render-state="ready"` (render-signal.tsx),
 * never on `waitForTimeout`: the attribute flips only after a presented frame
 * shows the current revision with every GLB loaded.
 */
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { CHROMIUM } from './chromium';

export const PKG_ROOT = path.resolve(import.meta.dirname, '../..');

/** Flags that expose WebGPU in headless Chromium (same as the existing render tests). */
export const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist'];

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
  return chromium.launch({ executablePath: CHROMIUM, headless: true, args: WEBGPU_ARGS });
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
