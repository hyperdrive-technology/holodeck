#!/usr/bin/env node
/**
 * Regenerates tests/snapshots/reference-canvas.png: the Arcentry process pane
 * (REFERENCE_CANVAS in src/editor/ProcessSceneView.tsx: 760x540 at x=200)
 * cropped out of tests/snapshots/reference.jpg.
 *
 * Run only when reference.jpg changes (`pnpm visual:reference`); the visual test
 * reads the committed PNG and never writes it. Decoding happens in Chromium
 * (already a dev dependency) so there is no ImageMagick / JPEG-decoder
 * dependency. Chromium's JPEG decoder can differ from ImageMagick's by a
 * level or two per channel, which is why the output is committed rather than
 * regenerated per run.
 *
 *   node scripts/make-reference-canvas.mjs [--out <file>]
 *
 * Chromium: the shared resolver in src/test-support/chromium.ts (imported
 * directly; Node 26 strips the TypeScript types), so this script and the render
 * tests always agree: $HOLODECK_CHROMIUM, then Playwright's pinned Chromium,
 * then system Chrome (holodeck#74).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { CHROMIUM_RESOLUTION } from '../src/test-support/chromium.ts';

const CROP = { x: 200, y: 0, width: 760, height: 540 };
const pkgRoot = path.resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const src = path.join(pkgRoot, 'tests/snapshots/reference.jpg');
const out = path.resolve(values.out ?? path.join(pkgRoot, 'tests/snapshots/reference-canvas.png'));

if (!CHROMIUM_RESOLUTION.path) throw new Error(`no Chromium: ${CHROMIUM_RESOLUTION.reason}`);
console.log(`Chromium: ${CHROMIUM_RESOLUTION.reason}`);

const browser = await chromium.launch({ executablePath: CHROMIUM_RESOLUTION.path, headless: true });
try {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(
    async ({ b64, crop }) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      await img.decode();
      if (img.width < crop.x + crop.width || img.height < crop.y + crop.height) {
        throw new Error(`reference.jpg is ${img.width}x${img.height}, too small for the crop`);
      }
      const c = document.createElement('canvas');
      c.width = crop.width;
      c.height = crop.height;
      c.getContext('2d').drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return c.toDataURL('image/png');
    },
    { b64: readFileSync(src).toString('base64'), crop: CROP },
  );
  writeFileSync(out, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  console.log(`wrote ${out} (${CROP.width}x${CROP.height} from x=${CROP.x})`);
} finally {
  await browser.close();
}
