import { describe, expect, it } from 'vitest';
import { nodeBounds, nodeByName } from './glb-json';
import { expectBreweryBasics, expectNames, loadModel, worldPosOf } from './brewery-glb';

/** Asset contract for the agitated mixer (holodeck/blender/parts/mixer.py). */
describe('assets/models/mixer.glb', () => {
  const gltf = loadModel('mixer');

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 1.96 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.in', 'port.out']);
    expectNames(gltf, 'anim.', ['anim.agitator', 'anim.liquid']);
  });

  it('places ports and pivots where the script header documents', () => {
    expect(worldPosOf(gltf, 'port.in').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(1.25, 3), expect.closeTo(-0.6, 3)]);
    expect(worldPosOf(gltf, 'port.out').toArray()).toEqual([expect.closeTo(-0.6, 3), expect.closeTo(0.22, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'anim.agitator').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(1.72, 3), expect.closeTo(0, 3)]);
  });

  it('spins a shaft that reaches a 3-blade impeller low in the vessel', () => {
    const ag = nodeByName(gltf, 'anim.agitator')!;
    expect(ag.node.mesh).toBeUndefined();
    const kids = (ag.node.children ?? []).map((i) => gltf.nodes[i].name).sort();
    expect(kids).toEqual(['impeller.blade.0', 'impeller.blade.1', 'impeller.blade.2', 'impeller.hub', 'shaft']);
    // The shaft is on the axis and runs from inside the housing down into the hub,
    // so the impeller never floats below a short shaft (the procedural mixer's bug).
    const shaft = nodeBounds(gltf, nodeByName(gltf, 'shaft')!.index);
    const hub = nodeBounds(gltf, nodeByName(gltf, 'impeller.hub')!.index);
    expect((shaft.min.x + shaft.max.x) / 2).toBeCloseTo(0, 3);
    expect((shaft.min.z + shaft.max.z) / 2).toBeCloseTo(0, 3);
    expect(shaft.max.y).toBeGreaterThan(1.72); // above the dome apex, inside the housing
    expect(shaft.min.y).toBeLessThanOrEqual(hub.max.y);
    expect(shaft.min.y).toBeGreaterThanOrEqual(hub.min.y - 1e-3);
    // Hub low in the liquid (near the inner floor at 0.06), blades span the hub on both sides.
    expect(hub.min.y).toBeGreaterThan(0.06);
    expect(hub.max.y).toBeLessThan(0.5);
    for (let i = 0; i < 3; i++) {
      const blade = nodeBounds(gltf, nodeByName(gltf, `impeller.blade.${i}`)!.index);
      expect(Math.max(blade.max.x, -blade.min.x, blade.max.z, -blade.min.z)).toBeGreaterThan(0.15);
      expect(Math.max(blade.max.x, -blade.min.x, blade.max.z, -blade.min.z)).toBeLessThan(0.3);
      expect(Math.abs((blade.min.y + blade.max.y) / 2 - (hub.min.y + hub.max.y) / 2)).toBeLessThan(0.02);
    }
  });

  it('follows the liquid scaling convention (origin at liquid bottom, local y 0..H)', () => {
    // Same contract as expectLiquid (brewery-glb.ts) except the liquid is OUTLINED:
    // the cutaway liquid's level and cut faces are planar unlit accent, so without
    // edges the notch reads as one flat slab (the sight-window vessels keep edges off).
    const pivot = nodeByName(gltf, 'anim.liquid')!;
    expect(pivot.node.mesh).toBeUndefined();
    const p = worldPosOf(gltf, 'anim.liquid');
    expect(p.toArray()).toEqual([expect.closeTo(0, 4), expect.closeTo(0.06, 3), expect.closeTo(0, 4)]);
    expect((pivot.node.children ?? []).map((i) => gltf.nodes[i].name)).toEqual(['liquid']);
    const idx = nodeByName(gltf, 'liquid')!.index;
    const b = nodeBounds(gltf, idx);
    expect(b.min.y - p.y).toBeCloseTo(0, 3);
    expect(b.max.y - p.y).toBeCloseTo(1.39, 3);
    const prim = gltf.meshes[gltf.nodes[idx].mesh!].primitives[0];
    expect(gltf.materials![prim.material!].name).toBe('hd.accent');
    expect(gltf.nodes[idx].extras).toEqual({ hd_edges: true });
    // The GLB ships unscaled (full): a preview built with HD_MIXER_PREVIEW_FILL must never be committed.
    expect(pivot.node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
  });

  it('keeps the liquid inside the wall and cut by the window planes', () => {
    // Not an outset sight window: the liquid stays inside the inner wall (r 0.39)
    // and leaves the front quadrant (+X, +Z) open so the shaft and impeller show.
    const liquid = nodeBounds(gltf, nodeByName(gltf, 'liquid')!.index);
    expect(liquid.max.x).toBeLessThan(0.4);
    expect(liquid.max.z).toBeLessThan(0.4);
    expect(liquid.min.x).toBeGreaterThan(-0.4);
    expect(liquid.min.z).toBeGreaterThan(-0.4);
    const band = nodeBounds(gltf, nodeByName(gltf, 'shell.band')!.index);
    expect(liquid.max.x).toBeLessThan(band.max.x);
    expect(liquid.max.z).toBeLessThan(band.max.z);
  });

  it('cuts the window through the wall band only, leaving dome and heel whole', () => {
    // The windowed band keeps the back 270 deg: its bounds reach -R on both -X and -Z
    // but only to the cut planes' radius on the window side is covered by the
    // keep-arc end columns (+X at theta 90 deg and +Z at theta 360 deg).
    const band = nodeBounds(gltf, nodeByName(gltf, 'shell.band')!.index);
    expect(band.min.x).toBeCloseTo(-0.45, 3);
    expect(band.min.z).toBeCloseTo(-0.45, 3);
    expect(band.max.x).toBeCloseTo(0.45, 3);
    expect(band.max.z).toBeCloseTo(0.45, 3);
    expect(band.min.y).toBeCloseTo(0.14, 3);
    expect(band.max.y).toBeCloseTo(1.45, 3);
    const upper = nodeBounds(gltf, nodeByName(gltf, 'shell.upper')!.index);
    expect(upper.min.y).toBeCloseTo(1.45, 3);
    expect(upper.max.y).toBeCloseTo(1.72, 2);
    const lower = nodeBounds(gltf, nodeByName(gltf, 'shell.lower')!.index);
    expect(lower.min.y).toBeCloseTo(0, 4);
    expect(lower.max.y).toBeCloseTo(0.14, 3);
    // The shell is the mixer iso shade, not plain white.
    for (const name of ['shell.upper', 'shell.band', 'shell.lower', 'housing']) {
      const node = nodeByName(gltf, name)!.node;
      const prim = gltf.meshes[node.mesh!].primitives[0];
      expect(gltf.materials![prim.material!].name, name).toBe('hd.flask');
    }
  });
});
