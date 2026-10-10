import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { elbowYawForDirs } from '../../assets/process/pipe-math';
import { sameCell } from './snap';

export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Axis-aligned pipe run. Diagonal clicks become an L (horizontal first)
 * plus an elbow at the corner — process pipes stay on the grid axes.
 */
export function manhattanRoute(from: GridPoint, to: GridPoint): {
  pipes: Array<{ x: number; y: number; toX: number; toY: number }>;
  elbow: GridPoint | null;
} {
  if (sameCell(from, to)) {
    return { pipes: [], elbow: null };
  }
  if (from.x === to.x || from.y === to.y) {
    return { pipes: [{ x: from.x, y: from.y, toX: to.x, toY: to.y }], elbow: null };
  }
  const corner = { x: to.x, y: from.y };
  return {
    pipes: [
      { x: from.x, y: from.y, toX: corner.x, toY: corner.y },
      { x: corner.x, y: corner.y, toX: to.x, toY: to.y },
    ],
    elbow: corner,
  };
}

export function routeToPlacements(
  from: GridPoint,
  to: GridPoint,
  ids: { pipeA: string; pipeB: string; elbow: string },
  band = '#e74c3c',
): IsoPlacement[] {
  const { pipes, elbow } = manhattanRoute(from, to);
  const out: IsoPlacement[] = [];
  if (pipes[0]) {
    out.push({ id: ids.pipeA, object: 'pipe', ...pipes[0], band });
  }
  if (pipes[1]) {
    out.push({ id: ids.pipeB, object: 'pipe', ...pipes[1], band });
  }
  if (elbow) {
    const start = { x: pipes[0]?.x ?? elbow.x, y: pipes[0]?.y ?? elbow.y };
    const end = { x: pipes[1]?.toX ?? elbow.x, y: pipes[1]?.toY ?? elbow.y };
    out.push({
      id: ids.elbow,
      object: 'elbow',
      x: elbow.x,
      y: elbow.y,
      rotation: elbowYawForDirs(start.x - elbow.x, start.y - elbow.y, end.x - elbow.x, end.y - elbow.y),
    });
  }
  return out;
}

/**
 * Grid footprint of a part, from its registry definition. Unknown parts get
 * 1x1 so a scene that names an uninstalled part can still be selected and deleted.
 */
export function footprint(registry: ContributionRegistry, partId: string): { w: number; h: number } {
  return registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId)?.footprint ?? { w: 1, h: 1 };
}
