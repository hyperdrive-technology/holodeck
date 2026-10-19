/**
 * Render-signal hold matrix in a real browser (holodeck#58, #63, #198, #199 and
 * the GPT reviews of #197). Every asset-loading path, in its own Suspense
 * boundary and in a boundary shared with a suspended sibling (nothing in it can
 * commit), through four scenarios. The invariant for each: the canvas is
 * `pending` while an instance's asset is outstanding, `ready` once it has
 * committed (or was removed / failed), and never stuck.
 * Harness: holds.html / holds-main.tsx. No sleeps: frames and render state.
 */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { animationFrames, launchRenderBrowser, startHarness, waitForRendered, type Harness } from '../test-support/render-harness';

let harness: Harness;
let browser: Browser;

beforeAll(async () => {
  if (!CHROMIUM) return;
  harness = await startHarness('editor');
  browser = await launchRenderBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await harness?.close();
});

// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const COMPONENTS = ['glb', 'data', 'marks', 'texture', 'bare', 'owned', 'mixed'] as const;
type Component = (typeof COMPONENTS)[number];
const BOUNDARIES = ['own', 'shared'] as const;
type Boundary = (typeof BOUNDARIES)[number];
const SCENARIOS = ['loads', 'removed mid-load', 'errors', 'duplicate URL with a sibling instance'] as const;
type Scenario = (typeof SCENARIOS)[number];

const isImage = (c: Component) => c === 'marks' || c === 'texture';
/**
 * A committed owner (the Suspense fallback of Glb/Data/Marks, the ownBoundary
 * wrapper) can release the moment its instance is removed, but only when its
 * boundary is not held uncommitted by a suspended sibling.
 */
const hasCommittedOwner = (c: Component, b: Boundary) => b === 'own' && ['glb', 'data', 'marks', 'owned'].includes(c);

interface Probe {
  state(): Promise<string | null>;
  frames(n?: number): Promise<void>;
  call<T>(fn: string, ...args: unknown[]): Promise<T>;
}

async function open(component: Component, boundary: Boundary, extra = '', fail = false) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let requested!: () => void;
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  // The asset request is parked until the test releases it.
  const handler = async (route: import('playwright').Route) => {
    requested();
    await released;
    if (fail) await route.abort();
    else if (isImage(component)) await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    else await route.continue();
  };
  await page.route((url) => (isImage(component) ? url.pathname === '/holds-img.png' : url.pathname.endsWith('/pump.glb') && !url.search.includes('import')), handler);
  await page.goto(`${harness.origin}/holds.html?component=${component}&boundary=${boundary}${extra}`);
  const canvas = page.locator('[data-render-state]').first();
  await canvas.waitFor();
  await requestSeen;
  const probe: Probe = {
    state: () => canvas.getAttribute('data-render-state'),
    frames: (n = 30) => animationFrames(page, n),
    call: (fn, ...args) => page.evaluate(([name, rest]) => (window as any).__holds[name as string](...(rest as unknown[])), [fn, args] as const) as never,
  };
  return { page, canvas, probe, release };
}

const committed = (page: Page) => page.evaluate(() => (window as any).__holds.committed as string[]);
const renderedEarly = (page: Page) => page.evaluate(() => (window as any).__holds.renderedEarly as boolean);
const isModel = (c: Component) => c === 'bare' || c === 'owned' || c === 'mixed';

describe.skipIf(!CHROMIUM)('render-signal holds: component x boundary x scenario', () => {
  for (const component of COMPONENTS) {
    for (const boundary of BOUNDARIES) {
      for (const scenario of SCENARIOS) {
        // 'mixed' is the duplicate-URL case by construction (owned + bare); the other scenarios add nothing for it.
        if (component === 'mixed' && scenario !== 'duplicate URL with a sibling instance' && scenario !== 'loads') continue;
        it(`${component} / ${boundary} boundary / ${scenario}`, async () => {
          const dup = scenario === 'duplicate URL with a sibling instance' ? '&dup' : '';
          const { page, canvas, probe, release } = await open(component, boundary, dup, scenario === 'errors');
          try {
            await probe.frames();
            // Outstanding asset: pending, whatever the boundary (nothing may rely on a commit).
            expect(await probe.state(), 'pending while the request is parked').toBe('pending');
            const unblockSibling = async () => { if (boundary === 'shared') await probe.call('releaseSibling'); };

            if (scenario === 'loads') {
              await unblockSibling();
              await probe.frames();
              expect(await probe.state(), 'a settled sibling alone must not make it ready').toBe('pending');
              release();
              await waitForRendered(canvas, 30_000);
              if (isModel(component)) {
                expect((await committed(page)).sort()).toEqual(component === 'mixed' ? ['a', 'b'] : ['a']);
                expect(await renderedEarly(page), 'no frame reported before every model mounted').toBe(false);
              }
            } else if (scenario === 'removed mid-load') {
              await probe.call('remove', 'a');
              await unblockSibling();
              await probe.frames();
              if (hasCommittedOwner(component, boundary)) {
                // Removal releases at once: the request is still parked.
                await waitForRendered(canvas, 15_000);
              } else {
                // Nothing committed can tell: held until the request settles, then freed after the retry grace.
                expect(await probe.state()).toBe('pending');
                release();
                await waitForRendered(canvas, 30_000);
              }
            } else if (scenario === 'errors') {
              await unblockSibling();
              release(); // the parked request now fails
              await waitForRendered(canvas, 30_000);
              if (isModel(component)) expect(await committed(page)).toEqual([]);
            } else {
              // Two instances (a, b) of one pending URL. Removing a must not free b's hold (holodeck#199).
              await probe.call('remove', 'a');
              await unblockSibling();
              await probe.frames();
              expect(await probe.state(), "the other instance's hold survives a's removal").toBe('pending');
              release();
              await waitForRendered(canvas, 30_000);
              if (isModel(component)) {
                expect(await committed(page)).toEqual(['b']);
                expect(await renderedEarly(page)).toBe(false);
              }
            }
          } finally {
            release();
            await page.close();
          }
        // retry: this host stalls (wall clock jumps past the timeout) under load; a real hold bug fails every attempt.
        }, { timeout: 90_000, retry: 2 });
      }
    }
  }
});
