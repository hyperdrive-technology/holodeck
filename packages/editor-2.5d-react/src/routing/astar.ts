/**
 * Obstacle-avoiding pipe router: hand-written A* over states
 * (cell, heading, steps-since-last-bend) with a binary heap. No dependency.
 *
 * WHY NOT A LIBRARY (decision made, do not re-litigate): React Flow ships no
 * obstacle-avoiding router (its smoothstep edge is geometric only);
 * react-flow-smart-edge wraps pathfinding.js, unmaintained since ~2016;
 * libavoid-js is an LGPL WASM build aimed at free-form diagrams. Our grid is
 * native and we need domain costs generic libraries do not expose: bend
 * spacing that keeps `trimRun` valid, port headings, and pipe crossings.
 *
 * COST MODEL (see docs/routing.md): step 1; bend `bendPenalty` (4); each node
 * next to a vessel `clearancePenalty` (2); existing pipes, elbows, valves and
 * part footprints are hard blocks except at the exact start/end cells (so a
 * route can end on a pipe end or a port). Heuristic = Manhattan distance
 * (admissible and consistent: every step costs >= 1).
 *
 * STATE: heading matters (a bend costs extra) and so does the straight run
 * since the last bend (`minBendSpacing`), so the state is
 * (x, y, heading, run) with run capped at minBendSpacing.
 *
 * HEADINGS: `RouteEnd.heading` is the OUTWARD direction of the part port at
 * that end. At the start the first step must go that way; at the end the last
 * step must arrive moving the opposite way (into the port).
 *
 * DETERMINISM: heap order is (f, h, insertion sequence) and neighbours expand
 * in the fixed order n, e, s, w, so equal inputs give identical cells.
 *
 * Rust-comparison note for the repo owner: this is the same algorithm you
 * would write in Go with container/heap; JS has no stdlib heap, hence the
 * small one below.
 */

import { ELBOW_RADIUS } from '../../assets/process/pipe-math';
import { GRID_CELL_SIZE } from '../iso/grid';
import { cellKey, HEADINGS, HEADING_VECTOR, oppositeHeading, type GridPoint, type Heading } from './grid';
import type { Occupancy } from './occupancy';

export interface RouteEnd {
  cell: GridPoint;
  heading?: Heading;
}

export interface RouteOptions {
  /** Extra cost per bend. Default 4. */
  bendPenalty?: number;
  /** Extra cost per node inside a vessel's clearance ring. Default 2. */
  clearancePenalty?: number;
  /**
   * Minimum straight cells between two consecutive bends. Default
   * `defaultMinBendSpacing()`.
   */
  minBendSpacing?: number;
  /** Search box = bbox(from, to, obstacles) grown by this many cells. Default 6. */
  margin?: number;
  /** Safety valve: give up (null) after this many node expansions. Default 200_000. */
  maxExpansions?: number;
}

export interface RoutePath {
  /** Every cell from start to end inclusive, one grid step apart. */
  cells: GridPoint[];
  bends: number;
  cost: number;
  /** Nodes popped from the open set; exposed so tests can pin search effort. */
  expanded: number;
}

/**
 * Smallest whole-cell run between two bends that `trimRun` can trim.
 *
 * Each bend eats ELBOW_RADIUS (0.58) off the adjacent run's end, so a run
 * between two bends needs a + b = 2 * 0.58 = 1.16 world units, else `trimRun`'s
 * `a + b >= len` guard leaves it untrimmed (pipe-math.ts comment: keep elbows
 * >= 1.2 cells apart). Strictly more than 1.16 on an integer grid is 2 cells.
 */
export function defaultMinBendSpacing(cell = GRID_CELL_SIZE): number {
  return Math.max(1, Math.ceil((2 * ELBOW_RADIUS) / cell - 1e-9));
}

const DIR_NONE = 4;

interface HeapItem {
  f: number;
  h: number;
  seq: number;
  g: number;
  key: number;
  x: number;
  y: number;
  dir: number;
  run: number;
}

/** Minimal binary min-heap ordered by (f, h, seq). */
class Heap {
  private items: HeapItem[] = [];
  get size(): number {
    return this.items.length;
  }
  private less(a: HeapItem, b: HeapItem): boolean {
    return a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.seq < b.seq;
  }
  push(item: HeapItem): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): HeapItem | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

export function routePipe(from: RouteEnd, to: RouteEnd, occ: Occupancy, opts: RouteOptions = {}): RoutePath | null {
  const bendPenalty = opts.bendPenalty ?? 4;
  const clearancePenalty = opts.clearancePenalty ?? 2;
  const spacing = Math.max(1, opts.minBendSpacing ?? defaultMinBendSpacing());
  const margin = opts.margin ?? 6;
  const maxExpansions = opts.maxExpansions ?? 200_000;

  const s = from.cell;
  const t = to.cell;
  if (s.x === t.x && s.y === t.y) {
    return { cells: [{ x: s.x, y: s.y }], bends: 0, cost: 0, expanded: 0 };
  }

  const bb = occ.bounds;
  const minX = Math.min(s.x, t.x, bb?.minX ?? Infinity) - margin;
  const maxX = Math.max(s.x, t.x, bb?.maxX ?? -Infinity) + margin;
  const minY = Math.min(s.y, t.y, bb?.minY ?? Infinity) - margin;
  const maxY = Math.max(s.y, t.y, bb?.maxY ?? -Infinity) + margin;

  const startCellKey = cellKey(s.x, s.y);
  const endCellKey = cellKey(t.x, t.y);
  const arrive = to.heading ? HEADINGS.indexOf(oppositeHeading(to.heading)) : -1;
  const startDirs = from.heading ? [HEADINGS.indexOf(from.heading)] : [0, 1, 2, 3];

  // state key = cell key * 5 * (spacing + 1) + dir * (spacing + 1) + run
  const stateKey = (ck: number, dir: number, run: number) => (ck * 5 + dir) * (spacing + 1) + run;
  const best = new Map<number, number>();
  const parent = new Map<number, number>();
  const cellOf = new Map<number, GridPoint>(); // state key -> cell, only for path rebuild
  const heap = new Heap();
  let seq = 0;
  const hOf = (x: number, y: number) => Math.abs(x - t.x) + Math.abs(y - t.y);

  const startState = stateKey(startCellKey, DIR_NONE, spacing);
  best.set(startState, 0);
  cellOf.set(startState, { x: s.x, y: s.y });
  heap.push({ f: hOf(s.x, s.y), h: hOf(s.x, s.y), seq: seq++, g: 0, key: startState, x: s.x, y: s.y, dir: DIR_NONE, run: spacing });

  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (cur.g > (best.get(cur.key) ?? Infinity)) continue; // stale entry
    const atEnd = cur.x === t.x && cur.y === t.y;
    if (atEnd && (arrive < 0 || cur.dir === arrive)) {
      return rebuild(cur, parent, cellOf, expanded);
    }
    expanded += 1;
    if (expanded > maxExpansions) return null;

    const dirs = cur.dir === DIR_NONE ? startDirs : [0, 1, 2, 3];
    for (const nd of dirs) {
      if (cur.dir !== DIR_NONE) {
        if (nd === (cur.dir + 2) % 4) continue; // no U-turns
        if (nd !== cur.dir && cur.run < spacing) continue; // too soon for another bend
      }
      const v = HEADING_VECTOR[HEADINGS[nd]!];
      const nx = cur.x + v.x;
      const ny = cur.y + v.y;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const nk = cellKey(nx, ny);
      if (nk !== endCellKey && nk !== startCellKey && occ.blocked.has(nk)) continue;
      const bend = cur.dir !== DIR_NONE && nd !== cur.dir;
      const g = cur.g + 1 + (bend ? bendPenalty : 0) + (occ.near.has(nk) ? clearancePenalty : 0);
      // The first run has no bend behind it, so it may turn at any time: keep it "long enough".
      const run = bend ? 1 : cur.dir === DIR_NONE ? spacing : Math.min(cur.run + 1, spacing);
      const key = stateKey(nk, nd, run);
      if (g >= (best.get(key) ?? Infinity)) continue;
      best.set(key, g);
      parent.set(key, cur.key);
      cellOf.set(key, { x: nx, y: ny });
      const h = hOf(nx, ny);
      heap.push({ f: g + h, h, seq: seq++, g, key, x: nx, y: ny, dir: nd, run });
    }
  }
  return null;
}

function rebuild(
  goal: HeapItem,
  parent: Map<number, number>,
  cellOf: Map<number, GridPoint>,
  expanded: number,
): RoutePath | null {
  const cells: GridPoint[] = [];
  let key: number | undefined = goal.key;
  while (key !== undefined) {
    cells.push(cellOf.get(key)!);
    key = parent.get(key);
  }
  cells.reverse();
  // A path that re-enters one of its own cells would draw a pipe over itself.
  // The state space allows it only in tight heading-constrained spots; treat as
  // "no route" so the caller falls back rather than commit a self-overlap.
  const seen = new Set<number>();
  for (const c of cells) {
    const k = cellKey(c.x, c.y);
    if (seen.has(k)) return null;
    seen.add(k);
  }
  let bends = 0;
  for (let i = 2; i < cells.length; i += 1) {
    const a = cells[i - 2]!;
    const b = cells[i - 1]!;
    const c = cells[i]!;
    if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) bends += 1;
  }
  return { cells, bends, cost: goal.g, expanded };
}
