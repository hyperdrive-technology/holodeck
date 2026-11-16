/**
 * Pure helpers behind `HolodeckEditor2D`'s `onNodesMoved` / `snapGrid` props.
 *
 * Kept out of the component so the position bookkeeping (which is where the
 * "snap back after a drag" and "drag triggers a refit" bugs live) is unit
 * testable without driving d3-drag in jsdom.
 */

import type { SceneNode } from '@holodeck/sdk';
import type { HolodeckNodeMove, SnapGridProp } from '../types';

export type XY = { x: number; y: number };

/**
 * A position the user produced locally (drag or arrow-key nudge) that the host
 * has not (yet) written back into `scene`.
 *
 * `base` is the position the scene/layout gave the node when the move started;
 * `position` is where the user left it.
 */
export interface PositionOverride {
  base: XY;
  position: XY;
}

export function samePosition(a: XY, b: XY): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Merge locally-moved positions over the positions computed from `scene`.
 *
 * Per node, with an override present:
 * - incoming == override.base     → the host has not reacted (uncontrolled use, or an
 *                                   unrelated scene update such as live values):
 *                                   keep the user's position, keep the override.
 * - incoming == override.position → the host persisted the move (controlled use):
 *                                   use it, drop the override.
 * - anything else                 → the host set its own position (undo, reset,
 *                                   re-layout): the host wins, drop the override.
 *
 * Overrides for nodes that no longer exist are dropped. Returns the next nodes and
 * the surviving overrides; `nodes` is returned unchanged (same array) when no
 * override applies, so memoised consumers do not churn.
 */
export function applyPositionOverrides<N extends { id: string; position: XY }>(
  nodes: readonly N[],
  overrides: ReadonlyMap<string, PositionOverride>,
): { nodes: N[]; overrides: Map<string, PositionOverride> } {
  const kept = new Map<string, PositionOverride>();
  if (overrides.size === 0) return { nodes: nodes as N[], overrides: kept };
  let changed = false;
  const next = nodes.map((node) => {
    const override = overrides.get(node.id);
    if (!override || !samePosition(node.position, override.base)) return node;
    kept.set(node.id, override);
    if (samePosition(node.position, override.position)) return node;
    changed = true;
    return { ...node, position: { ...override.position } };
  });
  return { nodes: changed ? next : (nodes as N[]), overrides: kept };
}

/**
 * Record moves into the override map. A node moved twice keeps its original
 * `base` (the scene position), so a host that never persists still reconciles.
 * Returns a new map.
 */
export function recordOverrides(
  overrides: ReadonlyMap<string, PositionOverride>,
  moves: ReadonlyArray<{ nodeId: string; position: XY; base: XY }>,
): Map<string, PositionOverride> {
  const next = new Map(overrides);
  for (const move of moves) {
    const base = overrides.get(move.nodeId)?.base ?? move.base;
    next.set(move.nodeId, { base: { ...base }, position: { ...move.position } });
  }
  return next;
}

/**
 * Build the `onNodesMoved` payload from `{ id, position }` pairs and the
 * positions the nodes had before the move. Nodes that did not actually move
 * (a click that crossed the drag threshold and came back, a nudge blocked by an
 * extent) are left out, so an empty array means "nothing to report".
 */
export function buildMoves(
  moved: ReadonlyArray<{ id: string; position: XY; data?: unknown }>,
  previous: ReadonlyMap<string, XY>,
): HolodeckNodeMove[] {
  const moves: HolodeckNodeMove[] = [];
  for (const node of moved) {
    const before = previous.get(node.id);
    if (!before || samePosition(before, node.position)) continue;
    const sceneNode = (node.data as { sceneNode?: SceneNode } | undefined)?.sceneNode;
    if (!sceneNode) continue;
    moves.push({
      nodeId: node.id,
      position: { x: node.position.x, y: node.position.y },
      previousPosition: { x: before.x, y: before.y },
      sceneNode,
    });
  }
  return moves;
}

/** Normalise the `snapGrid` prop to React Flow's `[x, y]` tuple, or undefined when off. */
export function normalizeSnapGrid(snapGrid: SnapGridProp | undefined): [number, number] | undefined {
  if (snapGrid === undefined || snapGrid === false) return undefined;
  const [x, y] = typeof snapGrid === 'number' ? [snapGrid, snapGrid] : snapGrid;
  if (!(x > 0) || !(y > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [x, y];
}

/**
 * Identity of the graph for "fit the view" purposes: which nodes and edges exist
 * (plus the layout mode), but not where they are. A drag, a nudge, a host
 * writing positions back, or a live-value update leave it unchanged, so none of
 * them refit the view; opening a different graph or adding/removing an element
 * changes it.
 */
export function graphStructureKey(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ id: string }>,
  layout: string,
): string {
  // JSON keeps ids containing separators unambiguous.
  return JSON.stringify([layout, nodes.map((n) => n.id), edges.map((e) => e.id)]);
}
