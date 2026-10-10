import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Vector3 } from 'three';
import { expect } from 'vitest';
import { nodeBounds, nodeByName, parseGlbJson, sceneBounds, worldMatrices, type GltfJson } from './glb-json';

/**
 * Shared assertions for the brewery GLBs (holodeck/blender/parts/{fermenter,
 * brite-tank,mash-tun,kettle,heat-exchanger}.py). Each <part>-glb.test.ts
 * declares its expected names/dimensions and calls these, so the checks stay
 * identical across parts. Liquid convention: see blender/brewery.py header.
 */
const PKG = resolve(__dirname, '../..');
export const loadModel = (name: string): GltfJson =>
  parseGlbJson(new Uint8Array(readFileSync(join(PKG, 'assets/models', `${name}.glb`))));

export const ALLOWED_MATERIALS = ['hd.white', 'hd.shaded', 'hd.vessel', 'hd.flask', 'hd.accent'];
export const MAX_TRIS = 5000;

export function triangleCount(gltf: GltfJson): number {
  let tris = 0;
  for (const mesh of gltf.meshes) {
    for (const prim of mesh.primitives) {
      // Exporter always writes indices for these parts; fall back to POSITION count / 3.
      const count = prim.indices !== undefined ? gltf.accessors[prim.indices].count : gltf.accessors[prim.attributes.POSITION].count;
      tris += count / 3;
    }
  }
  return tris;
}

export function worldPosOf(gltf: GltfJson, name: string): Vector3 {
  const hit = nodeByName(gltf, name);
  expect(hit, `node ${name}`).toBeDefined();
  return new Vector3().setFromMatrixPosition(worldMatrices(gltf).get(hit!.index)!);
}

export function expectNames(gltf: GltfJson, prefix: 'port.' | 'anim.', expected: string[]) {
  const got = gltf.nodes.map((n) => n.name ?? '').filter((n) => n.startsWith(prefix)).sort();
  expect(got).toEqual([...expected].sort());
}

/** Common checks: materials, triangle bound, floor anchor, ports mesh-free. */
export function expectBreweryBasics(gltf: GltfJson, opts: { height: number; maxTris?: number }) {
  const mats = (gltf.materials ?? []).map((m) => m.name ?? '');
  expect(mats.length).toBeGreaterThan(0);
  for (const m of mats) expect(ALLOWED_MATERIALS, m).toContain(m);
  for (const m of gltf.materials ?? []) expect(m.doubleSided ?? false).toBe(false);
  expect(triangleCount(gltf)).toBeLessThan(opts.maxTris ?? MAX_TRIS);
  const box = sceneBounds(gltf);
  expect(box.min.y).toBeGreaterThanOrEqual(-1e-4); // origin = floor anchor, nothing below
  expect(box.min.y).toBeLessThan(0.05);
  expect(box.max.y).toBeCloseTo(opts.height, 1);
  for (const n of gltf.nodes.filter((x) => x.name?.startsWith('port.'))) expect(n.mesh, n.name).toBeUndefined();
}

/**
 * anim.liquid: empty on the vessel axis at the liquid bottom (world x=z=0, y=pivotY),
 * child mesh `liquid` in hd.accent whose local bounds start at y=0 and are
 * `height` tall, so scale.y 0..1 fills upward.
 */
export function expectLiquid(gltf: GltfJson, pivotY: number, height: number) {
  const pivot = nodeByName(gltf, 'anim.liquid')!;
  expect(pivot.node.mesh).toBeUndefined();
  const p = worldPosOf(gltf, 'anim.liquid');
  expect(p.x).toBeCloseTo(0, 4);
  expect(p.z).toBeCloseTo(0, 4);
  expect(p.y).toBeCloseTo(pivotY, 3);
  const kids = (pivot.node.children ?? []).map((i) => gltf.nodes[i].name);
  expect(kids).toEqual(['liquid']);
  const idx = nodeByName(gltf, 'liquid')!.index;
  const b = nodeBounds(gltf, idx);
  expect(b.min.y - p.y).toBeCloseTo(0, 3);
  expect(b.max.y - p.y).toBeCloseTo(height, 3);
  const prim = gltf.meshes[gltf.nodes[idx].mesh!].primitives[0];
  expect(gltf.materials![prim.material!].name).toBe('hd.accent');
  expect(gltf.nodes[idx].extras).toEqual({ hd_edges: false });
}
