/**
 * Find the connected pipe/elbow "run" around a placement. Pure.
 *
 * A run is a chain of pipes joined end to end (elbows sit on the joints). The
 * walk stops at a dead end, at a junction (3+ pipe ends on one node: a tee
 * belongs to more than one run), or at any non-pipe part (valve, tank, cap),
 * because those are the endpoints a reroute must keep attached.
 */

import type { IsoPlacement } from '../iso/scene';
import type { GridPoint } from './grid';

export interface PipeRun {
  /** Pipes and interior elbows, in no particular order. */
  ids: string[];
  /** The two run ends. `start` is the end of the first pipe's `x,y` side. */
  start: GridPoint;
  end: GridPoint;
}

const nodeKey = (x: number, y: number) => `${x},${y}`;

const isPipe = (o: IsoPlacement) => o.object === 'pipe' && typeof o.toX === 'number' && typeof o.toY === 'number';

export function findRun(objects: readonly IsoPlacement[], selectedId: string): PipeRun | null {
  const pipes = objects.filter(isPipe);
  const elbows = objects.filter((o) => o.object === 'elbow');
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
  /** Walk away from `node` along the chain; returns the node where the run stops. */
  const walk = (first: IsoPlacement, startNode: string): GridPoint => {
    let current = first;
    let node = startNode;
    for (;;) {
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
    return { x: x!, y: y! };
  };

  const start = walk(seed, nodeKey(seed.x, seed.y));
  const end = walk(seed, nodeKey(seed.toX!, seed.toY!));
  return { ids: [...ids], start, end };
}
