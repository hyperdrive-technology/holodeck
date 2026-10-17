import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPORT_SCALE,
  DEFAULT_EXPORT_TILE_SIZE,
  ExportSizeError,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
  exportLineScale,
  planExportTiles,
  unpadRows,
} from './tiles';

const area = (t: { width: number; height: number }) => t.width * t.height;

describe('planExportTiles', () => {
  it('defaults to 2x in 1024 px tiles', () => {
    const plan = planExportTiles({ viewWidth: 640, viewHeight: 400 });
    expect(DEFAULT_EXPORT_SCALE).toBe(2);
    expect(plan).toMatchObject({ width: 1280, height: 800, tileSize: DEFAULT_EXPORT_TILE_SIZE, columns: 2, rows: 1 });
    expect(plan.tiles).toEqual([
      { x: 0, y: 0, width: 1024, height: 800 },
      { x: 1024, y: 0, width: 256, height: 800 },
    ]);
  });

  it('covers the picture exactly once, row-major, cropping edge tiles', () => {
    const plan = planExportTiles({ viewWidth: 1000, viewHeight: 700, scale: 3, tileSize: 512 });
    expect(plan).toMatchObject({ width: 3000, height: 2100, columns: 6, rows: 5 });
    expect(plan.tiles).toHaveLength(30);
    expect(plan.tiles.reduce((s, t) => s + area(t), 0)).toBe(3000 * 2100);
    // Row-major order and the grid positions.
    plan.tiles.forEach((t, i) => {
      expect(t.x).toBe((i % 6) * 512);
      expect(t.y).toBe(Math.floor(i / 6) * 512);
      expect(t.x + t.width).toBeLessThanOrEqual(3000);
      expect(t.y + t.height).toBeLessThanOrEqual(2100);
    });
    expect(plan.tiles.at(-1)).toEqual({ x: 2560, y: 2048, width: 440, height: 52 });
    // No overlap: every pixel belongs to exactly one tile (sampled on a grid).
    for (let y = 0; y < 2100; y += 37) {
      for (let x = 0; x < 3000; x += 41) {
        expect(plan.tiles.filter((t) => x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height)).toHaveLength(1);
      }
    }
  });

  it('is one tile when the picture fits and exactly fills tiles on multiples', () => {
    expect(planExportTiles({ viewWidth: 100, viewHeight: 50, scale: 1 }).tiles).toEqual([{ x: 0, y: 0, width: 100, height: 50 }]);
    const exact = planExportTiles({ viewWidth: 512, viewHeight: 256, scale: 1, tileSize: 256 });
    expect(exact.tiles.every((t) => t.width === 256 && t.height === 256)).toBe(true);
    expect(exact.tiles).toHaveLength(2);
  });

  it('rounds fractional sizes and never goes below one pixel', () => {
    expect(planExportTiles({ viewWidth: 333.4, viewHeight: 0.2, scale: 1.5 })).toMatchObject({ width: 500, height: 1 });
  });

  it('lists every problem with the options at once', () => {
    try {
      planExportTiles({ viewWidth: 0, viewHeight: Number.NaN, scale: 9, tileSize: 100 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ExportSizeError);
      const problems = (error as ExportSizeError).problems;
      expect(problems).toHaveLength(3);
      expect(problems.join('\n')).toMatch(/view size/);
      expect(problems.join('\n')).toMatch(/scale/);
      expect(problems.join('\n')).toMatch(/tileSize/);
    }
  });

  it.each([
    [{ scale: 0 }, /scale/],
    [{ scale: -1 }, /scale/],
    [{ scale: Number.POSITIVE_INFINITY }, /scale/],
    [{ tileSize: 32 }, /tileSize/],
    [{ tileSize: 1000 }, /tileSize/],
    [{ tileSize: 64.5 }, /tileSize/],
    [{ tileSize: MAX_EXPORT_SIDE * 2 }, /tileSize/],
  ])('rejects %o', (options, message) => {
    expect(() => planExportTiles({ viewWidth: 100, viewHeight: 100, ...options })).toThrow(message);
  });

  it('refuses outputs that are too large per side or in area', () => {
    expect(() => planExportTiles({ viewWidth: MAX_EXPORT_SIDE / 2 + 1, viewHeight: 10, scale: 2 })).toThrow(/per side/);
    expect(() => planExportTiles({ viewWidth: MAX_EXPORT_SIDE / 2, viewHeight: 10, scale: 2 })).not.toThrow();
    const side = Math.ceil(Math.sqrt(MAX_EXPORT_PIXELS)) + 1;
    expect(() => planExportTiles({ viewWidth: side, viewHeight: side, scale: 1 })).toThrow(/megapixels/);
  });
});

describe('unpadRows', () => {
  it('returns packed data as is (same memory)', () => {
    const data = new Uint8Array(2 * 2 * 4).map((_, i) => i);
    const out = unpadRows(data, 2, 2);
    expect(out.buffer).toBe(data.buffer);
    expect([...out]).toEqual([...data]);
  });

  it('strips WebGPU 256-byte row padding (last row unpadded)', () => {
    // 3 px wide = 12 bytes per row, padded to 256; 3 rows -> 2 * 256 + 12 bytes.
    const width = 3;
    const height = 3;
    const padded = new Uint8Array(2 * 256 + 12);
    for (let y = 0; y < height; y++) for (let b = 0; b < width * 4; b++) padded[y * 256 + b] = y * 50 + b;
    const out = unpadRows(padded, width, height);
    expect(out).toHaveLength(36);
    for (let y = 0; y < height; y++) for (let b = 0; b < 12; b++) expect(out[y * 12 + b]).toBe(y * 50 + b);
  });

  it('rejects buffers that cannot be the region', () => {
    expect(() => unpadRows(new Uint8Array(10), 2, 2)).toThrow(RangeError);
    expect(() => unpadRows(new Uint8Array(17), 1, 1)).toThrow(RangeError);
    expect(() => unpadRows(new Uint8Array(4 * 2 + 3), 2, 2)).toThrow(RangeError);
  });
});

describe('exportLineScale', () => {
  it('scales CSS-px line widths with the export, independent of the screen DPR', () => {
    expect(exportLineScale(2, 1)).toBe(2);
    expect(exportLineScale(2, 2)).toBe(1);
    expect(exportLineScale(4, 2)).toBe(2);
    expect(exportLineScale(3, 0)).toBe(3);
  });
});
