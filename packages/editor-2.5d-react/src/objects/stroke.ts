/**
 * Flat stroke geometry on the floor plane: a polyline turned into triangles
 * (ribbon quads, dashes, corner fills, arrow / dot tips). Pure 2D math on
 * (x, z) world pairs; the renderer adds the height. Used by connectors and by
 * dashed area outlines.
 *
 * Why triangles and not Line2? Line widths in Arcentry are world-sized (a
 * thick line gets thicker as you zoom in) and dashes must stay put while
 * the flow animation runs over them; fat Line2 widths are screen pixels.
 */

export type Vec2 = readonly [number, number];
export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type TipStyle = 'none' | 'arrow' | 'dot';

export interface StrokeOptions {
  /** Ribbon width in world units. */
  width: number;
  dash?: DashStyle;
  startTip?: TipStyle;
  endTip?: TipStyle;
}

export interface StrokeMesh {
  /** Triangle soup: 3 vertices per triangle, (x, z) per vertex. */
  positions: Float32Array;
  triangles: number;
}

/** Hard cap on dashes per stroke: a long dotted line widens its pattern rather than allocate millions of quads. */
export const MAX_DASHES = 4096;
/** Octagon segments for dot tips. */
const DOT_SEGMENTS = 12;

export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return total;
}

/** Point and unit direction at arc length `s` (clamped to the ends). Null for a degenerate polyline. */
export function pointAt(points: readonly Vec2[], s: number): { p: Vec2; dir: Vec2 } | null {
  let left = Math.max(0, s);
  let last: { p: Vec2; dir: Vec2 } | null = null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const dir: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    if (left <= len) return { p: [a[0] + dir[0] * left, a[1] + dir[1] * left], dir };
    left -= len;
    last = { p: b, dir };
  }
  return last;
}

/** Drop repeated points and interior points on a straight line (keeps the corners). */
export function simplifyPolyline(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < 1e-9 && Math.abs(prev[1] - p[1]) < 1e-9) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = prev!;
      const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
      const dot = (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]);
      if (Math.abs(cross) < 1e-9 && dot > 0) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** Sub-polyline between arc lengths `from` and `to`. */
export function slicePolyline(points: readonly Vec2[], from: number, to: number): Vec2[] {
  const out: Vec2[] = [];
  if (to <= from) return out;
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const s0 = walked;
    const s1 = walked + len;
    walked = s1;
    if (s1 < from || s0 > to) continue;
    const t0 = Math.max(0, (from - s0) / len);
    const t1 = Math.min(1, (to - s0) / len);
    const pa: Vec2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
    const pb: Vec2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    if (out.length === 0) out.push(pa);
    out.push(pb);
  }
  return out;
}

/** Arrow tip length for a ribbon `width`: visible on hairlines, proportional on thick lines. */
export function tipLength(width: number): number {
  return Math.max(0.28, width * 4);
}

/** Dash and gap lengths for a style and width, widened so a stroke never exceeds MAX_DASHES. */
export function dashPattern(dash: DashStyle, width: number, length: number): { on: number; off: number } | null {
  if (dash === 'solid') return null;
  let on = dash === 'dotted' ? width : Math.max(0.2, width * 4);
  let off = dash === 'dotted' ? Math.max(width * 1.5, 0.06) : Math.max(0.12, width * 2.5);
  const count = length / (on + off);
  if (count > MAX_DASHES) {
    const k = count / MAX_DASHES;
    on *= k;
    off *= k;
  }
  return { on, off };
}

class Soup {
  private data: number[] = [];
  tri(a: Vec2, b: Vec2, c: Vec2): void {
    this.data.push(a[0], a[1], b[0], b[1], c[0], c[1]);
  }
  quad(a: Vec2, b: Vec2, c: Vec2, d: Vec2): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  done(): StrokeMesh {
    return { positions: new Float32Array(this.data), triangles: this.data.length / 6 };
  }
}

function ribbon(soup: Soup, pts: readonly Vec2[], half: number): void {
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const nx = (-(b[1] - a[1]) / len) * half;
    const nz = ((b[0] - a[0]) / len) * half;
    soup.quad([a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]);
    // Corner fill: a square at each interior vertex, aligned with the incoming
    // segment, closes the notch on the outside of a bend (exact for 90 degrees).
    if (i < pts.length - 1) {
      const dx = ((b[0] - a[0]) / len) * half;
      const dz = ((b[1] - a[1]) / len) * half;
      soup.quad(
        [b[0] + nx - dx, b[1] + nz - dz],
        [b[0] + nx + dx, b[1] + nz + dz],
        [b[0] - nx + dx, b[1] - nz + dz],
        [b[0] - nx - dx, b[1] - nz - dz],
      );
    }
  }
}

function tip(soup: Soup, at: Vec2, dir: Vec2, style: TipStyle, width: number): void {
  if (style === 'arrow') {
    const len = tipLength(width);
    const half = len * 0.45;
    const base: Vec2 = [at[0] - dir[0] * len, at[1] - dir[1] * len];
    soup.tri(at, [base[0] - dir[1] * half, base[1] + dir[0] * half], [base[0] + dir[1] * half, base[1] - dir[0] * half]);
  } else if (style === 'dot') {
    const r = Math.max(0.09, width * 1.6);
    for (let k = 0; k < DOT_SEGMENTS; k += 1) {
      const a0 = (k / DOT_SEGMENTS) * Math.PI * 2;
      const a1 = ((k + 1) / DOT_SEGMENTS) * Math.PI * 2;
      soup.tri(at, [at[0] + Math.cos(a0) * r, at[1] + Math.sin(a0) * r], [at[0] + Math.cos(a1) * r, at[1] + Math.sin(a1) * r]);
    }
  }
}

/**
 * Triangles for a stroked polyline. Arrow tips shorten the ribbon so the
 * line does not poke through the arrowhead. Returns an empty mesh for fewer
 * than two distinct points, a non-finite coordinate or a non-positive width.
 */
export function strokePolyline(points: readonly Vec2[], opts: StrokeOptions): StrokeMesh {
  const soup = new Soup();
  const width = opts.width;
  if (!(Number.isFinite(width) && width > 0) || points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    return soup.done();
  }
  const pts = simplifyPolyline(points);
  const length = polylineLength(pts);
  if (pts.length < 2 || length === 0) return soup.done();
  const startTip = opts.startTip ?? 'none';
  const endTip = opts.endTip ?? 'none';
  // Leave a little ribbon under the arrowhead so there is no hairline gap; never more than the whole line.
  const startCut = startTip === 'arrow' ? Math.min(tipLength(width) * 0.8, length / 2) : 0;
  const endCut = endTip === 'arrow' ? Math.min(tipLength(width) * 0.8, length / 2) : 0;
  const pattern = dashPattern(opts.dash ?? 'solid', width, length);
  const half = width / 2;
  if (!pattern) {
    ribbon(soup, slicePolyline(pts, startCut, length - endCut), half);
  } else {
    for (let s = startCut; s < length - endCut; s += pattern.on + pattern.off) {
      ribbon(soup, slicePolyline(pts, s, Math.min(s + pattern.on, length - endCut)), half);
    }
  }
  const start = pointAt(pts, 0)!;
  const end = pointAt(pts, length)!;
  tip(soup, start.p, [-start.dir[0], -start.dir[1]], startTip, width);
  tip(soup, end.p, end.dir, endTip, width);
  return soup.done();
}

/** A closed rectangle outline as a polyline (for dashed area borders): centre (cx, cz), size w x h. */
export function rectPolyline(cx: number, cz: number, w: number, h: number): Vec2[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - h / 2;
  const z1 = cz + h / 2;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
}
