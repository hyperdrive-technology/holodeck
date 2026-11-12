/**
 * The process-parts sample in the playground (`webgpu` project): the Reset
 * dialog loads it, every `@holodeck/library-process` GLB is fetched from the
 * production build and the engine presents the scene (`data-render-state`
 * ready and the current revision rendered), with no page errors. The unit
 * tests (src/samples/process-line.test.ts, PlaygroundRoute.test.tsx) pin the
 * document; this is the one check that the bundled GLB URLs, DataPart and the
 * animators work together in a real browser. Waits are on the engine's render
 * signals, never sleeps. A screenshot is attached for visual review.
 */
import { expect, test, type Page } from '@playwright/test';

// Frozen Date.now, as in playground.webgpu.spec.ts: the sim streams every
// 250 ms and SwiftShader frames are slower than that on CI.
const T0 = new Date('2026-01-01T00:00:02Z').getTime();
const FIRST_RENDER_MS = 300_000;
// Every @holodeck/library-process model: the sample uses all of them (process-line.test.ts pins that).
const PROCESS_MODELS = [
  'valve-ball', 'valve-butterfly', 'valve-control', 'valve-actuated', 'valve-solenoid', 'valve-three-way', 'valve-check', 'valve-relief',
  'motor', 'heat-exchanger-shell-tube', 'transmitter', 'gauge-pressure', 'flowmeter-mag', 'level-radar', 'beacon', 'cabinet', 'vfd', 'junction-box',
];
test.setTimeout(600_000);
test.use({ viewport: { width: 1080, height: 560 } });
const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.clock.setFixedTime(T0);
});
test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

async function rendered(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="process-editor"]');
      return el?.getAttribute('data-render-state') === 'ready' && el.getAttribute('data-holodeck-rendered') === el.getAttribute('data-holodeck-revision');
    },
    null,
    { timeout: FIRST_RENDER_MS },
  );
}

test('the Reset dialog loads the process-parts sample and every process GLB renders', async ({ page }, testInfo) => {
  const glbs = new Map<string, number>();
  page.on('response', (response) => {
    // Vite emits `<slug>-<hash>.glb` and a hash may itself contain '-', so match the known slugs, longest first.
    const file = new URL(response.url()).pathname.split('/').pop() ?? '';
    const slug = PROCESS_MODELS.filter((s) => file.startsWith(`${s}-`) && file.endsWith('.glb')).sort((a, b) => b.length - a.length)[0];
    if (slug) glbs.set(slug, response.status());
  });
  await page.goto('/playground');
  const editor = page.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-render-state', /ready|unsupported/, { timeout: FIRST_RENDER_MS });
  if ((await editor.getAttribute('data-render-state')) === 'unsupported') {
    expect(process.env.CI, 'the webgpu project must have WebGPU on CI').toBeFalsy();
    test.skip(true, 'no WebGPU in this local browser');
  }
  await rendered(page);

  await page.getByRole('button', { name: /Reset/ }).click();
  await page.getByTestId('reset-dialog').getByRole('button', { name: 'Load the process-parts sample' }).click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
  await expect(editor).toHaveAttribute('data-object-count', '34');
  await rendered(page);

  // Vite emits each GLB with a content hash: `<slug>-<hash>.glb`.
  expect([...glbs.keys()].sort()).toEqual([...PROCESS_MODELS].sort());
  for (const [slug, status] of glbs) expect(status, slug).toBe(200);
  // Written under test-results/ (kept for every run, not only failures) and attached to the report.
  const shot = testInfo.outputPath('process-sample.png');
  await page.getByTestId('canvas').screenshot({ path: shot });
  await testInfo.attach('process-sample', { path: shot, contentType: 'image/png' });
});
