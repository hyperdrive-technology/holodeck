/**
 * Headless render of pipes running into vessel cut-away windows in the
 * Hyperdrive brewery scenes (brewhouse + cellar), for review:
 *
 *   tests/snapshots/brewhouse-pipe-cutaway.png   whole brewhouse, fitted zoom
 *   tests/snapshots/cellar-pipe-cutaway.png      whole cellar, fitted zoom
 *   tests/snapshots/pipe-cutaway-<scene>-<pipe>-<end>-<1x|2x>.png
 *       close-up of each pipe end that meets a vessel: every window entry
 *       (clipped at the wall, cut-section end) plus the under / outlet ends
 *       (fermenter cone branches and glycol stubs, mash tun and kettle on legs),
 *       at the editor's fitted zoom (1x) and at twice that (2x).
 *
 * The scenes live in the sibling core repo; their vessels are mirrored by
 * pipe-cutaway-parts.tsx (same ids, presets, window params and wallSpan) and
 * the GLB pumps are dropped. Skipped when the core checkout is not there.
 * Needs local Chromium + WebGPU like the other *-render tests.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pipeWorldY } from '../../assets/process/pipe-math';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { resolvePipeRuns } from '../iso/pipe-runs';
import { resolveAutoElbows } from '../routing/elbows';
import { findWindowConnections, resolvePipeClips } from '../routing/vessel-ports';
import { CUTAWAY_VESSEL_IDS, createCutawayRegistry } from './pipe-cutaway-parts';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const snapDir = path.join(pkgRoot, 'tests/snapshots');
const hmiDir = path.resolve(pkgRoot, '../../../core/src/typescript/packages/hyperdrive-ui/examples/brewery/hmi');
const SCENES = ['brewhouse', 'cellar'] as const;
const HAVE_SCENES = SCENES.every((s) => existsSync(path.join(hmiDir, `${s}.iso.json`)));
const VIEW = { width: 1600, height: 900 };
const CROP = { width: 420, height: 300 };

const CHROMIUM = path.join(
  process.env.HOME ?? '',
  'Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
);

const registry = createCutawayRegistry();

function loadScene(name: (typeof SCENES)[number]): IsoSceneFile {
  const raw = JSON.parse(readFileSync(path.join(hmiDir, `${name}.iso.json`), 'utf8')) as IsoSceneFile;
  const objects: IsoPlacement[] = [];
  for (const o of raw.objects) {
    if (o.object.startsWith('brewery:') && !CUTAWAY_VESSEL_IDS.has(o.object)) continue;
    const { extensions: _drop, ...rest } = o;
    objects.push(rest);
  }
  return { id: raw.id, name: raw.name, gridCellSize: raw.gridCellSize, objects };
}

/** Every pipe end that touches a vessel, with the world point it is drawn at. */
function vesselEnds(scene: IsoSceneFile) {
  const objects = resolveAutoElbows(scene.objects);
  const { runs } = resolvePipeRuns(objects, registry);
  const out: Array<{ key: string; contact: string; at: [number, number, number] }> = [];
  for (const [id, clip] of resolvePipeClips(objects, registry)) {
    for (const end of ['from', 'to'] as const) {
      const c = clip[end];
      if (!c || c.contact === 'wall') continue;
      // FV2 / FV3 repeat FV1's cone branch and glycol stub exactly; one of each is enough to review.
      if (c.contact !== 'window' && /^p-fv[23]-/.test(id)) continue;
      const [x, z] = runs.get(id)![end];
      out.push({ key: `${id}-${end}`, contact: c.contact, at: [x, pipeWorldY(), z] });
    }
  }
  return out;
}

let server: ViteDevServer;

beforeAll(async () => {
  if (!HAVE_SCENES) return;
  server = await createServer({
    root: path.join(pkgRoot, 'src/editor'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
  });
  await server.listen();
}, 30_000);

afterAll(async () => {
  await server?.close();
});

async function show(page: Page, base: string, scene: IsoSceneFile, query: string, errors: string[]) {
  await page.addInitScript((s) => {
    (window as unknown as { __cutawayScene: unknown }).__cutawayScene = s;
  }, scene);
  await page.goto(`${base}/pipe-cutaway.html?${query}`);
  await page.getByTestId('cutaway-root').waitFor();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(2500);
  expect(errors).toEqual([]);
}

describe.skipIf(!HAVE_SCENES)('pipe cut-away render', () => {
  it('both scenes have window entries to look at', () => {
    for (const name of SCENES) {
      const objects = resolveAutoElbows(loadScene(name).objects);
      expect(findWindowConnections({ objects }, registry).length, name).toBeGreaterThan(0);
    }
  });

  it('snapshots each scene and a close-up of every vessel connection', async () => {
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
    const base = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist'],
    });
    mkdirSync(snapDir, { recursive: true });
    try {
      for (const name of SCENES) {
        const scene = loadScene(name);
        const errors: string[] = [];
        const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
        page.on('pageerror', (err) => errors.push(err.message));
        await show(page, base, scene, 'mode=editor', errors);
        const shot = path.join(snapDir, `${name}-pipe-cutaway.png`);
        await page.screenshot({ path: shot, type: 'png' });
        expect(statSync(shot).size).toBeGreaterThan(20_000);
        // The editor's own fitted zoom is the "default zoom" for the close-ups.
        const fitted = Number(await page.locator('[data-zoom]').first().getAttribute('data-zoom'));
        expect(fitted).toBeGreaterThan(0);
        await page.close();

        const crop = await browser.newPage({ viewport: CROP, deviceScaleFactor: 2 });
        crop.on('pageerror', (err) => errors.push(err.message));
        for (const end of vesselEnds(scene)) {
          for (const [label, zoom] of [
            ['1x', fitted],
            ['2x', fitted * 2],
          ] as const) {
            const [tx, ty, tz] = end.at;
            await show(crop, base, scene, `mode=canvas&zoom=${zoom}&tx=${tx}&ty=${ty}&tz=${tz}`, errors);
            const out = path.join(snapDir, `pipe-cutaway-${name}-${end.key}-${label}.png`);
            await crop.screenshot({ path: out, type: 'png' });
            expect(statSync(out).size, `${out} (${end.contact})`).toBeGreaterThan(5_000);
          }
        }
        await crop.close();
      }
    } finally {
      await browser.close();
    }
  }, 300_000);
});
