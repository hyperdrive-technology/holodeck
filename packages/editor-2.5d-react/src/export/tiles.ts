/**
 * Tiled high-resolution image export: the pure math (holodeck#42, lane S2).
 *
 * A picture larger than the GPU can render in one pass (or than a sane
 * render target) is drawn as a grid of tiles. Each tile renders the SAME
 * orthographic camera with `camera.setViewOffset(fullW, fullH, x, y, w, h)`,
 * which narrows the frustum to that window of the full picture, so the tiles
 * line up exactly and stitch into one image with no seams in the geometry.
 *
 * Every tile is a `tileSize` x `tileSize` square, including the ones on the
 * right / bottom edge: the frustum simply extends past the picture there and
 * the extra pixels are cropped when the tile is copied into the output.
 * Fixed-size tiles mean one reusable render target, and a `tileSize` that is a
 * multiple of 64 px makes every row 256-byte aligned (WebGPU's
 * `bytesPerRow` rule), so readback rows need no unpadding in practice;
 * `unpadRows` still handles a padded buffer.
 */

/** One tile: where it sits in the output picture, and how much of it is real picture (the rest is cropped). */
export interface ExportTile {
  /** Left edge in output pixels. */
  x: number;
  /** Top edge in output pixels (y grows down, like the output image). */
  y: number;
  /** Visible width (<= tileSize; smaller on the right edge). */
  width: number;
  /** Visible height (<= tileSize; smaller on the bottom edge). */
  height: number;
}

export interface TilePlan {
  /** Output picture size in pixels. */
  width: number;
  height: number;
  /** Side of every (square) tile render, in pixels. */
  tileSize: number;
  columns: number;
  rows: number;
  /** Row-major: left to right, then top to bottom. */
  tiles: ExportTile[];
}

export interface TilePlanOptions {
  /** View size in CSS pixels (what is on screen). */
  viewWidth: number;
  viewHeight: number;
  /** Output pixels per CSS pixel. Default 2. */
  scale?: number;
  /** Tile side in pixels; a multiple of 64. Default `DEFAULT_EXPORT_TILE_SIZE`. */
  tileSize?: number;
}

/** Default tile: 1024 px (4 MB of RGBA8), well inside every WebGPU adapter's `maxTextureDimension2D` (>= 8192). */
export const DEFAULT_EXPORT_TILE_SIZE = 1024;
/** Default output scale (output px per CSS px). */
export const DEFAULT_EXPORT_SCALE = 2;
/** Largest scale accepted. */
export const MAX_EXPORT_SCALE = 8;
/**
 * Largest output side. Chrome's 2D canvas (the stitching surface) refuses
 * sides above 32767 and areas above 268,435,456 px; 16384 keeps both and a
 * 1 GB RGBA buffer out of reach.
 */
export const MAX_EXPORT_SIDE = 16384;
/** Largest output area: 100 megapixels (400 MB RGBA while stitching). */
export const MAX_EXPORT_PIXELS = 100_000_000;

/** Bad export options (size, scale, tile). `problems` lists every one. */
export class ExportSizeError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`image export: ${problems.join('; ')}`);
    this.name = 'ExportSizeError';
  }
}

/**
 * The tile grid for an export of a `viewWidth` x `viewHeight` CSS-pixel view
 * at `scale`. Output sizes round to the nearest pixel (at least 1). Throws
 * `ExportSizeError` (with every problem) on invalid input or an output that
 * is too large.
 */
export function planExportTiles({ viewWidth, viewHeight, scale = DEFAULT_EXPORT_SCALE, tileSize = DEFAULT_EXPORT_TILE_SIZE }: TilePlanOptions): TilePlan {
  const problems: string[] = [];
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (!positive(viewWidth) || !positive(viewHeight)) problems.push(`view size must be positive, got ${viewWidth} x ${viewHeight}`);
  if (!positive(scale) || scale > MAX_EXPORT_SCALE) problems.push(`scale must be > 0 and <= ${MAX_EXPORT_SCALE}, got ${scale}`);
  if (!Number.isInteger(tileSize) || tileSize < 64 || tileSize % 64 !== 0 || tileSize > MAX_EXPORT_SIDE) {
    problems.push(`tileSize must be a multiple of 64 between 64 and ${MAX_EXPORT_SIDE}, got ${tileSize}`);
  }
  if (problems.length) throw new ExportSizeError(problems);
  const width = Math.max(1, Math.round(viewWidth * scale));
  const height = Math.max(1, Math.round(viewHeight * scale));
  if (width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) problems.push(`output ${width} x ${height} px exceeds ${MAX_EXPORT_SIDE} px per side`);
  if (width * height > MAX_EXPORT_PIXELS) problems.push(`output ${width} x ${height} px exceeds ${MAX_EXPORT_PIXELS / 1e6} megapixels`);
  if (problems.length) throw new ExportSizeError(problems);
  const columns = Math.ceil(width / tileSize);
  const rows = Math.ceil(height / tileSize);
  const tiles: ExportTile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const x = c * tileSize;
      const y = r * tileSize;
      tiles.push({ x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) });
    }
  }
  return { width, height, tileSize, columns, rows, tiles };
}

/**
 * Tightly packed RGBA rows from a GPU readback of a `width` x `height` region.
 * WebGPU copies rows `bytesPerRow`-aligned (256 bytes); three.js returns that
 * buffer as is, with only the last row unpadded. Returns `data` itself when it
 * is already packed.
 */
export function unpadRows(data: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const row = width * 4;
  const packed = row * height;
  const view = (d: Uint8Array | Uint8ClampedArray) => new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength);
  if (data.length === packed) return view(data);
  if (height < 2 || data.length < packed) throw new RangeError(`readback is ${data.length} bytes, expected at least ${packed} for ${width} x ${height}`);
  const stride = (data.length - row) / (height - 1);
  if (!Number.isInteger(stride) || stride < row) throw new RangeError(`readback of ${data.length} bytes is not ${height} rows of ${width} px`);
  const out = new Uint8ClampedArray(packed);
  for (let y = 0; y < height; y++) out.set(data.subarray(y * stride, y * stride + row), y * row);
  return out;
}

/** Linewidth multiplier for screen-space lines in the export: CSS-px widths scale with the picture, not the screen's DPR. */
export function exportLineScale(scale: number, devicePixelRatio: number): number {
  return devicePixelRatio > 0 ? scale / devicePixelRatio : scale;
}
