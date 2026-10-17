/**
 * Real-browser check of the Arcentry-parity objects (holodeck#36): every
 * object type in objects-harness.tsx renders in a WebGPU canvas, data-only
 * parts get their logo plane, connectors route and animate, opacity / z-order
 * apply, a broken image URL degrades to nothing. Saves
 * artifacts/render/objects.png (and objects-dark.png) for review.
 */
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { animationFrames, collectPageLog, launchRenderBrowser, startHarness, waitForRendered, type Harness } from '../test-support/render-harness';
import { artifactsDir, decodePng } from '../visual/io';

let harness: Harness;
let browser: Browser;

beforeAll(async () => {
  if (!CHROMIUM) return;
  harness = await startHarness('objects');
  browser = await launchRenderBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await harness?.close();
});

async function open(query = ''): Promise<{ page: Page; logs: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = collectPageLog(page);
  await page.goto(`${harness.origin}/objects-harness.html${query}`);
  await page.getByTestId('process-editor').waitFor();
  await waitForRendered(page);
  await page.waitForFunction(() => Boolean((window as any).__objects.scene));
  return { page, logs };
}

/** Counts scene objects whose userData has `key` (optionally summing a numeric value). */
const countUserData = (page: Page, key: string) =>
  page.evaluate((k) => {
    let n = 0;
    (window as any).__objects.scene.traverse((o: any) => {
      if (o.userData && k in o.userData) n += 1;
    });
    return n;
  }, key);

/** Pixels within `tol` of `hex` in a PNG screenshot. */
function countColour(png: Buffer, hex: string, tol = 28): number {
  const img = decodePng(png);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (Math.abs(img.data[i]! - r) <= tol && Math.abs(img.data[i + 1]! - g) <= tol && Math.abs(img.data[i + 2]! - b) <= tol) n += 1;
  }
  return n;
}

describe.skipIf(!CHROMIUM)('Arcentry-parity objects in a real canvas', () => {
  it('renders every object type, with logos, connectors, areas, labels, icons, images and metadata', async () => {
    const { page, logs } = await open();
    try {
      // Data-only parts: a logo plane on the block and on the GLB (once both textures load).
      await page.waitForFunction(() => {
        let n = 0;
        (window as any).__objects.scene.traverse((o: any) => {
          if (o.userData?.hdLogo) n += 1;
        });
        return n >= ((window as any).__objects.billboard ? 4 : 3); // web + db blocks, pump GLB (+ billboard)
      });
      await waitForRendered(page);
      // holodeck#138: each logo plane faces its slot's normal. Top-face logos
      // face up; the billboard's stands on its +Z front face, image top up.
      const logos: Array<{ id: string; facing: number[]; top: number[] }> = await page.evaluate(() => {
        const out: Array<{ id: string; facing: number[]; top: number[] }> = [];
        (window as any).__objects.scene.traverse((o: any) => {
          if (!o.userData?.hdLogo) return;
          const mesh = o.children[0];
          const e = mesh.matrixWorld.elements as number[];
          // Columns of the world matrix: local +Y (image top) and +Z (plane normal), normalised.
          const norm = (v: number[]) => {
            const l = Math.hypot(v[0]!, v[1]!, v[2]!);
            return v.map((x) => Math.round((x / l) * 1000) / 1000);
          };
          out.push({ id: String(o.userData.hdLogo).slice(0, 24), facing: norm([e[8]!, e[9]!, e[10]!]), top: norm([e[4]!, e[5]!, e[6]!]) });
        });
        return out;
      });
      const billboardShown = await page.evaluate(() => (window as any).__objects.billboard as boolean);
      const upright = logos.filter((l) => Math.abs(l.facing[1]!) < 0.5);
      for (const l of logos.filter((x) => !upright.includes(x))) expect(l.facing[1], `flat logo ${l.id} faces up`).toBeCloseTo(1, 2);
      expect(upright.length, 'upright logos (only the billboard)').toBe(billboardShown ? 1 : 0);
      for (const l of upright) {
        expect(l.facing[2], 'billboard logo faces the sign front (+Z)').toBeCloseTo(1, 2);
        expect(l.top[1], 'billboard logo image top is up').toBeCloseTo(1, 2);
      }
      expect(await countUserData(page, 'hdConnector')).toBe(3);
      expect(await countUserData(page, 'hdFlowDots')).toBe(1);
      expect(await countUserData(page, 'hdAreaWalls')).toBe(1);
      expect(await countUserData(page, 'hdAreaShadow')).toBe(1);
      expect(await countUserData(page, 'hdIcon')).toBe(2);
      expect(await countUserData(page, 'hdMeta')).toBe(2); // web block + the pooled-part valve (holodeck#95)
      await page.waitForFunction(() => {
        let n = 0;
        (window as any).__objects.scene.traverse((o: any) => {
          if (o.userData?.hdImage) n += 1;
        });
        return n >= 2;
      });

      // Every stroke has geometry (routing produced a path, not an empty mesh).
      const strokeVertexCounts = await page.evaluate(() => {
        const counts: number[] = [];
        (window as any).__objects.scene.traverse((o: any) => {
          if (o.userData?.hdStroke) counts.push(o.geometry.attributes.position.count);
        });
        return counts;
      });
      expect(strokeVertexCounts.length).toBeGreaterThanOrEqual(4); // 3 connectors + the dashed area outline
      expect(strokeVertexCounts.every((c) => c > 0)).toBe(true);

      // Data-only block colours come from the part definition.
      const blockColours = await page.evaluate(() => {
        const out = new Set<string>();
        (window as any).__objects.scene.traverse((o: any) => {
          if (o.isMesh && o.geometry?.type === 'BoxGeometry' && o.material?.userData?.hdFinish === 'white') out.add(o.material.color.getHexString());
        });
        return [...out];
      });
      expect(blockColours).toContain('f4f6fb');

      // The broken image warns once and draws nothing; nothing else errors.
      await page.waitForFunction(() => (window as any).__objects.warnings.some((w: string) => w.includes('does-not-exist.png')));
      // holodeck#96: a host-set URL with a disguised scheme is refused at the texture choke point, never requested.
      await page.waitForFunction(() => (window as any).__objects.warnings.some((w: string) => w.includes('refusing image URL')));
      expect(logs.filter((l) => l.startsWith('failed:') && l.includes('javascript')), logs.join('\n')).toEqual([]);
      expect(logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);

      await animationFrames(page, 4);
      await waitForRendered(page);
      const png = await page.screenshot({ path: path.join(artifactsDir('render'), 'objects.png'), type: 'png' });
      // Distinctive colours from the harness: the red routed connector, the orange logos, the green image.
      expect(countColour(png, '#d0021b'), 'connector red').toBeGreaterThan(150);
      expect(countColour(png, '#ff9900'), 'logo orange').toBeGreaterThan(60);
      expect(countColour(png, '#22aa44'), 'image green').toBeGreaterThan(150);
    } finally {
      await page.close();
    }
  }, 90_000);

  it('animates connector flow dots between frames', async () => {
    const { page } = await open();
    try {
      const dotX = () =>
        page.evaluate(() => {
          let x: number | null = null;
          (window as any).__objects.scene.traverse((o: any) => {
            if (o.userData?.hdFlowDots && x === null) x = o.instanceMatrix.array[12];
          });
          return x;
        });
      const before = await dotX();
      expect(before).not.toBeNull();
      await page.waitForFunction(
        (b) => {
          let x: number | null = null;
          (window as any).__objects.scene.traverse((o: any) => {
            if (o.userData?.hdFlowDots && x === null) x = o.instanceMatrix.array[12];
          });
          return x !== null && x !== b;
        },
        before,
      );
    } finally {
      await page.close();
    }
  }, 60_000);

  it('applies opacity (cloned, faded materials) and z-order (renderOrder offset)', async () => {
    const { page } = await open();
    try {
      await page.waitForFunction(() => {
        let ok = false;
        (window as any).__objects.scene.traverse((o: any) => {
          if (o.userData?.hdOpacity === 0.5) {
            o.traverse((m: any) => {
              if (m.isMesh && m.material?.transparent && m.material.userData?.hdFadedFrom) ok = true;
            });
          }
        });
        return ok;
      });
      const zOrders = await page.evaluate(() => {
        const orders: number[] = [];
        (window as any).__objects.scene.traverse((o: any) => {
          if (o.userData?.hdZ === 2) o.traverse((m: any) => m.isMesh && orders.push(m.renderOrder));
        });
        return orders;
      });
      expect(zOrders.length).toBeGreaterThan(0);
      expect(zOrders.every((r) => r >= 200)).toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('picks annotation colours from the active theme', async () => {
    const { page } = await open('?theme=holodeck.dark');
    try {
      const strokeColours = await page.evaluate(() => {
        const out = new Set<string>();
        (window as any).__objects.scene.traverse((o: any) => {
          if (o.userData?.hdStroke) out.add(o.material.color.getHexString());
        });
        return [...out];
      });
      // c-centre and c-free leave colour empty: the dark theme's connector token.
      expect(strokeColours).toContain('2f3a4a');
      expect(strokeColours).toContain('d0021b');
      await page.screenshot({ path: path.join(artifactsDir('render'), 'objects-dark.png'), type: 'png' });
    } finally {
      await page.close();
    }
  }, 60_000);
});
