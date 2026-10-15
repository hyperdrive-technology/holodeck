/**
 * Arcentry fidelity metric for the reference render (holodeck#32).
 *
 * Compares our render of tests/scene.json with the Arcentry target
 * (tests/snapshots/reference-canvas.png, the process pane cropped out of
 * reference.jpg) and produces:
 *
 *   - `fidelity` = share of the *relevant* pixels that pixelmatch calls equal
 *     (OKLab HyAB distance <= `threshold`, anti-aliased pixels ignored), where
 *     relevant = drawn (darker than the #EEE floor-grid lines) in either image,
 *     or different. This is the one gated score: higher is closer to Arcentry.
 *     Normalising by the drawn area matters: ~78 % of the canvas is white floor
 *     in both images, and a whole-canvas ratio hid a 1.5 % zoom change inside
 *     the noise allowance (0.00045 vs 0.0005), while this score moves ~10x more.
 *   - `pixelFidelity` = 1 - diff ratio over the whole canvas (reported only).
 *   - `rmse` (0..255, RGB): continuous, moves on shading changes too small to
 *     cross the pixelmatch threshold. Reported, not gated.
 *   - per-cell diff ratios on a grid, worst first, so an agent knows where to look.
 *   - images: a pixelmatch diff (red = ours lighter than Arcentry / missing ink,
 *     blue = ours darker / extra ink, over a faded copy of ours), a continuous
 *     heatmap and a 50/50 overlay.
 *
 * The record (tests/visual/reference-fidelity.json) is a ratchet: `judge`
 * fails a run whose fidelity drops more than `epsilon` below the record, and
 * `tighten` only ever raises the recorded score.
 *
 * Pure: no file or browser I/O, so it is unit-tested in fidelity.test.ts.
 */
import pixelmatch from 'pixelmatch';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major (pngjs `PNG.data`, ImageData.data). */
  data: Uint8Array | Uint8ClampedArray;
}

export interface FidelityOptions {
  /** pixelmatch per-pixel threshold (0..1). Default 0.1, same as core's UI loop. */
  threshold?: number;
  /** Region grid for the per-cell breakdown. Default 4 columns x 3 rows. */
  grid?: { cols: number; rows: number };
  /**
   * Rectangles left out of every metric (e.g. the Arcentry toolbar baked into
   * the reference screenshot). Drawn hatched grey in the output images.
   */
  ignore?: ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
}

export interface FidelityCell {
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  diffRatio: number;
}

export interface FidelityMetrics {
  width: number;
  height: number;
  threshold: number;
  /** 1 - diffPixels / relevantPixels. The gated score. */
  fidelity: number;
  /** 1 - diffRatio (whole canvas). */
  pixelFidelity: number;
  /** diffPixels / all pixels. */
  diffRatio: number;
  /** Pixels drawn in either image (luminance < INK_LUMINANCE) or different. */
  relevantPixels: number;
  /** Pixels excluded by `ignore`. */
  ignoredPixels: number;
  diffPixels: number;
  /** Pixels darker in ours than in the reference (extra ink: thicker lines, darker shading). */
  darkerPixels: number;
  /** Pixels lighter in ours (missing ink: thin or absent outlines, washed-out shading). */
  lighterPixels: number;
  /** RGB root-mean-square error, 0..255. */
  rmse: number;
  /** Share of our pixels that are not near-white (blank-render guard). */
  inkRatio: number;
  /** Grid cells in row-major order. */
  cells: FidelityCell[];
}

export interface FidelityImages {
  diff: RgbaImage;
  heatmap: RgbaImage;
  overlay: RgbaImage;
}

/** Darker than this is "drawn": below the floor grid's #EEE cell lines (238), above its #CCC section lines (204). */
export const INK_LUMINANCE = 230;

const DIFF_LIGHTER: [number, number, number] = [230, 30, 30];
const DIFF_DARKER: [number, number, number] = [20, 90, 230];
const AA_COLOR: [number, number, number] = [255, 210, 0];

function luminance(d: RgbaImage['data'], i: number): number {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

/** Composites RGBA over white (screenshots and decoded JPEG crops are opaque; this keeps odd inputs honest). */
function flatten(img: RgbaImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = img.data[i + 3] / 255;
    out[i] = img.data[i] * a + 255 * (1 - a);
    out[i + 1] = img.data[i + 1] * a + 255 * (1 - a);
    out[i + 2] = img.data[i + 2] * a + 255 * (1 - a);
    out[i + 3] = 255;
  }
  return out;
}

export function compareToReference(
  reference: RgbaImage,
  actual: RgbaImage,
  { threshold = 0.1, grid = { cols: 4, rows: 3 }, ignore = [] }: FidelityOptions = {},
): { metrics: FidelityMetrics; images: FidelityImages } {
  const { width, height } = reference;
  if (actual.width !== width || actual.height !== height) {
    throw new Error(
      `size mismatch: reference ${width}x${height}, render ${actual.width}x${actual.height} (fixed viewport / DPR 1 expected)`,
    );
  }
  if (width === 0 || height === 0) throw new Error('empty image');
  if (!(threshold >= 0 && threshold <= 1)) throw new Error(`threshold must be in 0..1, got ${threshold}`);
  if (!(grid.cols >= 1 && grid.rows >= 1)) throw new Error('grid needs at least one row and column');

  const ref = flatten(reference);
  const ours = flatten(actual);
  const ignored = new Uint8Array(width * height);
  for (const r of ignore) {
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(height, Math.ceil(r.y + r.height)); y++) {
      for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(width, Math.ceil(r.x + r.width)); x++) {
        ignored[y * width + x] = 1;
      }
    }
  }
  const mask = new Uint8ClampedArray(width * height * 4);
  // diffColor marks pixels lighter in `ours` (img2) than in the reference; diffColorAlt darker.
  const diffPixels = pixelmatch(ref, ours, mask, width, height, {
    threshold,
    includeAA: false,
    diffMask: true,
    diffColor: DIFF_LIGHTER,
    diffColorAlt: DIFF_DARKER,
    aaColor: AA_COLOR,
    ignoreMask: ignored,
  });

  const total = width * height;
  const cellW = width / grid.cols;
  const cellH = height / grid.rows;
  const cellDiff = new Array<number>(grid.cols * grid.rows).fill(0);
  const cellTotal = new Array<number>(grid.cols * grid.rows).fill(0);

  const diff = new Uint8ClampedArray(total * 4);
  const heatmap = new Uint8ClampedArray(total * 4);
  const overlay = new Uint8ClampedArray(total * 4);
  let sq = 0;
  let ink = 0;
  let relevant = 0;
  let ignoredCount = 0;
  let darker = 0;
  let lighter = 0;

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const x = p % width;
    const y = (p - x) / width;
    if (ignored[p]) {
      ignoredCount++;
      const hatch = (x + y) % 8 < 4 ? 200 : 225;
      for (const img of [diff, heatmap, overlay]) {
        img[i] = img[i + 1] = img[i + 2] = hatch;
        img[i + 3] = 255;
      }
      continue;
    }
    const dr = ours[i] - ref[i];
    const dg = ours[i + 1] - ref[i + 1];
    const db = ours[i + 2] - ref[i + 2];
    sq += dr * dr + dg * dg + db * db;
    const lum = luminance(ours, i);
    if (lum < 245) ink++;
    const refLum = luminance(ref, i);

    const isLighter = mask[i] === DIFF_LIGHTER[0] && mask[i + 1] === DIFF_LIGHTER[1] && mask[i + 2] === DIFF_LIGHTER[2] && mask[i + 3] > 0;
    const isDarker = mask[i] === DIFF_DARKER[0] && mask[i + 1] === DIFF_DARKER[1] && mask[i + 2] === DIFF_DARKER[2] && mask[i + 3] > 0;
    if (isLighter) lighter++;
    if (isDarker) darker++;
    if (isLighter || isDarker || lum < INK_LUMINANCE || refLum < INK_LUMINANCE) relevant++;
    const cell = Math.min(grid.rows - 1, Math.floor(y / cellH)) * grid.cols + Math.min(grid.cols - 1, Math.floor(x / cellW));
    cellTotal[cell]++;
    if (isLighter || isDarker) cellDiff[cell]++;

    // Faded grayscale of ours as the backdrop for diff and heatmap.
    const faded = 255 - (255 - lum) * 0.3;
    if (isLighter || isDarker) {
      const c = isLighter ? DIFF_LIGHTER : DIFF_DARKER;
      diff[i] = c[0];
      diff[i + 1] = c[1];
      diff[i + 2] = c[2];
    } else {
      diff[i] = diff[i + 1] = diff[i + 2] = faded;
    }
    diff[i + 3] = 255;

    // Heatmap: RGB distance 0..1 on a blue -> yellow -> red ramp, alpha = distance.
    const t = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / (255 * Math.sqrt(3)) / 0.5);
    const [hr, hg, hb] = heatColor(t);
    // Below ~2.5 % colour distance is JPEG / AA noise: leave the backdrop clean.
    const a = t < 0.05 ? 0 : 0.2 + 0.8 * t;
    heatmap[i] = faded * (1 - a) + hr * a;
    heatmap[i + 1] = faded * (1 - a) + hg * a;
    heatmap[i + 2] = faded * (1 - a) + hb * a;
    heatmap[i + 3] = 255;

    overlay[i] = (ref[i] + ours[i]) / 2;
    overlay[i + 1] = (ref[i + 1] + ours[i + 1]) / 2;
    overlay[i + 2] = (ref[i + 2] + ours[i + 2]) / 2;
    overlay[i + 3] = 255;
  }

  const cells: FidelityCell[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const k = row * grid.cols + col;
      const x0 = Math.round(col * cellW);
      const y0 = Math.round(row * cellH);
      cells.push({
        col,
        row,
        x: x0,
        y: y0,
        width: Math.round((col + 1) * cellW) - x0,
        height: Math.round((row + 1) * cellH) - y0,
        diffRatio: round(cellTotal[k] === 0 ? 0 : cellDiff[k] / cellTotal[k]),
      });
    }
  }

  const counted = total - ignoredCount;
  if (counted === 0) throw new Error('ignore regions cover the whole image');
  const diffRatio = diffPixels / counted;
  return {
    metrics: {
      width,
      height,
      threshold,
      fidelity: round(relevant === 0 ? 1 : 1 - diffPixels / relevant),
      pixelFidelity: round(1 - diffRatio),
      diffRatio: round(diffRatio),
      relevantPixels: relevant,
      ignoredPixels: ignoredCount,
      diffPixels,
      darkerPixels: darker,
      lighterPixels: lighter,
      rmse: round(Math.sqrt(sq / (counted * 3)), 3),
      inkRatio: round(ink / counted),
      cells,
    },
    images: {
      diff: { width, height, data: diff },
      heatmap: { width, height, data: heatmap },
      overlay: { width, height, data: overlay },
    },
  };
}

/** Cells sorted worst first (ties keep grid order). */
export function worstCells(cells: readonly FidelityCell[], n = 3): FidelityCell[] {
  return [...cells].sort((a, b) => b.diffRatio - a.diffRatio).slice(0, n);
}

function heatColor(t: number): [number, number, number] {
  // 0 -> blue (40,90,230), 0.5 -> yellow (250,210,0), 1 -> red (220,20,20)
  if (t <= 0.5) {
    const u = t / 0.5;
    return [40 + (250 - 40) * u, 90 + (210 - 90) * u, 230 - 230 * u];
  }
  const u = (t - 0.5) / 0.5;
  return [250 - 30 * u, 210 - 190 * u, 20 * u];
}

function round(v: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------
// Ratchet record
// ---------------------------------------------------------------------------

export interface FidelityRecord {
  /** Best fidelity recorded on this platform. Runs may not drop below `fidelity - epsilon`. */
  fidelity: number;
  /** Run-to-run noise allowance. */
  epsilon: number;
  /** RMSE at the time of the record (information only). */
  rmse: number;
  recordedAt: string;
}

export interface FidelityRecordFile {
  /** What was compared, for humans reading the JSON. */
  description: string;
  /** Keyed by `process.platform`: GPU paths and font rasterisation differ per OS. */
  platforms: Record<string, FidelityRecord>;
}

/**
 * Default noise allowance (0.05 % of pixels, ~200 px at 760x540). Measured on
 * macOS (Metal, Playwright Chromium 140): five consecutive runs produced
 * byte-identical PNGs, so any real change to the picture clears this.
 */
export const DEFAULT_EPSILON = 0.0005;

export type FidelityStatus = 'unrecorded' | 'regressed' | 'held' | 'improved';

export function judge(record: FidelityRecord | undefined, metrics: Pick<FidelityMetrics, 'fidelity'>): {
  status: FidelityStatus;
  message: string;
} {
  if (!record) {
    return {
      status: 'unrecorded',
      message: `no recorded fidelity for this platform; fidelity ${metrics.fidelity}. Record it with pnpm visual:record.`,
    };
  }
  const floor = round(record.fidelity - record.epsilon);
  if (metrics.fidelity < floor) {
    return {
      status: 'regressed',
      message: `fidelity ${metrics.fidelity} < recorded ${record.fidelity} - epsilon ${record.epsilon} (= ${floor}): the render moved away from the Arcentry reference.`,
    };
  }
  if (metrics.fidelity > record.fidelity + record.epsilon) {
    return {
      status: 'improved',
      message: `fidelity ${metrics.fidelity} beats recorded ${record.fidelity} by more than epsilon: run pnpm visual:record to tighten the gate.`,
    };
  }
  return { status: 'held', message: `fidelity ${metrics.fidelity} within epsilon of recorded ${record.fidelity}.` };
}

/**
 * Returns the record file with this platform's score raised to `metrics`
 * when that is better (or set, when missing). Never lowers a score or widens
 * epsilon: loosening the gate is a deliberate hand edit of the JSON.
 */
export function tighten(
  file: FidelityRecordFile,
  platform: string,
  metrics: Pick<FidelityMetrics, 'fidelity' | 'rmse'>,
  now: string,
  epsilon = DEFAULT_EPSILON,
): { file: FidelityRecordFile; changed: boolean } {
  const current = file.platforms[platform];
  if (current && metrics.fidelity <= current.fidelity) return { file, changed: false };
  const next: FidelityRecord = {
    fidelity: metrics.fidelity,
    epsilon: current?.epsilon ?? epsilon,
    rmse: metrics.rmse,
    recordedAt: now,
  };
  return { file: { ...file, platforms: { ...file.platforms, [platform]: next } }, changed: true };
}
