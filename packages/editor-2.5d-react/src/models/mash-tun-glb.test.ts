import { describe, expect, it } from 'vitest';
import { nodeByName } from './glb-json';
import { expectBreweryBasics, expectLiquid, expectNames, loadModel, worldPosOf } from './brewery-glb';

/** Asset contract for the mash tun (holodeck/blender/parts/mash-tun.py). */
describe('assets/models/mash-tun.glb', () => {
  const gltf = loadModel('mash-tun');

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 1.78 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.in', 'port.out']);
    expectNames(gltf, 'anim.', ['anim.agitator', 'anim.liquid']);
  });

  it('places ports and pivots where the script header documents', () => {
    expect(worldPosOf(gltf, 'port.in').toArray()).toEqual([expect.closeTo(0.7, 3), expect.closeTo(0.78, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'port.out').toArray()).toEqual([expect.closeTo(-0.7, 3), expect.closeTo(0.4, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'anim.agitator').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(1.24, 3), expect.closeTo(0, 3)]);
    // The agitator carries a visible shaft + crossbar + two paddles, and no liquid.
    const kids = (nodeByName(gltf, 'anim.agitator')!.node.children ?? []).map((i) => gltf.nodes[i].name).sort();
    expect(kids).toEqual(['crossbar', 'paddle.0', 'paddle.1', 'shaft']);
  });

  it('follows the liquid scaling convention (origin at liquid bottom, local y 0..H)', () => {
    expectLiquid(gltf, 0.32, 0.55);
  });
});
