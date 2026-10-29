import { describe, expect, it } from 'vitest';
import { nodeBounds, nodeByName } from './glb-json';
import { expectBreweryBasics, expectNames, loadModel, worldPosOf } from './brewery-glb';

/** Asset contract for the agitated mixer (holodeck/blender/parts/mixer.py). */
describe('assets/models/mixer.glb', () => {
  const gltf = loadModel('mixer');
  const materialOf = (name: string) => {
    const node = nodeByName(gltf, name)!.node;
    return gltf.materials![gltf.meshes[node.mesh!].primitives[0].material!].name;
  };

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 2.01 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.in', 'port.out']);
    expectNames(gltf, 'anim.', ['anim.agitator', 'anim.liquid']);
  });

  it('places ports and pivots where the script header documents', () => {
    expect(worldPosOf(gltf, 'port.in').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(1.2, 3), expect.closeTo(-0.58, 3)]);
    expect(worldPosOf(gltf, 'port.out').toArray()).toEqual([expect.closeTo(-0.58, 3), expect.closeTo(0.25, 3), expect.closeTo(0, 3)]);
    expect(worldPosOf(gltf, 'anim.agitator').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(1.75, 3), expect.closeTo(0, 3)]);
  });

  it('nozzles are slim stubs with a wider flange ring at the port end', () => {
    for (const [stub, axis] of [['outlet', 'x'], ['inlet', 'z']] as const) {
      const body = nodeBounds(gltf, nodeByName(gltf, stub)!.index);
      const flange = nodeBounds(gltf, nodeByName(gltf, `${stub}.flange`)!.index);
      const across = axis === 'x' ? 'z' : 'x';
      const bodyR = (body.max[across] - body.min[across]) / 2;
      const flangeR = (flange.max[across] - flange.min[across]) / 2;
      expect(bodyR).toBeLessThan(0.06); // slim, not the 0.07 / 0.1 hex look
      expect(flangeR / bodyR).toBeCloseTo(1.32, 1); // scene pipe PIPE_FLANGE_SCALE
      expect(flange.max[axis] - flange.min[axis]).toBeLessThan(0.03); // a thin ring, perpendicular to the stub
      expect(flange.min[axis]).toBeCloseTo(-0.58, 2); // ring sits at the port face
    }
  });

  it('spins a shaft, a cross paddle and a 3-blade impeller low in the vessel', () => {
    const ag = nodeByName(gltf, 'anim.agitator')!;
    expect(ag.node.mesh).toBeUndefined();
    const kids = (ag.node.children ?? []).map((i) => gltf.nodes[i].name).sort();
    expect(kids).toEqual(['impeller.blade.0', 'impeller.blade.1', 'impeller.blade.2', 'impeller.hub', 'paddle', 'shaft']);
    // The shaft is on the axis and runs from inside the housing down into the hub,
    // so the impeller never floats below a short shaft (the procedural mixer's bug).
    const shaft = nodeBounds(gltf, nodeByName(gltf, 'shaft')!.index);
    const hub = nodeBounds(gltf, nodeByName(gltf, 'impeller.hub')!.index);
    expect((shaft.min.x + shaft.max.x) / 2).toBeCloseTo(0, 3);
    expect((shaft.min.z + shaft.max.z) / 2).toBeCloseTo(0, 3);
    expect(shaft.max.y).toBeGreaterThan(1.75); // above the head apex, inside the housing
    expect(shaft.min.y).toBeLessThanOrEqual(hub.max.y);
    expect(shaft.min.y).toBeGreaterThanOrEqual(hub.min.y - 1e-3);
    // Hub low in the liquid but above the dish rim (0.22); blades span the hub on both sides.
    expect(hub.min.y).toBeGreaterThan(0.22);
    expect(hub.max.y).toBeLessThan(0.5);
    for (let i = 0; i < 3; i++) {
      const blade = nodeBounds(gltf, nodeByName(gltf, `impeller.blade.${i}`)!.index);
      const reach = Math.max(blade.max.x, -blade.min.x, blade.max.z, -blade.min.z);
      expect(reach).toBeGreaterThan(0.18);
      expect(reach).toBeLessThan(0.3);
      expect(Math.abs((blade.min.y + blade.max.y) / 2 - (hub.min.y + hub.max.y) / 2)).toBeLessThan(0.02);
    }
    const paddle = nodeBounds(gltf, nodeByName(gltf, 'paddle')!.index);
    expect(paddle.max.x - paddle.min.x).toBeGreaterThan(0.6); // nearly the inner diameter
    expect((paddle.min.y + paddle.max.y) / 2).toBeCloseTo(1.3, 2);
  });

  it('follows the liquid scaling convention with the translucent hd.liquid finish', () => {
    // Same pivot/scale contract as expectLiquid (brewery-glb.ts), but the liquid is a
    // FULL revolution in hd.liquid (translucent at runtime) with its edges drawn,
    // not the opaque vessels' outset, edge-less sight-window slice.
    const pivot = nodeByName(gltf, 'anim.liquid')!;
    expect(pivot.node.mesh).toBeUndefined();
    const p = worldPosOf(gltf, 'anim.liquid');
    expect(p.toArray()).toEqual([expect.closeTo(0, 4), expect.closeTo(0.06, 3), expect.closeTo(0, 4)]);
    expect((pivot.node.children ?? []).map((i) => gltf.nodes[i].name)).toEqual(['liquid']);
    const idx = nodeByName(gltf, 'liquid')!.index;
    const b = nodeBounds(gltf, idx);
    expect(b.min.y - p.y).toBeCloseTo(0, 3);
    expect(b.max.y - p.y).toBeCloseTo(1.39, 3);
    expect(materialOf('liquid')).toBe('hd.liquid');
    expect(gltf.nodes[idx].extras?.hd_edges ?? true).toBe(true);
    // Inside the inner wall (r 0.39) all round: no sight-window outset.
    expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z)).toBeLessThan(0.39);
    // The GLB ships unscaled (full): a preview built with HD_MIXER_PREVIEW_FILL must never be committed.
    expect(pivot.node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
  });

  it('cuts the window through the wall band and shoulder, leaving the head cap and heel whole', () => {
    const band = nodeBounds(gltf, nodeByName(gltf, 'shell.band')!.index);
    // 270 deg keep-arc (95..355 deg): reaches -R on -X and -Z, the cut planes near +X / +Z.
    // Facets sit at -5 + 20k deg, so no column lies exactly on an axis: extents are R*sin(85 deg).
    expect(band.min.x).toBeCloseTo(-0.45, 2);
    expect(band.min.z).toBeCloseTo(-0.45, 2);
    expect(band.max.x).toBeCloseTo(0.45, 2);
    expect(band.max.z).toBeCloseTo(0.45, 2);
    expect(band.min.y).toBeCloseTo(0.08, 3); // sill, into the heel
    expect(band.max.y).toBeCloseTo(1.65, 3); // arched top, into the head
    const upper = nodeBounds(gltf, nodeByName(gltf, 'shell.upper')!.index);
    expect(upper.min.y).toBeCloseTo(1.65, 3);
    expect(upper.max.y).toBeCloseTo(1.75, 1);
    expect(Math.max(upper.max.x, upper.max.z)).toBeLessThan(0.35); // only the head cap is left above the window
    const lower = nodeBounds(gltf, nodeByName(gltf, 'shell.lower')!.index);
    expect(lower.min.y).toBeCloseTo(0, 4);
    expect(lower.max.y).toBeCloseTo(0.08, 3);
    // The shell is the mixer iso shade, not plain white; agitator and nozzles are white.
    for (const name of ['shell.upper', 'shell.band', 'shell.lower', 'housing', 'housing.lid']) expect(materialOf(name), name).toBe('hd.flask');
    for (const name of ['shaft', 'paddle', 'impeller.hub', 'inlet', 'outlet']) expect(materialOf(name), name).toBe('hd.white');
  });
});
