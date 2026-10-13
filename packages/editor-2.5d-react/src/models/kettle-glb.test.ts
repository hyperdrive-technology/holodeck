import { describe, expect, it } from 'vitest';
import { nodeByName } from './glb-json';
import { expectBreweryBasics, expectLiquid, expectNames, loadModel, worldPosOf } from './brewery-glb';

/** Asset contract for the brew kettle (holodeck/blender/parts/kettle.py). */
describe('assets/models/kettle.glb', () => {
  const gltf = loadModel('kettle');

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 2.605 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.in', 'port.out']);
    expectNames(gltf, 'anim.', ['anim.liquid', 'anim.steam']);
  });

  it('places ports and pivots where the script header documents', () => {
    expect(worldPosOf(gltf, 'port.in').toArray()).toEqual([expect.closeTo(0.57, 3), expect.closeTo(1.2, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'port.out').toArray()).toEqual([expect.closeTo(-0.57, 3), expect.closeTo(0.5, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'anim.steam').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(2.32, 3), expect.closeTo(0, 3)]);
    const kids = (nodeByName(gltf, 'anim.steam')!.node.children ?? []).map((i) => gltf.nodes[i].name).sort();
    expect(kids).toEqual(['steam.0', 'steam.1', 'steam.2', 'steam.3']);
  });

  it('follows the liquid scaling convention (origin at liquid bottom, local y 0..H)', () => {
    expectLiquid(gltf, 0.3, 1.2);
  });
});
