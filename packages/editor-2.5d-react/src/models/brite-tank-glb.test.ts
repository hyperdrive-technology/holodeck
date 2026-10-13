import { describe, expect, it } from 'vitest';
import { nodeByName } from './glb-json';
import { expectBreweryBasics, expectLiquid, expectNames, loadModel, worldPosOf } from './brewery-glb';

/** Asset contract for the vertical brite tank (holodeck/blender/parts/brite-tank.py). */
describe('assets/models/brite-tank.glb', () => {
  const gltf = loadModel('brite-tank');

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 1.8 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.in', 'port.out']);
    expectNames(gltf, 'anim.', ['anim.liquid']);
  });

  it('places ports and pivots where the script header documents', () => {
    expect(worldPosOf(gltf, 'port.in').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(1.8, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'port.out').toArray()).toEqual([expect.closeTo(0.55, 3), expect.closeTo(0.6, 3), expect.closeTo(0, 3)]);
  });

  it('follows the liquid scaling convention (origin at liquid bottom, local y 0..H)', () => {
    expectLiquid(gltf, 0.35, 1.15);
  });
});
