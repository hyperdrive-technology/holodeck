import type { SceneNode } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import {
  applyPositionOverrides,
  buildMoves,
  graphStructureKey,
  normalizeSnapGrid,
  recordOverrides,
  type PositionOverride,
} from './nodeMoves';

const node = (id: string, x: number, y: number) => ({ id, position: { x, y } });
const overrides = (entries: Array<[string, PositionOverride]>) => new Map(entries);

describe('applyPositionOverrides', () => {
  it('no overrides: returns the same array', () => {
    const nodes = [node('a', 0, 0)];
    const out = applyPositionOverrides(nodes, new Map());
    expect(out.nodes).toBe(nodes);
    expect(out.overrides.size).toBe(0);
  });

  it('host unchanged (incoming == base): keeps the user position and the override', () => {
    const o = overrides([['a', { base: { x: 0, y: 0 }, position: { x: 30, y: 50 } }]]);
    const out = applyPositionOverrides([node('a', 0, 0), node('b', 9, 9)], o);
    expect(out.nodes[0]!.position).toEqual({ x: 30, y: 50 });
    expect(out.nodes[1]!.position).toEqual({ x: 9, y: 9 });
    expect(out.overrides.get('a')).toEqual(o.get('a'));
  });

  it('host persisted (incoming == position): drops the override', () => {
    const nodes = [node('a', 30, 50)];
    const out = applyPositionOverrides(nodes, overrides([['a', { base: { x: 0, y: 0 }, position: { x: 30, y: 50 } }]]));
    expect(out.nodes).toBe(nodes);
    expect(out.overrides.size).toBe(0);
  });

  it('host set something else: host wins, override dropped', () => {
    const out = applyPositionOverrides(
      [node('a', -5, -5)],
      overrides([['a', { base: { x: 0, y: 0 }, position: { x: 30, y: 50 } }]]),
    );
    expect(out.nodes[0]!.position).toEqual({ x: -5, y: -5 });
    expect(out.overrides.size).toBe(0);
  });

  it('base == position (moved back to start) keeps the node and the override', () => {
    const nodes = [node('a', 0, 0)];
    const out = applyPositionOverrides(nodes, overrides([['a', { base: { x: 0, y: 0 }, position: { x: 0, y: 0 } }]]));
    expect(out.nodes).toBe(nodes);
    expect(out.overrides.size).toBe(1);
  });

  it('drops overrides for nodes that no longer exist', () => {
    const out = applyPositionOverrides(
      [node('a', 0, 0)],
      overrides([['gone', { base: { x: 0, y: 0 }, position: { x: 1, y: 1 } }]]),
    );
    expect(out.overrides.size).toBe(0);
  });

  it('does not mutate the input nodes', () => {
    const nodes = [node('a', 0, 0)];
    applyPositionOverrides(nodes, overrides([['a', { base: { x: 0, y: 0 }, position: { x: 3, y: 4 } }]]));
    expect(nodes[0]!.position).toEqual({ x: 0, y: 0 });
  });
});

describe('recordOverrides', () => {
  it('adds new overrides and keeps the original base on a second move', () => {
    const first = recordOverrides(new Map(), [{ nodeId: 'a', position: { x: 10, y: 0 }, base: { x: 0, y: 0 } }]);
    const second = recordOverrides(first, [{ nodeId: 'a', position: { x: 20, y: 0 }, base: { x: 10, y: 0 } }]);
    expect(second.get('a')).toEqual({ base: { x: 0, y: 0 }, position: { x: 20, y: 0 } });
    expect(first.get('a')).toEqual({ base: { x: 0, y: 0 }, position: { x: 10, y: 0 } }); // new map each time
  });
});

describe('buildMoves', () => {
  const sn = { id: 'a' } as SceneNode;
  it('reports moved nodes with their previous position and scene node', () => {
    expect(
      buildMoves([{ id: 'a', position: { x: 5, y: 6 }, data: { sceneNode: sn } }], new Map([['a', { x: 0, y: 0 }]])),
    ).toEqual([{ nodeId: 'a', position: { x: 5, y: 6 }, previousPosition: { x: 0, y: 0 }, sceneNode: sn }]);
  });
  it('skips unmoved nodes, nodes without a start position and nodes without a scene node', () => {
    expect(
      buildMoves(
        [
          { id: 'a', position: { x: 0, y: 0 }, data: { sceneNode: sn } },
          { id: 'b', position: { x: 1, y: 1 }, data: { sceneNode: sn } },
          { id: 'c', position: { x: 1, y: 1 }, data: {} },
        ],
        new Map([
          ['a', { x: 0, y: 0 }],
          ['c', { x: 0, y: 0 }],
        ]),
      ),
    ).toEqual([]);
  });
});

describe('normalizeSnapGrid', () => {
  it.each([
    [undefined, undefined],
    [false, undefined],
    [20, [20, 20]],
    [[10, 25] as const, [10, 25]],
    [0, undefined],
    [-4, undefined],
    [Number.NaN, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [[10, 0] as const, undefined],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeSnapGrid(input as never)).toEqual(expected);
  });
});

describe('graphStructureKey', () => {
  it('ignores positions, changes with ids and layout', () => {
    const k = graphStructureKey([node('a', 0, 0)], [{ id: 'e' }], 'manual');
    expect(graphStructureKey([node('a', 99, 99)], [{ id: 'e' }], 'manual')).toBe(k);
    expect(graphStructureKey([node('a', 0, 0), node('b', 0, 0)], [{ id: 'e' }], 'manual')).not.toBe(k);
    expect(graphStructureKey([node('a', 0, 0)], [], 'manual')).not.toBe(k);
    expect(graphStructureKey([node('a', 0, 0)], [{ id: 'e' }], 'dagre')).not.toBe(k);
  });
  it('is unambiguous for ids containing separators', () => {
    expect(graphStructureKey([{ id: 'a,b' }], [], 'm')).not.toBe(graphStructureKey([{ id: 'a' }, { id: 'b' }], [], 'm'));
  });
});
