/**
 * GLB contract for every shipped process model (style of library-cloud's
 * cloud-glb.test.ts): self-contained glTF, `hd.*` materials only, the size and
 * triangle budgets from docs/assets/process-catalog.md, the placement envelope
 * and the `port.*` / `anim.*` empties exactly as `src/models.json` declares
 * them (a mirror of each Blender script's `c.check(...)`), and the part's real
 * animators moving its declared nodes.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_ISO_ANIMATORS, applyAnimations, planAnimations } from '@holodeck/editor-2.5d-react/contracts';
// @ts-expect-error Build scripts are plain Node ESM, not part of the published TS API.
import { buildPart, compareGlb, findBlender, listParts, PARTS_DIR } from '../scripts/build-parts.mjs';
import { PROCESS_MODELS, PROCESS_MODEL_SLUGS, type ModelPoint } from './models';
import { PROCESS_PART_DEFINITIONS, type ProcessPartDefinition } from './parts';

const models = fileURLToPath(new URL('../assets/models/', import.meta.url));
const EPS = 1e-4;
/** docs/assets/process-catalog.md "Budget": under 60 KB and under 3 000 triangles per GLB. */
const MAX_BYTES = 60 * 1024;
const MAX_TRIANGLES = 3000;
/** The finishes a process GLB may use (assets/process/apply-style.ts maps each one). */
const FINISHES = ['hd.white', 'hd.shaded', 'hd.accent'];
const authoredName = (node: Object3D) => (node.userData.name as string | undefined) ?? node.name;
const animator = (id: string) => BUILTIN_ISO_ANIMATORS.find((a) => a.id === id);
const slugOf = (part: ProcessPartDefinition) => part.id.slice('process:'.length);
const v = (p: ModelPoint) => new Vector3(p[0], p[1], p[2]);

const onDisk = readdirSync(models).filter((name) => name.endsWith('.glb')).map((name) => name.slice(0, -4)).sort();

describe('catalogue guard (a new GLB or script is a deliberate parts.json edit)', () => {
  it('every GLB in assets/models has exactly one definition and one contract, and vice versa', () => {
    const defined = PROCESS_PART_DEFINITIONS.map(slugOf);
    expect(new Set(defined).size).toBe(defined.length);
    expect([...defined].sort()).toEqual(onDisk);
    expect([...PROCESS_MODEL_SLUGS].sort()).toEqual(onDisk);
    expect(listParts().sort()).toEqual(onDisk);
  });

  it('every part script in blender/parts/process has a GLB; helper modules (_*.py) are not parts', () => {
    const scripts = readdirSync(PARTS_DIR).filter((name: string) => name.endsWith('.py'));
    const parts = scripts.filter((name: string) => !name.startsWith('_')).map((name: string) => name.slice(0, -3)).sort();
    expect(parts).toEqual(onDisk);
    expect(scripts).toContain('_common.py');
  });
});

describe.each(PROCESS_PART_DEFINITIONS.map((part) => [slugOf(part), part] as const))('%s GLB', (slug, part) => {
  const contract = PROCESS_MODELS[slug]!;
  let bytes: Buffer;
  let json: { meshes: Array<{ primitives: Array<{ indices?: number; attributes: Record<string, number> }> }>; accessors: Array<{ count: number }>; materials: Array<{ name: string; doubleSided?: boolean }> };
  let gltf: GLTF;
  let meshes: Mesh[];
  let bounds: Box3;

  beforeAll(async () => {
    bytes = readFileSync(join(models, `${slug}.glb`));
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
    json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    // A fresh ArrayBuffer copy (Buffer.buffer is typed ArrayBufferLike under newer @types/node).
    gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
    gltf.scene.updateMatrixWorld(true);
    meshes = [];
    gltf.scene.traverse((node) => { if (node instanceof Mesh) meshes.push(node); });
    bounds = new Box3().setFromObject(gltf.scene, true);
  });

  it('is self-contained, untextured, unanimated geometry', () => {
    const raw = json as unknown as { buffers: Array<{ uri?: string }>; images?: unknown[]; extensionsRequired?: string[]; extensionsUsed?: string[] };
    expect(raw.buffers).toHaveLength(1);
    expect(raw.buffers[0]!.uri).toBeUndefined();
    expect(raw.images ?? []).toEqual([]);
    expect(raw.extensionsRequired ?? []).toEqual([]);
    expect(raw.extensionsUsed ?? []).toEqual([]);
    expect(gltf.animations).toEqual([]);
    expect(gltf.cameras).toEqual([]);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(Object.keys(mesh.geometry.attributes).sort()).toEqual(['normal', 'position']);
      for (const value of mesh.geometry.attributes.position!.array) expect(Number.isFinite(value)).toBe(true);
      for (const value of mesh.geometry.attributes.normal!.array) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it(`stays under the budget: < ${MAX_BYTES} bytes and < ${MAX_TRIANGLES} triangles`, () => {
    expect(bytes.length).toBeLessThan(MAX_BYTES);
    expect(statSync(join(models, `${slug}.glb`)).size).toBe(bytes.length);
    const triangles = json.meshes.reduce(
      (sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + json.accessors[p.indices ?? p.attributes.POSITION!]!.count / 3, 0),
      0,
    );
    expect(triangles).toBeGreaterThan(12);
    expect(triangles).toBeLessThan(MAX_TRIANGLES);
  });

  it('uses only single-sided hd.* finishes, with hd.accent exactly when the model carries state colour', () => {
    const names = new Set(json.materials.map((m) => m.name));
    for (const name of names) expect(FINISHES, name).toContain(name);
    for (const material of json.materials) expect(material.doubleSided ?? false, material.name).toBe(false);
    for (const mesh of meshes) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) expect(material.side).toBe(0);
    }
    expect(names.has('hd.accent')).toBe(contract.accent);
    expect(names.has('hd.white')).toBe(true);
  });

  it('fits its placement envelope (footprint, height, and Y = 0 for floor and mounted parts)', () => {
    const [fx, fz] = contract.footprint;
    expect(bounds.min.x).toBeGreaterThanOrEqual(-fx / 2 - EPS);
    expect(bounds.max.x).toBeLessThanOrEqual(fx / 2 + EPS);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-fz / 2 - EPS);
    expect(bounds.max.z).toBeLessThanOrEqual(fz / 2 + EPS);
    expect(bounds.min.y).toBeGreaterThanOrEqual(contract.yMin - EPS);
    expect(bounds.max.y).toBeLessThanOrEqual(contract.yMin + contract.height + EPS);
    if (contract.kind !== 'inline') expect(bounds.min.y).toBeCloseTo(contract.yMin, 4);
    if (contract.kind === 'floor') expect(contract.yMin).toBe(0);
    if (contract.kind === 'inline') {
      // Inline bodies straddle the pipe axis (local Y = 0) and span the face-to-face length.
      expect(bounds.min.y).toBeLessThan(0);
      expect(bounds.max.y).toBeGreaterThan(0);
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(contract.length!, 3);
    }
  });

  it('has exactly the declared port.* empties, mesh-free, at the declared positions', () => {
    const found = new Map<string, Object3D>();
    gltf.scene.traverse((node) => {
      const name = authoredName(node);
      if (name.startsWith('port.')) found.set(name.slice(5), node);
    });
    expect([...found.keys()].sort()).toEqual(Object.keys(contract.ports).sort());
    for (const [name, at] of Object.entries(contract.ports)) {
      const node = found.get(name)!;
      expect(node, name).not.toBeInstanceOf(Mesh);
      expect(node.children, name).toHaveLength(0);
      expect(node.getWorldPosition(new Vector3()).distanceTo(v(at)), name).toBeLessThan(EPS);
    }
    if (contract.kind === 'inline') {
      expect(contract.ports.in).toEqual([-contract.length! / 2, 0, 0]);
      expect(contract.ports.out).toEqual([contract.length! / 2, 0, 0]);
    }
  });

  it('has exactly the declared anim.* pivots, each an empty with moving meshes beneath it', () => {
    const found = new Map<string, Object3D>();
    gltf.scene.traverse((node) => {
      const name = authoredName(node);
      if (name.startsWith('anim.')) found.set(name.slice(5), node);
    });
    expect([...found.keys()].sort()).toEqual(Object.keys(contract.anim).sort());
    for (const [name, at] of Object.entries(contract.anim)) {
      const node = found.get(name)!;
      expect(node, name).not.toBeInstanceOf(Mesh);
      expect(node.getWorldPosition(new Vector3()).distanceTo(v(at)), name).toBeLessThan(EPS);
      let moving = 0;
      node.traverse((child) => { if (child instanceof Mesh) moving += 1; });
      expect(moving, name).toBeGreaterThan(0);
    }
  });

  it("drives every anim node with the part's own animator and settings, within the envelope", () => {
    const nodes: Record<string, Object3D> = {};
    gltf.scene.traverse((node) => { if (authoredName(node).startsWith('anim.')) nodes[authoredName(node)] = node; });
    const plan = planAnimations(part, undefined, animator);
    expect(plan.map((b) => b.nodeName).sort()).toEqual(Object.keys(contract.anim).map((n) => `anim.${n}`).sort());
    const envelope = () => {
      gltf.scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(gltf.scene, true);
      expect(box.max.y).toBeLessThanOrEqual(contract.yMin + contract.height + EPS);
      expect(box.min.y).toBeGreaterThanOrEqual(contract.yMin - EPS);
      expect(box.min.x).toBeGreaterThanOrEqual(-contract.footprint[0] / 2 - EPS);
      expect(box.max.x).toBeLessThanOrEqual(contract.footprint[0] / 2 + EPS);
      expect(box.min.z).toBeGreaterThanOrEqual(-contract.footprint[1] / 2 - EPS);
      expect(box.max.z).toBeLessThanOrEqual(contract.footprint[1] / 2 + EPS);
    };
    for (const binding of plan) {
      const node = nodes[binding.nodeName]!;
      const spec = part.params[binding.param]!;
      const child = node.children.find((c) => c instanceof Mesh) ?? node.children[0]!;
      const pose = () => {
        gltf.scene.updateMatrixWorld(true);
        return { at: child.getWorldPosition(new Vector3()), turn: child.getWorldQuaternion(new Quaternion()) };
      };
      // Every param at its default, every boolean gate (`running`) on, the bound param at 0 / full scale.
      const on: Record<string, unknown> = {};
      for (const [name, s] of Object.entries(part.params)) on[name] = s.type === 'boolean' && name !== part.alarmParam ? true : s.default;
      on[binding.param] = spec.type === 'boolean' ? true : spec.max ?? 1;
      const off = { ...on, [binding.param]: spec.type === 'boolean' ? false : spec.min ?? 0 };
      const rest = { position: node.position.clone(), rotation: node.rotation.clone() };

      if (binding.animator.id === 'spin') {
        applyAnimations(plan, nodes, on, 0.25, 0.25);
        const axis = binding.settings.axis as 'x' | 'y' | 'z';
        expect(node.rotation[axis]).not.toBeCloseTo(rest.rotation[axis], 3);
        for (const other of (['x', 'y', 'z'] as const).filter((a) => a !== axis)) expect(node.rotation[other]).toBeCloseTo(rest.rotation[other], 6);
        expect(node.position.distanceTo(rest.position)).toBe(0);
        envelope();
        const turned = node.rotation[axis];
        const gate = binding.settings.enableParam as string;
        expect(gate, 'a spinning part names its run gate').toBeTruthy();
        applyAnimations(plan, nodes, { ...on, [gate]: false }, 0.25, 0.5);
        expect(node.rotation[axis]).toBe(turned);
        node.rotation.copy(rest.rotation);
        continue;
      }

      applyAnimations(plan, nodes, off, 0.016, 0);
      const closed = pose();
      envelope();
      applyAnimations(plan, nodes, on, 0.016, 0.016);
      const open = pose();
      envelope();
      const moved = open.at.distanceTo(closed.at) > EPS || open.turn.angleTo(closed.turn) > EPS;
      expect(moved, `${binding.nodeName} moves between 0 and full scale`).toBe(true);
      // Absolute (restoring) animators: back to the same closed pose, and no drift over frames.
      for (let i = 0; i < 10; i++) applyAnimations(plan, nodes, on, 0.016, i);
      expect(pose().at.distanceTo(open.at)).toBeLessThan(1e-9);
      applyAnimations(plan, nodes, off, 0.016, 11);
      const again = pose();
      expect(again.at.distanceTo(closed.at)).toBeLessThan(1e-9);
      expect(again.turn.angleTo(closed.turn)).toBeLessThan(1e-9);
      node.position.copy(rest.position);
      node.rotation.copy(rest.rotation);
    }
  });
});

describe('the pilot animations match their scripts', () => {
  // Docstrings of blender/parts/process/<slug>.py: the authoritative motion.
  const load = async (slug: string) => {
    const bytes = readFileSync(join(models, `${slug}.glb`));
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
    const nodes: Record<string, Object3D> = {};
    gltf.scene.traverse((node) => { if (authoredName(node).startsWith('anim.')) nodes[authoredName(node)] = node; });
    const part = PROCESS_PART_DEFINITIONS.find((p) => p.id === `process:${slug}`)!;
    return { nodes, part, plan: planAnimations(part, undefined, animator) };
  };

  it('valve-ball: modelled open; closed turns the lever a quarter turn about Y', async () => {
    const { nodes, plan } = await load('valve-ball');
    const handle = nodes['anim.handle']!;
    applyAnimations(plan, nodes, { open: true }, 0.016, 0);
    expect(handle.rotation.y).toBeCloseTo(0, 9);
    applyAnimations(plan, nodes, { open: false }, 0.016, 0);
    expect(Math.abs(handle.rotation.y)).toBeCloseTo(Math.PI / 2, 9);
    applyAnimations(plan, nodes, { open: 0.5 }, 0.016, 0);
    expect(Math.abs(handle.rotation.y)).toBeCloseTo(Math.PI / 4, 9);
  });

  it('valve-control: modelled closed; the stem rises 0.08 along +Y at 100 %', async () => {
    const { nodes, plan } = await load('valve-control');
    const stem = nodes['anim.stem']!;
    const y0 = stem.position.y;
    applyAnimations(plan, nodes, { position: 100 }, 0.016, 0);
    expect(stem.position.y - y0).toBeCloseTo(0.08, 9);
    applyAnimations(plan, nodes, { position: 25 }, 0.016, 0);
    expect(stem.position.y - y0).toBeCloseTo(0.02, 9);
    applyAnimations(plan, nodes, { position: 0 }, 0.016, 0);
    expect(stem.position.y).toBeCloseTo(y0, 9);
  });

  it('motor: the shaft spins about X from speed, only while running', async () => {
    const { nodes, plan } = await load('motor');
    const shaft = nodes['anim.shaft']!;
    applyAnimations(plan, nodes, { speed: 100, running: false }, 1, 1);
    expect(shaft.rotation.x).toBe(0);
    // 100 % * rpmScale 0.6 = 60 rpm = one turn per second.
    applyAnimations(plan, nodes, { speed: 100, running: true }, 0.25, 1.25);
    expect(shaft.rotation.x).toBeCloseTo(Math.PI / 2, 9);
    expect(shaft.rotation.y).toBe(0);
    expect(shaft.rotation.z).toBe(0);
  });
});

const blender = findBlender();
// HOLODECK_REQUIRE_BLENDER=1 (set by .github/workflows/blender-drift.yml, holodeck#136): the job
// exists to run the rebuild below, so a missing Blender must fail it, not skip it quietly.
it.runIf(process.env.HOLODECK_REQUIRE_BLENDER === '1')('finds Blender when HOLODECK_REQUIRE_BLENDER=1', () => {
  expect(blender, 'Blender not found: set $BLENDER or put blender on PATH').toBeTruthy();
});
describe.skipIf(!blender)('deterministic Blender rebuild (requires Blender)', () => {
  const directory = mkdtempSync(join(tmpdir(), 'holodeck-process-'));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  // Same rule as library-cloud: BIN chunk byte-identical, glTF JSON equal
  // within 1e-6 (node quaternions differ by a float32 ULP across macOS and
  // Linux; holodeck#136, editor-2.5d-react/scripts/glb-compare.mjs).
  it.each(PROCESS_PART_DEFINITIONS.map(slugOf))('%s matches its authored script', async (slug) => {
    await buildPart(slug, { outDir: directory, blender, quiet: true });
    const rebuilt = readFileSync(join(directory, `${slug}.glb`));
    expect(compareGlb(rebuilt, readFileSync(join(models, `${slug}.glb`))).problems).toEqual([]);
  }, 60_000);
});
