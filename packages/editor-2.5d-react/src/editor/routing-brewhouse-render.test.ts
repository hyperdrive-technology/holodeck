/**
 * Headless render of the Hyperdrive brewhouse piping (bends and vessel
 * connections) -> tests/snapshots/brewhouse-routing.png, for review.
 *
 * The scene lives in the sibling core repo
 * (core/src/typescript/packages/hyperdrive-ui/examples/brewery/hmi). Its
 * vessels are brewery-pack parts this package does not ship, so they are
 * drawn as built-in `tank`s at the same spot (radius 1, the brewhouse HLT /
 * mash tun size) and the pumps are left out; every pipe, elbow, valve, cap and
 * label is the scene's own. Skipped when the core checkout is not there.
 *
 * Needs local Chromium + WebGPU like the other *-render tests.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM, RENDER_ARGS } from '../test-support/chromium';
import { waitForPageRendered } from '../test-support/render-harness';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { checkElbows, isAutoElbow, resolveAutoElbows } from '../routing/elbows';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const snapDir = path.join(pkgRoot, 'tests/snapshots');
const shotPath = path.join(snapDir, 'brewhouse-routing.png');
// Vendored copy of core's brewhouse HMI scene; brewery-fixtures.test.ts keeps it in sync.
const brewhousePath = path.join(pkgRoot, 'tests/fixtures/brewery/brewhouse.iso.json');


/** Brewery parts that are vessels (drawn as a built-in tank); other `brewery:*` parts are dropped. */
const isBreweryVessel = (o: IsoPlacement) =>
  o.object.startsWith('brewery:') && !['brewery:pump', 'brewery:heat-exchanger'].includes(o.object);

function builtinBrewhouse(): IsoSceneFile {
  const raw = JSON.parse(readFileSync(brewhousePath, 'utf8')) as IsoSceneFile;
  const objects: IsoPlacement[] = [];
  for (const o of raw.objects) {
    if (isBreweryVessel(o)) {
      const level = typeof o.params?.level === 'number' ? o.params.level / 100 : 0.4;
      const height = typeof o.params?.height === 'number' ? Math.max(1.5, o.params.height) : 2.4;
      objects.push({ id: o.id, object: 'tank', x: o.x, y: o.y, height, params: { level } });
    } else if (!o.object.startsWith('brewery:')) {
      const { extensions: _drop, ...rest } = o;
      objects.push(rest);
    }
  }
  return { id: raw.id, name: raw.name, gridCellSize: raw.gridCellSize, objects };
}

let server: ViteDevServer;

beforeAll(async () => {
  if (!CHROMIUM) return;
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

describe.skipIf(!CHROMIUM)('brewhouse piping render', () => {
  it('draws the brewhouse with every bend joining its pipes', async () => {
    const scene = builtinBrewhouse();
    // The bends this snapshot is about resolve from their pipes (params.bend = "auto").
    const elbows = scene.objects.filter((o) => o.object === 'elbow');
    expect(elbows.map((e) => e.id)).toEqual(expect.arrayContaining(['e-hlt', 'e-mt-in', 'e-k-out', 'e-wp-in']));
    expect(elbows.every(isAutoElbow)).toBe(true);
    expect(checkElbows(scene.objects)).toEqual([]);
    const resolved = resolveAutoElbows(scene.objects);
    const rot = (id: string) => resolved.find((o) => o.id === id)?.rotation;
    expect(rot('e-hlt')).toBe(0); // from w, up n
    expect(rot('e-mt-in')).toBe(Math.PI); // from s, on e
    expect(rot('e-k-out')).toBe(Math.PI / 2); // from w, down s
    expect(rot('e-wp-in')).toBe(-Math.PI / 2); // from n, on e

    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('vite did not bind a port');
    }
    const browser = await chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: RENDER_ARGS,
    });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.addInitScript((s) => {
        (window as unknown as { __brewhouseScene: unknown }).__brewhouseScene = s;
      }, scene);
      await page.goto(`http://127.0.0.1:${address.port}/routing-brewhouse.html`);
      await page.getByTestId('process-editor').waitFor();
      await page.waitForSelector('canvas');
      await waitForPageRendered(page);
      expect(errors).toEqual([]);
      mkdirSync(snapDir, { recursive: true });
      await page.screenshot({ path: shotPath, type: 'png' });
    } finally {
      await browser.close();
    }
    expect(statSync(shotPath).size).toBeGreaterThan(20_000);
  }, 90_000);
});
