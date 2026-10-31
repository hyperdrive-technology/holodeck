import { EdgesGeometry, Vector3, type BufferGeometry, type Matrix4 } from 'three';

/**
 * Line-termination check (Des 2026-10-30: "vertical lines always terminate on
 * a horizontal ring"). Works on raw LineSegments positions (x,y,z pairs), so
 * it covers both Tank's LineSets (tank-lines.ts) and mesh creases
 * (`edgeLineSegments`, the same EdgesGeometry + threshold the Edges
 * component draws).
 *
 * A "free end" is an endpoint of a non-horizontal segment that no other
 * non-horizontal segment shares (polyline interiors and apexes where meridians
 * meet are shared). Each free end must lie on a horizontal segment at its
 * height (within `tol`, which absorbs a circle's chord sag), or be accepted
 * by `allow` (window cut edges, the floor boundary).
 */
export type DanglingEnd = { x: number; y: number; z: number };

export function danglingLineEnds(
  positions: Float32Array,
  { tol = 0.004, allow }: { tol?: number; allow?: (p: DanglingEnd) => boolean } = {},
): DanglingEnd[] {
  const horizontal: number[] = [];
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const degree = new Map<string, { n: number; p: DanglingEnd }>();
  for (let i = 0; i + 5 < positions.length; i += 6) {
    const [ax, ay, az, bx, by, bz] = positions.subarray(i, i + 6);
    if (Math.hypot(bx - ax, by - ay, bz - az) < 1e-9) continue;
    if (Math.abs(by - ay) < 1e-5) {
      horizontal.push(ax, ay, az, bx, by, bz);
      continue;
    }
    for (const [x, y, z] of [
      [ax, ay, az],
      [bx, by, bz],
    ]) {
      const k = key(x, y, z);
      const d = degree.get(k);
      if (d) d.n += 1;
      else degree.set(k, { n: 1, p: { x, y, z } });
    }
  }
  const onHorizontal = ({ x, y, z }: DanglingEnd): boolean => {
    for (let i = 0; i < horizontal.length; i += 6) {
      const [ax, ay, az, bx, , bz] = horizontal.slice(i, i + 6);
      if (Math.abs(ay - y) > 1e-4) continue;
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) <= tol) return true;
    }
    return false;
  };
  const out: DanglingEnd[] = [];
  for (const { n, p } of degree.values()) {
    if (n === 1 && !onHorizontal(p) && !allow?.(p)) out.push(p);
  }
  return out;
}

/** The segments `Edges` would draw for `geometry` at `thresholdDeg`, optionally transformed by `matrix`. */
export function edgeLineSegments(geometry: BufferGeometry, thresholdDeg: number, matrix?: Matrix4): Float32Array {
  const edges = new EdgesGeometry(geometry, thresholdDeg);
  const src = edges.getAttribute('position');
  const out = new Float32Array(src.count * 3);
  const v = new Vector3();
  for (let i = 0; i < src.count; i++) {
    v.fromBufferAttribute(src, i);
    if (matrix) v.applyMatrix4(matrix);
    out.set([v.x, v.y, v.z], i * 3);
  }
  edges.dispose();
  return out;
}
