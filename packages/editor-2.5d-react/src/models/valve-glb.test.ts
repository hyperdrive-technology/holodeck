import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Vector3 } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_FITTING_PARAMS as P } from '../../assets/process/fitting-params';
// @ts-expect-error — plain .mjs build script, no type declarations.
import { buildPart, compareGlb, findBlender } from '../../scripts/build-parts.mjs';
import { nodeBounds, nodeByName, parseGlbJson, sceneBounds, worldMatrices, type GltfJson } from './glb-json';

/**
 * Asset contract for the Blender-built valve (holodeck/blender/parts/valve.py).
 * Expected dimensions come from the live DEFAULT_FITTING_PARAMS so a tuner
 * default change that is not mirrored into valve.py fails here — rebuild
 * with `pnpm run parts:build valve` after updating the Python.
 */
const PKG = resolve(__dirname, '../..');
const GLB = join(PKG, 'assets/models/valve.glb');
const EPS = 1e-4; // float32 storage of Blender doubles

const load = (path: string): GltfJson => parseGlbJson(new Uint8Array(readFileSync(path)));

describe('assets/models/valve.glb', () => {
  const gltf = load(GLB);
  const world = worldMatrices(gltf);
  const worldPos = (name: string) => {
    const hit = nodeByName(gltf, name);
    expect(hit, `node ${name}`).toBeDefined();
    return new Vector3().setFromMatrixPosition(world.get(hit!.index)!);
  };

  it('is glTF 2.0 with no cameras, lights, textures or extensions', () => {
    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.cameras ?? []).toHaveLength(0);
    expect(gltf.extensionsUsed ?? []).toHaveLength(0);
    expect((gltf as Record<string, unknown>).images ?? []).toHaveLength(0);
    expect((gltf as Record<string, unknown>).textures ?? []).toHaveLength(0);
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) {
        expect(Object.keys(prim.attributes).sort()).toEqual(['NORMAL', 'POSITION']);
      }
    }
  });

  it('uses only hd.* materials, single-sided, with the handwheel accent colour', () => {
    const names = (gltf.materials ?? []).map((m) => m.name);
    expect(names.sort()).toEqual(['hd.accent', 'hd.white']);
    for (const m of gltf.materials ?? []) expect(m.doubleSided ?? false).toBe(false);
    for (const mesh of gltf.meshes) {
      for (const prim of mesh.primitives) expect(prim.material, `${mesh.name} has a material`).toBeDefined();
    }
    // baseColorFactor is linear; convert back to sRGB hex.
    const lin = gltf.materials!.find((m) => m.name === 'hd.accent')!.pbrMetallicRoughness!.baseColorFactor!;
    const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
    const hex = '#' + lin.slice(0, 3).map((c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, '0')).join('');
    expect(hex).toBe(P.valveHandwheel);
  });

  it('has the contract nodes and handwheel hierarchy', () => {
    const names = gltf.nodes.map((n) => n.name).sort();
    expect(names).toEqual([
      'anim.handwheel',
      'barrel',
      'globe',
      'handwheel.rim',
      'handwheel.spoke.0',
      'handwheel.spoke.1',
      'port.in',
      'port.out',
      'stem',
    ]);
    const wheel = nodeByName(gltf, 'anim.handwheel')!.node;
    const kids = (wheel.children ?? []).map((i) => gltf.nodes[i].name).sort();
    expect(kids).toEqual(['handwheel.rim', 'handwheel.spoke.0', 'handwheel.spoke.1']);
    expect(wheel.mesh).toBeUndefined();
    expect(nodeByName(gltf, 'port.in')!.node.mesh).toBeUndefined();
    expect(nodeByName(gltf, 'port.out')!.node.mesh).toBeUndefined();
  });

  it('places ports on the X axis, symmetric about the origin at the barrel ends', () => {
    const pin = worldPos('port.in');
    const pout = worldPos('port.out');
    expect(pin.x).toBeCloseTo(-P.valveBarrelLen / 2, 4);
    expect(pout.x).toBeCloseTo(P.valveBarrelLen / 2, 4);
    for (const p of [pin, pout]) {
      expect(Math.abs(p.y)).toBeLessThan(EPS);
      expect(Math.abs(p.z)).toBeLessThan(EPS);
    }
    expect(pin.x + pout.x).toBeCloseTo(0, 5);
  });

  it('pivots the handwheel above the origin on +Y', () => {
    const pivot = worldPos('anim.handwheel');
    expect(pivot.y).toBeCloseTo(P.valveSpokeY, 4);
    expect(Math.abs(pivot.x)).toBeLessThan(EPS);
    expect(Math.abs(pivot.z)).toBeLessThan(EPS);
    // Rim is horizontal: thin in Y, wide in X/Z.
    const rim = nodeBounds(gltf, nodeByName(gltf, 'handwheel.rim')!.index, world);
    expect(rim.min.y).toBeCloseTo(P.valveSpokeY - P.valveTorusTube, 4);
    expect(rim.max.y).toBeCloseTo(P.valveSpokeY + P.valveTorusTube, 4);
    expect(rim.max.x).toBeCloseTo(P.valveWheelR + P.valveTorusTube, 4);
    expect(rim.max.z).toBeCloseTo(P.valveWheelR + P.valveTorusTube, 4);
  });

  it('lays the barrel along X and matches the code valve extents', () => {
    const barrel = nodeBounds(gltf, nodeByName(gltf, 'barrel')!.index, world);
    expect(barrel.min.x).toBeCloseTo(-P.valveBarrelLen / 2, 4);
    expect(barrel.max.x).toBeCloseTo(P.valveBarrelLen / 2, 4);
    expect(barrel.max.y).toBeLessThanOrEqual(P.valveBarrelR + EPS);
    expect(barrel.max.z).toBeCloseTo(P.valveBarrelR, 4); // theta=0 vertex on +Z, as three

    const stem = nodeBounds(gltf, nodeByName(gltf, 'stem')!.index, world);
    expect(stem.min.y).toBeCloseTo(P.valveStemY - P.valveStemH / 2, 4);
    expect(stem.max.y).toBeCloseTo(P.valveStemY + P.valveStemH / 2, 4);

    const all = sceneBounds(gltf);
    const outer = P.valveWheelR + P.valveTorusTube;
    expect(all.min.x).toBeCloseTo(-outer, 4);
    expect(all.max.x).toBeCloseTo(outer, 4);
    expect(all.min.z).toBeCloseTo(-outer, 4);
    expect(all.max.z).toBeCloseTo(outer, 4);
    expect(all.min.y).toBeCloseTo(-P.valveGlobe, 4);
    expect(all.max.y).toBeCloseTo(P.valveSpokeY + P.valveTorusTube, 4);
  });

  it('keeps the low-poly segment counts of the code valve', () => {
    const verts = (name: string) => {
      const node = nodeByName(gltf, name)!.node;
      return gltf.accessors[gltf.meshes[node.mesh!].primitives[0].attributes.POSITION].count;
    };
    // Flat shading splits vertices per face corner (normals differ), so
    // counts are per-face: sum of face corners over the welded mesh.
    const w = P.valveGlobeW;
    const h = P.valveGlobeH;
    expect(verts('globe')).toBe(w * 3 * 2 + w * (h - 2) * 4);
    expect(verts('barrel')).toBe(P.valveBarrelSides * 4 + P.valveBarrelSides * 2);
    expect(verts('stem')).toBe(8 * 6);
    expect(verts('handwheel.rim')).toBe(P.valveTorusRadial * P.valveTorusTubular * 4);
    expect(verts('handwheel.spoke.0')).toBe(6 * 6);
    expect(gltf.meshes).toHaveLength(6);
  });

  it('carries hd_* extras', () => {
    expect(nodeByName(gltf, 'handwheel.rim')!.node.extras).toEqual({ hd_edge_threshold: 22 });
    expect(nodeByName(gltf, 'stem')!.node.extras).toEqual({ hd_edges: false });
    expect(nodeByName(gltf, 'handwheel.spoke.0')!.node.extras).toEqual({ hd_edges: false });
  });
});

const blender = findBlender() as string | null;

// HOLODECK_REQUIRE_BLENDER=1 (set by .github/workflows/blender-drift.yml, holodeck#136): the job
// exists to run the rebuild below, so a missing Blender must fail it, not skip it quietly.
it.runIf(process.env.HOLODECK_REQUIRE_BLENDER === '1')('finds Blender when HOLODECK_REQUIRE_BLENDER=1', () => {
  expect(blender, 'Blender not found: set $BLENDER or put blender on PATH').toBeTruthy();
});

describe.skipIf(!blender)('valve.glb rebuild (needs Blender)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hd-parts-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('rebuilds to the committed asset (deterministic + not stale)', async () => {
    await buildPart('valve', { outDir: dir, blender, quiet: true });
    const out = join(dir, 'valve.glb');
    expect(existsSync(out)).toBe(true);
    // Byte-identical on the authoring platform; across macOS/Linux a node
    // quaternion may differ by one float32 ULP, which compareGlb tolerates
    // (holodeck#136, scripts/glb-compare.mjs). Its problems name the JSON path
    // that changed, so a failure explains *what* changed.
    expect(compareGlb(readFileSync(out), readFileSync(GLB)).problems).toEqual([]);
  });
});
