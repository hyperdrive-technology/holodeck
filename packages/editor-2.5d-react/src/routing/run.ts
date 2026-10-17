/**
 * Find the connected pipe/elbow "run" around a placement. Pure.
 *
 * A run is a chain of pipes joined end to end (elbows sit on the joints). The
 * walk stops at a dead end, at a junction (3+ pipe ends on one node: a tee
 * belongs to more than one run), or at an INLINE part (valve, pump, cap)
 * sitting on a joint, because those are the endpoints a reroute must keep
 * attached. Before holodeck#10 the walk only looked at pipe adjacency, so two
 * pipes meeting at an inline valve were one run and a reroute replaced both
 * with a route around the valve, leaving it disconnected.
 *
 * Inline = a single-node part: rotated footprint at most 1x1 (the same line
 * occupancy.ts draws between 1x1 parts and "vessels"). "On a joint" is exact
 * position equality with the pipe end; pipes and parts share integer nodes.
 * A vessel centred on a joint is not a connection (pipes attach to vessels at
 * edge ports, never the centre): it is an obstacle dropped across the run, and
 * the reroute should go around it. Floor annotations (`area`, `label`) never
 * stop the walk.
 *
 * A part lying strictly inside one pipe's span (tests/scene.json draws its
 * valves on top of one long pipe) is not a run end. Geometry alone can't tell
 * it from an obstacle dropped across the pipe, which reroute is meant to avoid
 * (editor-state.test "replaces the selected run with a route around a new
 * obstacle"), so such a part carries an explicit `onPipe` attachment
 * (routing/inline.ts, holodeck#22) and the reroute re-seats it on the new
 * route instead of leaving it behind.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import type { RouteEnd } from './astar';
import { headingOf } from './elbows';
import type { GridPoint, Heading } from './grid';
import { isFloorPart, rotatedFootprint } from './occupancy';

export interface PipeRun {
  /** Pipes and interior elbows, in no particular order. */
  ids: string[];
  /** The two run ends. `start` is the end of the first pipe's `x,y` side. */
  start: GridPoint;
  end: GridPoint;
  /** Outward directions into the original run at inline joints, if axis-aligned. */
  startHeading?: Heading;
  endHeading?: Heading;
}

const nodeKey = (x: number, y: number) => `${x},${y}`;

const isPipe = (o: IsoPlacement) => o.object === 'pipe' && typeof o.toX === 'number' && typeof o.toY === 'number';

/** Single-node parts a run must stop at and stay attached to (not pipes, elbows, floor annotations or vessels). */
export function isInlinePart(o: IsoPlacement, registry: ContributionRegistry): boolean {
  if (o.object === 'pipe' || o.object === 'elbow') return false;
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object);
  if (isFloorPart(o.object, def)) return false;
  const { w, h } = rotatedFootprint(def, o.rotation, o);
  return w <= 1 && h <= 1;
}

export function findRun(
  objects: readonly IsoPlacement[],
  selectedId: string,
  registry: ContributionRegistry,
): PipeRun | null {
  const pipes = objects.filter(isPipe);
  const elbows = objects.filter((o) => o.object === 'elbow');
  const inlineNodes = new Set(objects.filter((o) => isInlinePart(o, registry)).map((o) => nodeKey(o.x, o.y)));
  const selected = objects.find((o) => o.id === selectedId);
  if (!selected) return null;

  const endsAt = new Map<string, IsoPlacement[]>();
  for (const p of pipes) {
    for (const k of [nodeKey(p.x, p.y), nodeKey(p.toX!, p.toY!)]) {
      endsAt.set(k, [...(endsAt.get(k) ?? []), p]);
    }
  }

  let seed: IsoPlacement | undefined;
  if (isPipe(selected)) seed = selected;
  else if (selected.object === 'elbow') seed = endsAt.get(nodeKey(selected.x, selected.y))?.[0];
  if (!seed) return null;

  const ids = new Set<string>([seed.id]);
  /** Walk away from `node` along the chain; retain the connection at the stop. */
  const walk = (first: IsoPlacement, startNode: string): RouteEnd => {
    let current = first;
    let node = startNode;
    for (;;) {
      if (inlineNodes.has(node)) break; // a valve / pump / cap on the joint ends the run here
      const here = endsAt.get(node) ?? [];
      const others = here.filter((p) => p.id !== current.id);
      const next = others[0];
      if (here.length !== 2 || others.length !== 1 || !next || ids.has(next.id)) break;
      ids.add(next.id);
      for (const e of elbows) if (nodeKey(e.x, e.y) === node) ids.add(e.id);
      current = next;
      node = nodeKey(next.x, next.y) === node ? nodeKey(next.toX!, next.toY!) : nodeKey(next.x, next.y);
    }
    const [x, y] = node.split(',').map(Number);
    const cell = { x: x!, y: y! };
    if (!inlineNodes.has(node)) return { cell };
    // Built-in valves have no ports, and extensions need not share their
    // local barrel axis. Preserve the connected side using the terminal
    // pipe (not the seed or its storage direction). This also handles yawed
    // valves and caps without guessing from rotation. Heading is OUTWARD
    // from the part into this run; A* arrives moving its opposite.
    const other = nodeKey(current.x, current.y) === node
      ? { x: current.toX!, y: current.toY! }
      : { x: current.x, y: current.y };
    const heading = headingOf(other.x - cell.x, other.y - cell.y);
    return heading ? { cell, heading } : { cell };
  };

  const start = walk(seed, nodeKey(seed.x, seed.y));
  const end = walk(seed, nodeKey(seed.toX!, seed.toY!));
  return { ids: [...ids], start: start.cell, end: end.cell, startHeading: start.heading, endHeading: end.heading };
}
