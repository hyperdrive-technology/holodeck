/**
 * Real-browser check of what node tests cannot see: that registry / theme
 * context reaches components inside the R3F Canvas, that a GLB part
 * registered by an extension animates through its anim.* node, and that the
 * controlled editor reports edits and honours run mode.
 */
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
// Same local Chromium the other browser tests use (see vitest.config.ts).
const CHROMIUM = path.join(
  process.env.HOME ?? '',
  'Library/Caches/ms-playwright/chromium-1193/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
);

let server: ViteDevServer;
let browser: Browser;
let base = '';

beforeAll(async () => {
  server = await createServer({
    root: path.join(pkgRoot, 'src/registry'),
    configFile: path.join(pkgRoot, 'src/iso/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [pkgRoot] } },
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite did not bind a port');
  base = `http://127.0.0.1:${address.port}/registry-harness.html`;
  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function open(query = ''): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => {
    throw e;
  });
  await page.goto(`${base}${query}`);
  await page.getByTestId('process-editor').waitFor();
  // The probe part hands over the R3F scene; the GLB loads asynchronously after that.
  await page.waitForFunction(
    () => {
      const h = (window as any).__harness;
      return Boolean(h.scene?.getObjectByName('animshaft'));
    },
    undefined,
    { timeout: 30_000 },
  );
  return page;
}

// GLTFLoader sanitizes node names (PropertyBinding.sanitizeNodeName strips `.`),
// so the Blender empty `anim.shaft` is `object.name === 'animshaft'` in the
// scene; `findAnimNodes` reads the authored name from userData, tests use the
// sanitized one.
const shaftRotationY = (page: Page) =>
  page.evaluate(() => (window as any).__harness.scene.getObjectByName('animshaft').rotation.y as number);

const whiteBodyColors = (page: Page) =>
  page.evaluate(() => {
    const colors = new Set<string>();
    (window as any).__harness.scene.traverse((o: any) => {
      if (o.material?.userData?.hdFinish === 'white') colors.add(o.material.color.getHexString());
    });
    return [...colors];
  });

describe('registry-driven editor in a real canvas', () => {
  it('animates a GLB part registered by an extension, driven by metrics', async () => {
    const page = await open();
    try {
      const a = await shaftRotationY(page);
      await page.waitForTimeout(600);
      const b = await shaftRotationY(page);
      // 600 rpm = 10 rev/s; any positive delta proves the frame loop ran spin().
      expect(b).not.toBe(a);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('lists parts from the registry grouped by category, and picks up late installs', async () => {
    const page = await open();
    try {
      await page.getByRole('region', { name: 'Vessels' }).waitFor();
      await page.getByRole('region', { name: 'Piping' }).waitFor();
      await page.getByRole('region', { name: 'Test pack' }).getByRole('button', { name: /Test pump/ }).waitFor();
      expect(await page.getByRole('region', { name: 'Late pack' }).count()).toBe(0);
      await page.evaluate(() => (window as any).__harness.installLater());
      await page.getByRole('region', { name: 'Late pack' }).getByRole('button', { name: /Late arrival/ }).waitFor();
    } finally {
      await page.close();
    }
  }, 60_000);

  it('applies scene.theme inside the canvas', async () => {
    const light = await open();
    const dark = await open('?theme=holodeck.dark');
    try {
      expect(await whiteBodyColors(light)).toContain('ffffff');
      const darkColors = await whiteBodyColors(dark);
      expect(darkColors).toContain('d3d9e2');
      expect(darkColors).not.toContain('ffffff');
    } finally {
      await light.close();
      await dark.close();
    }
  }, 90_000);

  it('edit mode: inspector shows the selection, edits report through onChange, host panel renders', async () => {
    const page = await open('?selected=tank-1');
    try {
      const inspector = page.getByTestId('inspector');
      await inspector.getByText('tank-1').first().waitFor();
      await inspector.getByTestId('host-panel').waitFor();
      const level = inspector.locator('input[type=number]').first();
      expect(await level.inputValue()).toBe('0.4');
      await level.fill('0.9');
      await page.waitForFunction(() => (window as any).__harness.changes.length === 1);
      const changed = await page.evaluate(() => (window as any).__harness.changes[0]);
      expect(changed.objects.find((o: any) => o.id === 'tank-1').params).toEqual({ level: 0.9 });
      // The echoed scene must not loop back as a second change.
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => (window as any).__harness.changes.length)).toBe(1);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('run mode hides palette and inspector and ignores edit shortcuts', async () => {
    const page = await open('?mode=run&selected=tank-1');
    try {
      const root = page.getByTestId('process-editor');
      expect(await root.getAttribute('data-host-mode')).toBe('run');
      expect(await page.getByTestId('inspector').count()).toBe(0);
      expect(await page.getByText('Process library').count()).toBe(0);
      await page.keyboard.press('Delete');
      await page.keyboard.press('p');
      await page.waitForTimeout(200);
      expect(await root.getAttribute('data-object-count')).toBe('3');
      expect(await root.getAttribute('data-mode')).toBe('select');
      expect(await page.evaluate(() => (window as any).__harness.changes.length)).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
