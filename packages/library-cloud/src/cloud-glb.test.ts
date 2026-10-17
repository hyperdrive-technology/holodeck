import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Mesh, Object3D, Raycaster, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error Build scripts are plain Node ESM, not part of the published TS API.
import { buildPart, findBlender, listParts, PARTS_DIR } from '../scripts/build-parts.mjs';
import { CLOUD_PART_DEFINITIONS } from './parts';

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const EPS = 1e-4;
const authoredName = (node: Object3D) => node.userData.name ?? node.name;

it('keeps the catalogue, Blender scripts and shipped GLBs in sync', () => {
  const names = listParts().sort();
  expect(readdirSync(PARTS_DIR).filter((name) => name.endsWith('.py') && !name.startsWith('_')).map((name) => name.slice(0, -3)).sort()).toEqual(names);
  expect(readdirSync(join(assets, 'models')).filter((name) => name.endsWith('.glb')).map((name) => name.slice(0, -4)).sort()).toEqual(names);
});

describe.each(CLOUD_PART_DEFINITIONS)('$id GLB', (part) => {
  let gltf: GLTF;
  let meshes: Mesh[];
  let bounds: Box3;
  let logo: Object3D;

  beforeAll(async () => {
    const bytes = readFileSync(join(assets, part.model));
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    // Reject dependencies before GLTFLoader could attempt to fetch them.
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers[0].uri).toBeUndefined();
    expect(json.images ?? []).toEqual([]);
    expect(json.extensionsRequired ?? []).toEqual([]);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    gltf = await new GLTFLoader().parseAsync(data, '');
    gltf.scene.updateMatrixWorld(true);
    meshes = [];
    gltf.scene.traverse((node) => { if (node instanceof Mesh) meshes.push(node); });
    bounds = new Box3().setFromObject(gltf.scene, true);
    logo = gltf.scene.getObjectByName('logo')!;
  });

  it('loads with Three.js as self-contained, untextured geometry', () => {
    expect(meshes.length).toBeGreaterThan(0);
    expect(gltf.animations).toEqual([]);
    expect(gltf.cameras).toEqual([]);
    expect(gltf.parser.json.extensionsUsed ?? []).toEqual([]);
    for (const mesh of meshes) {
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(['normal', 'position']);
      for (const value of mesh.geometry.attributes.position.array) expect(Number.isFinite(value)).toBe(true);
      for (const value of mesh.geometry.attributes.normal.array) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('uses only the two single-sided recolourable E2 materials', () => {
    const names = new Set<string>();
    for (const mesh of meshes) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        names.add(material.name);
        expect(material.name).toMatch(/^hd\./);
        expect(material.side).toBe(0);
      }
    }
    expect([...names].sort()).toEqual(['hd.accent', 'hd.white']);
    const color = gltf.parser.json.materials.find((material: { name: string }) => material.name === 'hd.accent').pbrMetallicRoughness.baseColorFactor;
    const toSrgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
    const hex = '#' + color.slice(0, 3).map((value: number) => Math.round(toSrgb(value) * 255).toString(16).padStart(2, '0')).join('');
    expect(hex).toBe(part.colors.accent);
  });

  it('rests at Y=0, fits its routing footprint, and stays low-poly', () => {
    const span = bounds.getSize(new Vector3());
    expect(bounds.min.y).toBeCloseTo(0, 4);
    expect(span.y).toBeGreaterThan(0.1);
    expect(span.y).toBeLessThanOrEqual(2.5);
    expect(span.x).toBeGreaterThan(0.5);
    expect(span.z).toBeGreaterThan(0.5);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-part.footprint.w / 2 - EPS);
    expect(bounds.max.x).toBeLessThanOrEqual(part.footprint.w / 2 + EPS);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-part.footprint.h / 2 - EPS);
    expect(bounds.max.z).toBeLessThanOrEqual(part.footprint.h / 2 + EPS);
    const triangles = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
    expect(triangles).toBeGreaterThan(12);
    expect(triangles).toBeLessThan(6000);
  });

  it('has exactly one centered logo empty with a square X/Z scale', () => {
    const nodes: Object3D[] = [];
    gltf.scene.traverse((node) => { if (authoredName(node) === 'logo') nodes.push(node); });
    expect(nodes).toHaveLength(1);
    expect(logo).toBeDefined();
    expect(logo).not.toBeInstanceOf(Mesh);
    expect(logo.children).toHaveLength(0);
    const position = logo.getWorldPosition(new Vector3());
    const scale = logo.getWorldScale(new Vector3());
    expect(position.x).toBeCloseTo(0, 4);
    expect(position.z).toBeCloseTo(0, 4);
    expect(position.y).toBeCloseTo(bounds.max.y, 4);
    expect(scale.x).toBeGreaterThan(0.2);
    expect(scale.z).toBeCloseTo(scale.x, 4);
    expect(scale.y).toBeCloseTo(1, 4);
  });

  it('supports the whole logo square on an unobstructed horizontal top face', () => {
    expect(logo).toBeDefined();
    const center = logo.getWorldPosition(new Vector3());
    const half = logo.getWorldScale(new Vector3()).x / 2;
    const ray = new Raycaster();
    for (const dx of [-half, 0, half]) {
      for (const dz of [-half, 0, half]) {
        ray.set(new Vector3(center.x + dx, bounds.max.y + 1, center.z + dz), new Vector3(0, -1, 0));
        const [hit] = ray.intersectObjects(meshes, false);
        expect(hit, `top face under logo at ${dx}, ${dz}`).toBeDefined();
        expect(hit.point.y).toBeCloseTo(center.y, 4);
        const normal = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
        expect(normal.y).toBeCloseTo(1, 4);
      }
    }
  });
});

const blender = findBlender();
describe.skipIf(!blender)('deterministic Blender rebuild (requires Blender)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holodeck-cloud-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it.each(CLOUD_PART_DEFINITIONS)('$id matches its authored script byte-for-byte', async (part) => {
    await buildPart(part.id.slice(6), { outDir: directory, blender, quiet: true });
    expect(readFileSync(join(directory, part.model.slice('models/'.length))).equals(readFileSync(join(assets, part.model)))).toBe(true);
  }, 60_000);
});
