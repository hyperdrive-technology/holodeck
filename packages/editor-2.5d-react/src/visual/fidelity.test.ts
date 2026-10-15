import { describe, expect, it } from 'vitest';
import {
  compareToReference,
  DEFAULT_EPSILON,
  isCi,
  judge,
  tighten,
  worstCells,
  type FidelityRecordFile,
  type RgbaImage,
} from './fidelity';

function solid(width: number, height: number, rgb: [number, number, number], alpha = 255): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = alpha;
  }
  return { width, height, data };
}

/** Fills a rectangle (in place) with a colour. */
function rect(img: RgbaImage, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]): RgbaImage {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  return img;
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

describe('compareToReference', () => {
  it('scores the drawn area, not the white floor around it', () => {
    // Same small drawing offset by 2 px on a large white canvas: the whole-canvas
    // score barely moves, the gated score drops sharply.
    const ref = rect(solid(200, 200, WHITE), 50, 50, 20, 20, BLACK);
    const ours = rect(solid(200, 200, WHITE), 52, 50, 20, 20, BLACK);
    const { metrics } = compareToReference(ref, ours);
    expect(metrics.pixelFidelity).toBeGreaterThanOrEqual(0.998);
    expect(metrics.fidelity).toBeLessThan(0.9);
    expect(metrics.relevantPixels).toBe(22 * 20);
  });

  it('treats two blank canvases as a perfect match', () => {
    const { metrics } = compareToReference(solid(10, 10, WHITE), solid(10, 10, [240, 240, 240]));
    expect(metrics.relevantPixels).toBe(0);
    expect(metrics.fidelity).toBe(1);
  });

  it('scores identical images 1 with zero error', () => {
    const a = rect(solid(40, 30, WHITE), 5, 5, 10, 10, BLACK);
    const b = rect(solid(40, 30, WHITE), 5, 5, 10, 10, BLACK);
    const { metrics } = compareToReference(a, b);
    expect(metrics.fidelity).toBe(1);
    expect(metrics.diffPixels).toBe(0);
    expect(metrics.rmse).toBe(0);
    expect(metrics.cells.every((c) => c.diffRatio === 0)).toBe(true);
  });

  it('counts extra ink as darker and missing ink as lighter', () => {
    const ref = rect(solid(40, 30, WHITE), 0, 0, 10, 10, BLACK); // ink top-left
    const ours = rect(solid(40, 30, WHITE), 30, 20, 10, 10, BLACK); // ink bottom-right instead
    const { metrics } = compareToReference(ref, ours);
    // Solid 10x10 blocks: the AA detector ignores some edge pixels, so allow a few.
    expect(metrics.lighterPixels).toBeGreaterThan(80);
    expect(metrics.lighterPixels).toBeLessThanOrEqual(100);
    expect(metrics.darkerPixels).toBeGreaterThan(80);
    expect(metrics.darkerPixels).toBeLessThanOrEqual(100);
    expect(metrics.diffPixels).toBe(metrics.lighterPixels + metrics.darkerPixels);
    expect(metrics.pixelFidelity).toBeCloseTo(1 - metrics.diffPixels / 1200, 5);
    // Relevant = the 200 inked pixels; every diff lies inside them.
    expect(metrics.relevantPixels).toBe(200);
    expect(metrics.fidelity).toBeCloseTo(1 - metrics.diffPixels / 200, 5);
  });

  it('rmse of white vs black is 255 and every pixel differs', () => {
    const { metrics } = compareToReference(solid(8, 8, WHITE), solid(8, 8, BLACK));
    expect(metrics.rmse).toBe(255);
    expect(metrics.fidelity).toBe(0);
    expect(metrics.inkRatio).toBe(1);
  });

  it('a sub-threshold shading change moves rmse but not fidelity', () => {
    const { metrics } = compareToReference(solid(20, 20, [200, 200, 200]), solid(20, 20, [196, 196, 196]));
    expect(metrics.fidelity).toBe(1);
    expect(metrics.rmse).toBeCloseTo(4, 3);
  });

  it('ranks the cell that holds the difference first', () => {
    const ref = solid(40, 30, WHITE);
    const ours = rect(solid(40, 30, WHITE), 31, 21, 8, 8, BLACK); // inside cell col 3, row 2 (4x3 grid of 10x10)
    const { metrics } = compareToReference(ref, ours);
    expect(metrics.cells).toHaveLength(12);
    const [worst] = worstCells(metrics.cells, 1);
    expect(worst).toMatchObject({ col: 3, row: 2, x: 30, y: 20, width: 10, height: 10 });
    expect(worst.diffRatio).toBeGreaterThan(0.3);
    expect(metrics.cells.filter((c) => c.diffRatio > 0)).toHaveLength(1);
  });

  it('honours a custom grid and covers every pixel with uneven cell sizes', () => {
    const { metrics } = compareToReference(solid(10, 7, WHITE), solid(10, 7, WHITE), { grid: { cols: 3, rows: 2 } });
    expect(metrics.cells).toHaveLength(6);
    const area = metrics.cells.reduce((s, c) => s + c.width * c.height, 0);
    expect(area).toBe(70);
  });

  it('composites transparent pixels over white, so alpha alone is not a difference', () => {
    const { metrics } = compareToReference(solid(10, 10, WHITE), solid(10, 10, BLACK, 0));
    expect(metrics.fidelity).toBe(1);
    expect(metrics.inkRatio).toBe(0);
  });

  it('emits diff, heatmap and overlay images of the same size', () => {
    const ref = rect(solid(20, 10, WHITE), 0, 0, 5, 5, BLACK);
    const ours = solid(20, 10, WHITE);
    const { images } = compareToReference(ref, ours);
    for (const img of [images.diff, images.heatmap, images.overlay]) {
      expect(img.width).toBe(20);
      expect(img.height).toBe(10);
      expect(img.data.length).toBe(20 * 10 * 4);
    }
    // Missing ink at (2,2): red in the diff, mid-grey in the overlay.
    const i = (2 * 20 + 2) * 4;
    expect([images.diff.data[i], images.diff.data[i + 1], images.diff.data[i + 2]]).toEqual([230, 30, 30]);
    expect(images.overlay.data[i]).toBe(128);
    // Unchanged pixel: heatmap shows the faded backdrop (white), not a colour.
    const j = (8 * 20 + 18) * 4;
    expect([images.heatmap.data[j], images.heatmap.data[j + 1], images.heatmap.data[j + 2]]).toEqual([255, 255, 255]);
  });

  it('leaves ignored rectangles out of every metric and hatches them in the images', () => {
    const ref = rect(solid(40, 30, WHITE), 30, 25, 10, 5, BLACK); // "toolbar" only in the reference
    const ours = solid(40, 30, WHITE);
    const plain = compareToReference(ref, ours).metrics;
    expect(plain.diffPixels).toBeGreaterThan(0);
    const { metrics, images } = compareToReference(ref, ours, { ignore: [{ x: 28, y: 24, width: 50, height: 50 }] });
    expect(metrics.ignoredPixels).toBe(12 * 6); // clipped to the image
    expect(metrics.diffPixels).toBe(0);
    expect(metrics.fidelity).toBe(1);
    expect(metrics.rmse).toBe(0);
    expect(metrics.relevantPixels).toBe(0);
    const i = (26 * 40 + 32) * 4;
    expect(images.diff.data[i]).toBe(images.diff.data[i + 1]);
    expect([200, 225]).toContain(images.diff.data[i]);
    expect(() => compareToReference(ref, ours, { ignore: [{ x: 0, y: 0, width: 40, height: 30 }] })).toThrow(/whole image/);
  });

  it('rejects mismatched sizes, empty images and bad options', () => {
    expect(() => compareToReference(solid(10, 10, WHITE), solid(10, 11, WHITE))).toThrow(/size mismatch/);
    expect(() => compareToReference(solid(0, 0, WHITE), solid(0, 0, WHITE))).toThrow(/empty/);
    expect(() => compareToReference(solid(2, 2, WHITE), solid(2, 2, WHITE), { threshold: 2 })).toThrow(/threshold/);
    expect(() => compareToReference(solid(2, 2, WHITE), solid(2, 2, WHITE), { grid: { cols: 0, rows: 1 } })).toThrow(/grid/);
  });
});

describe('judge', () => {
  const record = { fidelity: 0.8, epsilon: 0.002, rmse: 30, recordedAt: '2026-10-14' };

  it('is unrecorded (and passes) without a record locally', () => {
    const r = judge(undefined, { fidelity: 0.5 });
    expect(r.status).toBe('unrecorded');
    expect(r.ok).toBe(true);
    expect(judge(undefined, { fidelity: 0.5 }, { requireRecord: false }).ok).toBe(true);
  });

  it('fails as missing without a record when one is required (CI)', () => {
    const r = judge(undefined, { fidelity: 0.5 }, { requireRecord: true, platform: 'linux' });
    expect(r.status).toBe('missing');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('linux');
    expect(r.message).toContain('0.5');
    expect(r.message).toContain('reference-fidelity.json');
    expect(r.message).toContain('pnpm visual:record');
  });

  it('judges against an existing record the same way whether or not one is required', () => {
    for (const requireRecord of [false, true]) {
      expect(judge(record, { fidelity: 0.8 }, { requireRecord }).status).toBe('held');
      expect(judge(record, { fidelity: 0.7 }, { requireRecord }).status).toBe('regressed');
      expect(judge(record, { fidelity: 0.81 }, { requireRecord }).status).toBe('improved');
    }
  });

  it('only regressed and missing fail', () => {
    expect(judge(record, { fidelity: 0.8 }).ok).toBe(true);
    expect(judge(record, { fidelity: 0.81 }).ok).toBe(true);
    expect(judge(record, { fidelity: 0.7979 }).ok).toBe(false);
  });

  it('holds within epsilon on either side', () => {
    expect(judge(record, { fidelity: 0.8 }).status).toBe('held');
    expect(judge(record, { fidelity: 0.798 }).status).toBe('held'); // exactly at the floor
    expect(judge(record, { fidelity: 0.802 }).status).toBe('held');
  });

  it('regresses below the floor and says by how much', () => {
    const r = judge(record, { fidelity: 0.7979 });
    expect(r.status).toBe('regressed');
    expect(r.message).toContain('0.798');
  });

  it('flags an improvement beyond epsilon so the gate gets tightened', () => {
    const r = judge(record, { fidelity: 0.81 });
    expect(r.status).toBe('improved');
    expect(r.message).toContain('visual:record');
  });
});

describe('isCi', () => {
  it('is true for the values CI systems set', () => {
    expect(isCi({ CI: 'true' })).toBe(true);
    expect(isCi({ CI: '1' })).toBe(true);
    expect(isCi({ CI: 'TRUE' })).toBe(true);
  });

  it('is false when unset, empty, 0 or false', () => {
    expect(isCi({})).toBe(false);
    expect(isCi({ CI: '' })).toBe(false);
    expect(isCi({ CI: ' ' })).toBe(false);
    expect(isCi({ CI: '0' })).toBe(false);
    expect(isCi({ CI: 'false' })).toBe(false);
    expect(isCi({ CI: 'False' })).toBe(false);
  });
});

describe('tighten', () => {
  const empty: FidelityRecordFile = { description: 'x', platforms: {} };

  it('sets a first record with the default epsilon', () => {
    const { file, changed } = tighten(empty, 'darwin', { fidelity: 0.7, rmse: 40 }, 'now');
    expect(changed).toBe(true);
    expect(file.platforms.darwin).toEqual({ fidelity: 0.7, epsilon: DEFAULT_EPSILON, rmse: 40, recordedAt: 'now' });
    expect(empty.platforms).toEqual({}); // input not mutated
  });

  it('raises the score and keeps a hand-set epsilon', () => {
    const start = tighten(empty, 'darwin', { fidelity: 0.7, rmse: 40 }, 't0', 0.01).file;
    const { file, changed } = tighten(start, 'darwin', { fidelity: 0.72, rmse: 38 }, 't1');
    expect(changed).toBe(true);
    expect(file.platforms.darwin).toEqual({ fidelity: 0.72, epsilon: 0.01, rmse: 38, recordedAt: 't1' });
  });

  it('never lowers the score (equal or worse is a no-op)', () => {
    const start = tighten(empty, 'darwin', { fidelity: 0.7, rmse: 40 }, 't0').file;
    expect(tighten(start, 'darwin', { fidelity: 0.7, rmse: 10 }, 't1')).toEqual({ file: start, changed: false });
    expect(tighten(start, 'darwin', { fidelity: 0.6, rmse: 10 }, 't1')).toEqual({ file: start, changed: false });
  });

  it('drops a hand-set source when it raises the score', () => {
    const start: FidelityRecordFile = {
      description: 'x',
      platforms: { linux: { fidelity: 0.5, epsilon: 0.001, rmse: 30, recordedAt: 't0', source: 'CI run 1' } },
    };
    const { file } = tighten(start, 'linux', { fidelity: 0.6, rmse: 20 }, 't1');
    expect(file.platforms.linux).toEqual({ fidelity: 0.6, epsilon: 0.001, rmse: 20, recordedAt: 't1' });
  });

  it('ignores a gain within epsilon, so the record cannot creep up on noise', () => {
    const start = tighten(empty, 'linux', { fidelity: 0.7, rmse: 40 }, 't0', 0.001).file;
    expect(tighten(start, 'linux', { fidelity: 0.7005, rmse: 39 }, 't1')).toEqual({ file: start, changed: false });
    expect(tighten(start, 'linux', { fidelity: 0.701, rmse: 39 }, 't1')).toEqual({ file: start, changed: false });
    const raised = tighten(start, 'linux', { fidelity: 0.7011, rmse: 39 }, 't1');
    expect(raised.changed).toBe(true);
    expect(raised.file.platforms.linux.fidelity).toBe(0.7011);
  });

  it('keeps platforms independent', () => {
    const start = tighten(empty, 'darwin', { fidelity: 0.7, rmse: 40 }, 't0').file;
    const { file } = tighten(start, 'linux', { fidelity: 0.5, rmse: 60 }, 't1');
    expect(file.platforms.darwin.fidelity).toBe(0.7);
    expect(file.platforms.linux.fidelity).toBe(0.5);
  });
});
