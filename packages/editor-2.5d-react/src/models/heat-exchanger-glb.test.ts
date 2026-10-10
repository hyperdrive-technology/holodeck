import { describe, expect, it } from 'vitest';
import { nodeByName } from './glb-json';
import { expectBreweryBasics, expectLiquid, expectNames, loadModel, worldPosOf } from './brewery-glb';

/** Asset contract for the plate heat exchanger (holodeck/blender/parts/heat-exchanger.py). */
describe('assets/models/heat-exchanger.glb', () => {
  const gltf = loadModel('heat-exchanger');

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 1.1 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.hot-in', 'port.hot-out', 'port.cold-in', 'port.cold-out']);
    expectNames(gltf, 'anim.', []);
  });

  it('places ports and pivots where the script header documents', () => {
    expect(worldPosOf(gltf, 'port.hot-in').toArray()).toEqual([expect.closeTo(-0.13, 3), expect.closeTo(0.95, 3), expect.closeTo(0.39, 3)]);
    expect(worldPosOf(gltf, 'port.hot-out').toArray()).toEqual([expect.closeTo(-0.13, 3), expect.closeTo(0.22, 3), expect.closeTo(0.39, 3)]);
    expect(worldPosOf(gltf, 'port.cold-in').toArray()).toEqual([expect.closeTo(0.13, 3), expect.closeTo(0.22, 3), expect.closeTo(0.39, 3)]);
    expect(worldPosOf(gltf, 'port.cold-out').toArray()).toEqual([expect.closeTo(0.13, 3), expect.closeTo(0.95, 3), expect.closeTo(0.39, 3)]);
  });
});
