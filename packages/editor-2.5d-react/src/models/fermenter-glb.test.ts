import { describe, expect, it } from 'vitest';
import { nodeByName } from './glb-json';
import { expectBreweryBasics, expectLiquid, expectNames, loadModel, worldPosOf } from './brewery-glb';

/** Asset contract for the cylindro-conical fermenter (holodeck/blender/parts/fermenter.py). */
describe('assets/models/fermenter.glb', () => {
  const gltf = loadModel('fermenter');

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 2.08 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.in', 'port.out', 'port.glycol']);
    expectNames(gltf, 'anim.', ['anim.liquid']);
  });

  it('places ports and pivots where the script header documents', () => {
    expect(worldPosOf(gltf, 'port.in').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(2.08, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'port.out').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(0.3, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'port.glycol').toArray()).toEqual([expect.closeTo(0.515, 3), expect.closeTo(1.35, 3), expect.closeTo(0, 3)]);
  });

  it('follows the liquid scaling convention (origin at liquid bottom, local y 0..H)', () => {
    expectLiquid(gltf, 0.5, 1.25);
  });
});
