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

/**
 * The one way render tests launch Chromium: the resolved binary (chromium.ts)
 * with RENDER_ARGS (WebGPU; SwiftShader software Vulkan on GPU-less Linux CI).
 */
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
 * Resolves once every `[data-render-state]` element in `scope` reports
 * `ready` for its current revision, and at least one exists. `scope` is a
 * locator (the element itself and/or its descendants carry the attribute) or
 * a whole page (several IsoCanvases, or editor + inner canvas). Elements are
 * re-queried on every poll, so canvases that mount late are waited for too.
 * Throws on `unsupported` (no WebGPU) rather than timing out.
 *
 * Returns the `data-holodeck-rendered` revision of the first signalling
 * element (the scope element itself when it carries the attribute).
 */
export async function waitForRendered(scope: Locator | Page, timeout = 60_000): Promise<number> {
  const isLocator = typeof (scope as Locator).elementHandle === 'function';
  const page = isLocator ? (scope as Locator).page() : (scope as Page);
  const handle = isLocator ? await (scope as Locator).elementHandle({ timeout }) : null;
  if (isLocator && !handle) throw new Error('render root not found');
  const result = await page.waitForFunction(
    (el) => {
      const els = [...(el ?? document).querySelectorAll('[data-render-state]')];
      if (el?.hasAttribute('data-render-state')) els.unshift(el);
      if (els.length === 0) return false;
      const states = els.map((e) => e.getAttribute('data-render-state'));
      if (!states.every((s) => s === 'ready') && !states.includes('unsupported')) return false;
      return { states, revision: els[0]!.getAttribute('data-holodeck-rendered') };
    },
    handle,
    { timeout },
  );
  const { states, revision } = (await result.jsonValue()) as { states: string[]; revision: string | null };
  await result.dispose();
  if (states.some((s) => s !== 'ready')) throw new Error(`render state is ${states.join(',')} (WebGPU unavailable?)`);
  return Number(revision);
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
 * After a pointer / keyboard / viewport interaction: lets the page commit the
 * resulting state (two animation frames: input handlers and rAF-batched
 * updates run, React commits) and then waits for the new picture to be
 * presented. Replaces `waitForTimeout(<guess>)` after an input.
 */
export async function settle(page: Page, timeout = 60_000): Promise<void> {
  await animationFrames(page, 2);
  await waitForRendered(page, timeout);
}
