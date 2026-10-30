/**
 * The built-in tank's ports follow its effective radius (GPT review of #228,
 * second round). The footprint grew with the radius but the ports stayed at
 * +-1, so above radius 1.5 the first step out of a port was inside the
 * blocked box and routePipe returned null.
 */
import { describe, expect, it } from 'vitest';
import { getDefaultIsoRegistry } from '../registry/default';
import { parseSceneFile } from '../iso/scene';
import { buildOccupancy } from './occupancy';
import { resolveRouteEnd } from './ports';
import { routePipe } from './astar';

const registry = getDefaultIsoRegistry();
const sceneWith = (params: Record<string, unknown>) =>
  parseSceneFile({ id: 's', name: 's', gridCellSize: 1, objects: [{ id: 'tank-1', object: 'tank', x: 0, y: 0, params }] });

describe('tank ports follow the radius', () => {
  it.each([1, 1.6, 2, 3])('radius %s: routes out of both side ports', (radius) => {
    const scene = sceneWith({ radius });
    const occ = buildOccupancy(scene, registry);
    for (const [click, far] of [[{ x: 1, y: 0 }, { x: 8, y: 0 }], [{ x: -1, y: 0 }, { x: -8, y: 0 }]] as const) {
      const from = resolveRouteEnd(scene, registry, click);
      expect(from.partId).toBe('tank-1');
      expect(routePipe(from, { cell: far }, occ), `radius ${radius} from ${from.port}`).not.toBeNull();
    }
  });

  it('a plain tank keeps its ports at +-1', () => {
    const scene = sceneWith({});
    expect(resolveRouteEnd(scene, registry, { x: 1, y: 0 })).toMatchObject({ port: 'east', cell: { x: 1, y: 0 } });
    expect(resolveRouteEnd(scene, registry, { x: -1, y: 0 })).toMatchObject({ port: 'west', cell: { x: -1, y: 0 } });
  });
});

describe('placementPorts', () => {
  it('a plain tank resolves the same ports as its static definition', async () => {
    const { placementPorts } = await import('../registry/params');
    const def = registry.get('holodeck.iso.part', 'tank') as import('../registry/types').IsoPartDefinition;
    expect(placementPorts(def, sceneWith({}).objects[0]!)).toEqual(def.ports);
    expect(placementPorts(def, sceneWith({ radius: 2 }).objects[0]!)).toMatchObject({ east: { x: 2, y: 0, dir: 'e' }, west: { x: -2, y: 0, dir: 'w' } });
    expect(placementPorts(undefined, sceneWith({}).objects[0]!)).toEqual({});
  });
});
