/**
 * Turn a routed cell path into scene placements. Pure.
 *
 * `collapsePath` merges collinear cells into straight runs (pipes) with a
 * bend at every direction change (elbows, yawed by `elbowYawForDirs`).
 * `pathToPlacements` then allocates ids and emits `pipe` + `elbow` placements.
 * Every elbow sits exactly where two pipe ends meet, which is what the
 * renderer's `bendKeys` / `trimRun` rely on.
 */

import { elbowYawForDirs } from '../../assets/process/pipe-math';
import type { IsoPlacement } from '../iso/scene';
import type { GridPoint } from './grid';

export interface PipeSegment {
  x: number;
  y: number;
  toX: number;
  toY: number;
}

export interface Bend extends GridPoint {
  rotation: number;
}

export interface CollapsedPath {
  pipes: PipeSegment[];
  bends: Bend[];
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Collapse a polyline of axis-aligned steps (unit or longer) into runs + bends. */
export function collapsePath(points: readonly GridPoint[]): CollapsedPath {
  // Drop repeated points, then keep only the vertices where the direction changes.
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  if (pts.length < 2) return { pipes: [], bends: [] };
  const vertices: GridPoint[] = [pts[0]!];
  const bends: Bend[] = [];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    if (sign(b.x - a.x) !== sign(c.x - b.x) || sign(b.y - a.y) !== sign(c.y - b.y)) {
      vertices.push(b);
      bends.push({ x: b.x, y: b.y, rotation: elbowYawForDirs(a.x - b.x, a.y - b.y, c.x - b.x, c.y - b.y) });
    }
  }
  vertices.push(pts[pts.length - 1]!);
  const pipes: PipeSegment[] = [];
  for (let i = 1; i < vertices.length; i += 1) {
    const a = vertices[i - 1]!;
    const b = vertices[i]!;
    pipes.push({ x: a.x, y: a.y, toX: b.x, toY: b.y });
  }
  return { pipes, bends };
}

export type NextId = (prefix: string, objects: readonly IsoPlacement[]) => string;

/** The editor's pipe default (matches the palette's `defaults.band`). */
export const DEFAULT_PIPE_BAND = '#e74c3c';

export function pathToPlacements(
  points: readonly GridPoint[],
  existing: readonly IsoPlacement[],
  nextId: NextId,
  band = DEFAULT_PIPE_BAND,
): IsoPlacement[] {
  const { pipes, bends } = collapsePath(points);
  const out: IsoPlacement[] = [];
  const alloc = (prefix: string) => nextId(prefix, [...existing, ...out]);
  for (const p of pipes) {
    out.push({ id: alloc('pipe'), object: 'pipe', ...p, band });
  }
  for (const b of bends) {
    out.push({ id: alloc('elbow'), object: 'elbow', x: b.x, y: b.y, rotation: b.rotation });
  }
  return out;
}
