/**
 * Renders tests/scene.json in a real WebGPU canvas and measures it against the
 * Arcentry target (holodeck#32). This is the agent loop for Arcentry fidelity:
 * see the package README, "Arcentry fidelity loop".
 *
 * Deterministic setup: 760x540 viewport (REFERENCE_CANVAS), deviceScaleFactor 1
 * (canvas DPR 1), fixed camera (REFERENCE_ZOOM + the frozen process-line
 * look-at), frozen metrics (`live={false}`), and the shot is taken when the
 * canvas reports `data-render-state="ready"`, never after a sleep.
 *
 * Output (gitignored, `artifacts/visual/` or $HOLODECK_ARTIFACTS_DIR/visual):
 *   reference-render.png    our render
 *   reference-diff.png      pixelmatch diff: red = missing ink, blue = extra ink
 *   reference-heatmap.png   continuous colour distance (blue -> yellow -> red)
 *   reference-overlay.png   50/50 blend of Arcentry and ours
 *   reference-metrics.json  fidelity, rmse, per-cell breakdown, verdict, paths
 *   label-boxes.json        DOM label centres (SnapshotLabelLock check)
 *
 * Gate: tests/visual/reference-fidelity.json (per platform). A run fails when
 * fidelity drops more than epsilon below the record, or (CI only) when the
 * platform has no record; `pnpm visual:record`
 * (HOLODECK_VISUAL_RECORD=1) raises the record when a run beats it. Nothing
 * under tests/snapshots/ is written any more.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import {
  collectPageLog,
  launchRenderBrowser,
  PKG_ROOT,
  startHarness,
  waitForRendered,
  type Harness,
} from '../test-support/render-harness';
import { compareToReference, isCi, judge, tighten, worstCells } from '../visual/fidelity';
import {
  artifactsDir,
  decodePng,
  FIDELITY_RECORD_PATH,
  readPng,
  readRecord,
  writePng,
  writeRecord,
} from '../visual/io';
import { REFERENCE_CANVAS } from '../editor/ProcessSceneView';
import { PROCESS_SCENE } from './load-process-scene';

const scenePath = path.join(PKG_ROOT, 'tests/scene.json');
const referenceCanvasPath = path.join(PKG_ROOT, 'tests/snapshots/reference-canvas.png');
const RECORD = process.env.HOLODECK_VISUAL_RECORD === '1';
/**
 * Arcentry's own toolbar (new document, undo, zoom, 2D, ...) is baked into the
 * bottom-right of reference.jpg; we never draw it, so it is not a fidelity gap.
 */
const REFERENCE_IGNORE = [{ x: 425, y: 512, width: 335, height: 28 }];

let harness: Harness;
let browser: Browser;

beforeAll(async () => {
  if (!CHROMIUM) return;
  harness = await startHarness('iso');
  browser = await launchRenderBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await harness?.close();
});

describe.skipIf(!CHROMIUM)('renders scene.json', () => {
  it('places every library object and holds Arcentry fidelity', async () => {
    const onDisk = JSON.parse(readFileSync(scenePath, 'utf8')) as {
      id: string;
      objects: Array<{ id: string; object: string; x: number; y: number }>;
    };
    expect(PROCESS_SCENE.id).toBe(onDisk.id);
    expect(PROCESS_SCENE.objects.map((o) => o.id)).toEqual(onDisk.objects.map((o) => o.id));

    const out = artifactsDir('visual');
    const page = await browser.newPage({
      viewport: { width: REFERENCE_CANVAS.width, height: REFERENCE_CANVAS.height },
      deviceScaleFactor: 1,
    });
    let png: Buffer;
    try {
      const logs = collectPageLog(page);
      await page.goto(`${harness.origin}/render.html`);
      const root = page.getByTestId('scene-root');
      await root.waitFor();
      await waitForRendered(root.locator('[data-render-state]'));

      const box = await page.locator('canvas').boundingBox();
      expect(box?.width).toBe(REFERENCE_CANVAS.width);
      expect(box?.height).toBe(REFERENCE_CANVAS.height);
      expect(await root.getAttribute('data-scene-id')).toBe(onDisk.id);
      expect(await root.getAttribute('data-object-count')).toBe(String(onDisk.objects.length));
      expect(await root.getAttribute('data-object-ids')).toBe(onDisk.objects.map((o) => o.id).join(','));

      const boxes = await page.evaluate(() =>
        [...document.querySelectorAll('[data-label-id]')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-label-id'),
            cx: r.left + r.width / 2,
            cy: r.top + r.height / 2,
            w: r.width,
            h: r.height,
          };
        }),
      );
      writeFileSync(path.join(out, 'label-boxes.json'), `${JSON.stringify(boxes, null, 2)}\n`);
      const holding = boxes.find((b) => b.id === 'label-holding');
      // SnapshotLabelLock pins CSS Html to scene.json screenX/Y (+ nudge).
      expect(holding?.cx).toBeGreaterThan(200);
      expect(holding?.cx).toBeLessThan(270);
      expect(holding?.cy).toBeGreaterThan(330);
      expect(holding?.cy).toBeLessThan(370);

      png = await page.screenshot({ type: 'png' });
      expect(logs.filter((l) => l.startsWith('pageerror') || l.startsWith('failed'))).toEqual([]);
    } finally {
      await page.close();
    }

    // --- measure against Arcentry --------------------------------------------
    const ours = decodePng(png);
    const reference = readPng(referenceCanvasPath);
    const { metrics, images } = compareToReference(reference, ours, { ignore: REFERENCE_IGNORE });
    expect(metrics.inkRatio, 'blank render').toBeGreaterThan(0.02);

    const files = {
      render: path.join(out, 'reference-render.png'),
      diff: path.join(out, 'reference-diff.png'),
      heatmap: path.join(out, 'reference-heatmap.png'),
      overlay: path.join(out, 'reference-overlay.png'),
      reference: referenceCanvasPath,
      record: FIDELITY_RECORD_PATH,
    };
    writeFileSync(files.render, png);
    writePng(files.diff, images.diff);
    writePng(files.heatmap, images.heatmap);
    writePng(files.overlay, images.overlay);

    let record = readRecord();
    const before = record.platforms[process.platform];
    // In CI a platform without a record fails (`missing`): otherwise the ratchet
    // passes `unrecorded` forever on a platform nobody recorded (holodeck PR #52).
    const verdict = judge(before, metrics, { requireRecord: isCi(), platform: process.platform });
    let recorded = false;
    if (RECORD && verdict.status !== 'regressed') {
      const next = tighten(record, process.platform, metrics, new Date().toISOString());
      if (next.changed) {
        record = next.file;
        writeRecord(record);
        recorded = true;
      }
    }
    const report = {
      scene: onDisk.id,
      platform: process.platform,
      chromium: browser.version(),
      verdict: verdict.status,
      message: verdict.message,
      recorded,
      record: record.platforms[process.platform] ?? null,
      metrics: { ...metrics, worstCells: worstCells(metrics.cells, 3) },
      files,
    };
    writeFileSync(path.join(out, 'reference-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.info(
      `[arcentry fidelity] ${metrics.fidelity} (rmse ${metrics.rmse}) ${verdict.status}${recorded ? ', recorded' : ''}: ${path.join(out, 'reference-metrics.json')}`,
    );

    expect(verdict.ok, `${verdict.status}: ${verdict.message}\nheatmap: ${files.heatmap}`).toBe(true);
    // 60s is enough for one Chromium; a second concurrent vitest races the
    // port/GPU and this it() hangs past the timeout (21min observed).
  }, 60_000);
});
