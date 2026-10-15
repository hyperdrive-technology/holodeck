/**
 * The rendered-signal wait every *-render test relies on. Plain DOM fixtures
 * (no WebGPU), so this pins the scope semantics of `waitForRendered`: page vs
 * locator scope, late-mounted signals, the revision it returns, and the
 * `unsupported` failure.
 */
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHROMIUM, CHROMIUM_RESOLUTION } from './chromium';
import { launchRenderBrowser, settle, waitForRendered } from './render-harness';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  if (CHROMIUM) browser = await launchRenderBrowser();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  if (!CHROMIUM) return;
  await page?.close();
  page = await browser.newPage();
});

/** Sets data-render-state (and optionally the revision) on `#id`. */
function signal(id: string, state: string, revision?: number): Promise<void> {
  return page.evaluate(
    ([elId, s, rev]) => {
      const el = document.getElementById(elId as string)!;
      el.setAttribute('data-render-state', s as string);
      if (rev !== null) el.setAttribute('data-holodeck-rendered', String(rev));
    },
    [id, state, revision ?? null] as const,
  );
}

// Runs everywhere, including when every render suite below skips: in CI the
// render tests (and the Arcentry fidelity ratchet) must not skip silently
// because the "Select browser" step was dropped or HOLODECK_CHROMIUM points at
// nothing (holodeck#78). Opt out explicitly with HOLODECK_SKIP_RENDER_TESTS=1.
describe('render browser', () => {
  it('is available whenever render tests are required (CI)', () => {
    const { required, path, reason } = CHROMIUM_RESOLUTION;
    expect(required && !path, `render tests are required here but cannot run: ${reason}`).toBe(false);
  });
});

describe.skipIf(!CHROMIUM)('waitForRendered', () => {
  it('page scope waits until every signalling element is ready', async () => {
    await page.setContent(
      '<div id="a" data-render-state="ready" data-holodeck-rendered="1"></div><div id="b" data-render-state="pending"></div>',
    );
    let done = false;
    const wait = waitForRendered(page, 5_000).then((rev) => {
      done = true;
      return rev;
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(done).toBe(false);
    await signal('b', 'ready');
    expect(await wait).toBe(1);
  });

  it('page scope waits for a signal that mounts after the call', async () => {
    await page.setContent('<main id="root"></main>');
    const wait = waitForRendered(page, 5_000);
    await page.evaluate(() => {
      const el = document.createElement('canvas');
      el.setAttribute('data-render-state', 'ready');
      el.setAttribute('data-holodeck-rendered', '7');
      document.getElementById('root')!.append(el);
    });
    expect(await wait).toBe(7);
  });

  it('locator scope uses the element itself when it carries the signal', async () => {
    await page.setContent(
      '<section id="ed" data-render-state="pending"><div id="inner" data-render-state="ready" data-holodeck-rendered="9"></div></section>' +
        '<div id="other" data-render-state="pending"></div>',
    );
    const wait = waitForRendered(page.locator('#ed'), 5_000);
    await signal('ed', 'ready', 3);
    // #other (outside the scope) stays pending and does not block.
    expect(await wait).toBe(3);
  });

  it('locator scope falls back to descendants when the element has no signal', async () => {
    await page.setContent('<div id="scene"><canvas id="c" data-render-state="pending"></canvas></div>');
    const wait = waitForRendered(page.locator('#scene'), 5_000);
    await signal('c', 'ready', 4);
    expect(await wait).toBe(4);
  });

  it('throws on unsupported instead of timing out', async () => {
    await page.setContent('<div id="a" data-render-state="ready"></div><div id="b" data-render-state="pending"></div>');
    const wait = waitForRendered(page, 5_000);
    await signal('b', 'unsupported');
    await expect(wait).rejects.toThrow(/render state is ready,unsupported/);
  });

  it('settle waits for the signal after an interaction', async () => {
    await page.setContent('<div id="a" data-render-state="ready" data-holodeck-rendered="1"></div>');
    await signal('a', 'pending');
    const wait = settle(page, 5_000);
    await signal('a', 'ready', 2);
    await expect(wait).resolves.toBeUndefined();
  });
});
