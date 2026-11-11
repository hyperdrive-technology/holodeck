/**
 * `scene_render`: a PNG of a document as the studio draws it, captured in
 * headless Chromium.
 *
 * How: the built studio (`apps/studio/dist`, `pnpm build` there) is served
 * from a loopback-only static server. A page gets the document as the
 * `/render` route's input global (`apps/studio/src/render/`), and the capture
 * waits on the engine's own signal, `data-render-state` (`ready`: the current
 * revision presented with every model loaded and the scene fitted). It never
 * sleeps.
 *
 * Never a blank image: no WebGPU (`unsupported`), a document the studio
 * refuses, a timeout, or a capture where every pixel is the same colour all
 * become explicit errors.
 *
 * Browser: `HOLODECK_CHROMIUM`, else the macOS Google Chrome, else
 * Playwright's own Chromium if installed (`npx playwright install chromium`).
 * Same choice and the same WebGPU flags as the studio e2e
 * (apps/studio/playwright.config.ts). One browser is started on first use,
 * renders run one at a time, and it is closed after `IDLE_CLOSE_MS` without
 * a render, or when the server closes (renders still queued then are refused
 * with `closed` and the one in progress is aborted). A browser that exits on
 * its own is forgotten, and the next render starts a new one. Stray headless
 * Chromes have filled this machine before (AGENTS.md, "Browser MCP leak").
 */

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { PNG } from 'pngjs';
import { messageOf, ToolError } from './errors';

/** Keep in step with WEBGPU_ARGS in apps/studio/playwright.config.ts (SwiftShader on GPU-less Linux). */
export const RENDER_ARGS: readonly string[] = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  ...(process.platform !== 'linux'
    ? ['--enable-features=WebGPU']
    : ['--enable-features=WebGPU,Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
];

export const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Matches apps/studio/src/render/render-input.ts RENDER_INPUT_GLOBAL. */
export const RENDER_INPUT_GLOBAL = '__HOLODECK_RENDER__';
export const RENDER_TIMEOUT_MS = 120_000;
export const IDLE_CLOSE_MS = 120_000;
export const MIN_SIDE = 64;
export const MAX_SIDE = 2048;

/** The studio build next to this package: packages/mcp/{src,dist} -> apps/studio/dist. */
export function defaultStudioDist(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../apps/studio/dist');
}

/** The browser to use, or null when there is none. An explicit HOLODECK_CHROMIUM that does not exist is an error. */
export function findChromium(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.HOLODECK_CHROMIUM?.trim();
  if (explicit) {
    if (!existsSync(explicit)) throw new ToolError(`HOLODECK_CHROMIUM=${explicit} does not exist`, [], 'no_browser');
    return explicit;
  }
  if (process.platform === 'darwin' && existsSync(MAC_CHROME)) return MAC_CHROME;
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // playwright-core has no browser of its own installed
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve `dir` on 127.0.0.1 (random port). GET/HEAD only. A path without an
 * extension falls back to index.html (client-side routes such as /render);
 * a missing asset is a 404. A path that would leave `dir` is a 404.
 */
export async function serveStatic(dir: string): Promise<{ server: Server; baseUrl: string }> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const target = normalize(join(root, pathname));
      if (target !== root && !target.startsWith(root + sep)) {
        res.writeHead(404).end();
        return;
      }
      let file = target;
      if (pathname === '/' || !extname(pathname)) file = join(root, 'index.html');
      try {
        if (!statSync(file).isFile()) throw new Error('not a file');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch {
        res.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok());
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** Is every pixel of the PNG the same colour? */
export function isUniform(png: Buffer): boolean {
  const { data } = PNG.sync.read(png);
  for (let i = 4; i < data.length; i += 4) {
    if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2] || data[i + 3] !== data[3]) return false;
  }
  return true;
}

export interface RendererOptions {
  /** Built studio folder; default `defaultStudioDist()` (or HOLODECK_STUDIO_DIST). */
  studioDist?: string;
  /** Browser binary; default `findChromium()`. */
  chromium?: string | null;
  timeoutMs?: number;
  idleCloseMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Starts the browser; default Playwright's `chromium.launch` (headless). Tests inject a fake or a spy. */
  launch?: (executablePath: string, args: readonly string[]) => Promise<Browser>;
}

const defaultLaunch = (executablePath: string, args: readonly string[]): Promise<Browser> => chromium.launch({ executablePath, headless: true, args: [...args] });

type Session = { browser: Browser; server: Server; baseUrl: string };
type Outcome = { state: 'ready' | 'unsupported' | 'invalid' | 'missing'; problems: string[] };

const closedError = () => new ToolError('the renderer is closed (the MCP server is shutting down); no image was produced', [], 'closed');

export class SceneRenderer {
  private session: Promise<Session> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idle: NodeJS.Timeout | null = null;
  private closed = false;
  /** The browser context of the capture in progress, so `close()` can abort it. */
  private active: BrowserContext | null = null;

  constructor(private readonly options: RendererOptions = {}) {}

  private studioDist(): string {
    const env = this.options.env ?? process.env;
    const dir = this.options.studioDist ?? (env.HOLODECK_STUDIO_DIST?.trim() || defaultStudioDist());
    if (!existsSync(join(dir, 'index.html'))) {
      throw new ToolError(`no studio build at ${dir}`, ['build it: cd apps/studio && pnpm build (or set HOLODECK_STUDIO_DIST)'], 'no_studio_build');
    }
    return dir;
  }

  private start(): Promise<Session> {
    if (this.session) return this.session;
    const session: Promise<Session> = (async () => {
      const dir = this.studioDist();
      const executable = this.options.chromium === undefined ? findChromium(this.options.env ?? process.env) : this.options.chromium;
      if (!executable) {
        throw new ToolError('no Chromium to render with', ['set HOLODECK_CHROMIUM to a Chrome / Chromium binary, or run: npx playwright install chromium'], 'no_browser');
      }
      const { server, baseUrl } = await serveStatic(dir);
      let browser: Browser;
      try {
        browser = await (this.options.launch ?? defaultLaunch)(executable, RENDER_ARGS);
      } catch (error) {
        server.close();
        throw new ToolError(`could not start ${executable}`, [messageOf(error)], 'no_browser');
      }
      // A browser that crashes, is killed (cleanup scripts) or otherwise goes
      // away after a good start must not stay cached: drop it so the next
      // render launches a fresh one. `stop()` clears `this.session` before it
      // closes the browser, so this only fires for a disconnect nobody asked for.
      browser.on('disconnected', () => this.forget(session, server));
      return { browser, server, baseUrl };
    })();
    this.session = session;
    // A failed start is not cached: the next call tries again (e.g. after the studio is built).
    session.catch(() => {
      if (this.session === session) this.session = null;
    });
    return session;
  }

  /** Drop a cached session whose browser is gone (no-op if it was already replaced or stopped). */
  private forget(session: Promise<Session>, server: Server): void {
    if (this.session !== session) return;
    this.session = null;
    server.close();
  }

  /**
   * The running session, relaunched once if its browser is already dead (it
   * crashed, but the `disconnected` event has not been delivered yet).
   */
  private async acquire(): Promise<{ session: Promise<Session> } & Session> {
    for (let attempt = 0; ; attempt++) {
      const session = this.start();
      const s = await session;
      if (s.browser.isConnected() || attempt > 0) return { session, ...s };
      this.forget(session, s.server);
    }
  }

  /** Render `document` at `width` x `height` CSS px (device scale 1). One at a time. */
  render(document: unknown, size: { width: number; height: number }): Promise<Buffer> {
    if (this.closed) return Promise.reject(closedError());
    for (const side of [size.width, size.height]) {
      if (!Number.isInteger(side) || side < MIN_SIDE || side > MAX_SIDE) throw new ToolError(`width and height must be whole numbers in ${MIN_SIDE}..${MAX_SIDE}`);
    }
    const run = this.queue.then(() => this.renderNow(document, size));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async renderNow(document: unknown, size: { width: number; height: number }): Promise<Buffer> {
    // Queued behind a render that was running when the client went away.
    if (this.closed) throw closedError();
    if (this.idle) clearTimeout(this.idle);
    try {
      const { session, browser, server, baseUrl } = await this.acquire();
      if (this.closed) throw closedError();
      const errors: string[] = [];
      try {
        const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
        this.active = context;
        try {
          // close() may have run while the context was being created (`active` was still null).
          if (this.closed) throw closedError();
          return await this.capture(context, document, baseUrl, errors);
        } finally {
          this.active = null;
          await context.close().catch(() => undefined);
        }
      } catch (error) {
        if (this.closed) throw closedError();
        if (!browser.isConnected()) {
          this.forget(session, server);
          throw new ToolError('the render browser exited during the render; no image was produced', ['try again: the next render starts a new browser', messageOf(error), ...errors], 'browser_closed');
        }
        throw error;
      }
    } finally {
      // Always re-armed (a failed start or a dead browser included), so the
      // idle close is never lost; not after close(), which stops everything itself.
      if (!this.closed) this.armIdle();
    }
  }

  private async capture(context: BrowserContext, document: unknown, baseUrl: string, errors: string[]): Promise<Buffer> {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, value }) => {
        (window as unknown as Record<string, unknown>)[key] = value;
      },
      { key: RENDER_INPUT_GLOBAL, value: document },
    );
    await page.goto(`${baseUrl}/render`);
    let outcome: Outcome;
    try {
      const handle = await page.waitForFunction(
        () => {
          const root = window.document.querySelector('[data-testid="render"]');
          const input = root?.getAttribute('data-render-input');
          if (input === 'invalid' || input === 'missing') {
            const problems = [...window.document.querySelectorAll('[data-testid="render-problems"] li')].map((li) => li.textContent ?? '');
            return { state: input, problems };
          }
          const state = window.document.querySelector('[data-testid="process-editor"]')?.getAttribute('data-render-state');
          return state === 'ready' || state === 'unsupported' ? { state, problems: [] } : null;
        },
        undefined,
        { timeout: this.options.timeoutMs ?? RENDER_TIMEOUT_MS, polling: 100 },
      );
      outcome = (await handle.jsonValue()) as Outcome;
    } catch (error) {
      const state = await page
        .locator('[data-testid="process-editor"]')
        .getAttribute('data-render-state', { timeout: 1000 })
        .catch(() => null);
      throw new ToolError('the render did not finish in time; no image was produced', [`last data-render-state: ${state ?? '(no canvas)'}`, ...errors, messageOf(error)], 'timeout');
    }
    if (outcome.state === 'invalid' || outcome.state === 'missing') {
      throw new ToolError('the studio refused the document; no image was produced', outcome.problems, 'invalid_document');
    }
    if (outcome.state === 'unsupported') {
      throw new ToolError(
        'WebGPU is not available in this Chromium, so the scene cannot be drawn; no image was produced',
        ['use a Chrome with WebGPU (HOLODECK_CHROMIUM); on GPU-less Linux the SwiftShader flags need Vulkan', ...errors],
        'unsupported',
      );
    }
    const png = await page.screenshot({ type: 'png' });
    if (isUniform(png)) throw new ToolError('the capture is a single flat colour (nothing was drawn); not returning it', errors, 'blank_image');
    return png;
  }

  private armIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.stop(), this.options.idleCloseMs ?? IDLE_CLOSE_MS);
    this.idle.unref();
  }

  private async stop(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (!session) return;
    const s = await session.catch(() => null);
    if (!s) return;
    await s.browser.close().catch(() => undefined);
    await new Promise<void>((ok) => s.server.close(() => ok()));
  }

  /** Is a browser running (tests)? */
  get running(): boolean {
    return this.session !== null;
  }

  /**
   * Stop for good: queued renders reject with `closed` (they check at their
   * start), the capture in progress is aborted by closing its browser context
   * (it rejects with `closed` too), then the browser and server stop.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.idle) clearTimeout(this.idle);
    await this.active?.close().catch(() => undefined);
    await this.queue.catch(() => undefined);
    await this.stop();
  }
}
