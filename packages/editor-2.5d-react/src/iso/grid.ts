/**
 * Grid <-> world mapping. Lives apart from scene.ts so part components
 * (reached from the built-in registry that scene.ts imports) can use it
 * without a runtime import cycle.
 *
 * World X = x * gridCellSize + cell/2
 * World Z = y * gridCellSize + cell/2   (grid Y maps to Three.js Z)
 */

export const GRID_CELL_SIZE = 1;

export function gridToWorld(x: number, y: number, cell = GRID_CELL_SIZE): [number, number, number] {
  const half = cell / 2;
  return [x * cell + half, 0, y * cell + half];
}

export function worldToGrid(wx: number, wz: number, cell = GRID_CELL_SIZE): { x: number; y: number } {
  return {
    x: (wx - cell / 2) / cell,
    y: (wz - cell / 2) / cell,
  };
}
