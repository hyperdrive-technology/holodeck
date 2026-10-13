import { GRID_CELL_SIZE, worldToGrid } from '../iso/scene';

/** Half-cell snap — placement and pipe vertices share this step. */
export function snapHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function snapPoint(x: number, y: number): { x: number; y: number } {
  return { x: snapHalf(x), y: snapHalf(y) };
}

/** Floor hit in world XZ → snapped grid cell (integer = cell center). */
export function pointerToGrid(wx: number, wz: number, cell = GRID_CELL_SIZE): { x: number; y: number } {
  const g = worldToGrid(wx, wz, cell);
  return snapPoint(g.x, g.y);
}

export function sameCell(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}
