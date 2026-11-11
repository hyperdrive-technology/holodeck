/** part_validate's contract check on hand-built GLBs (one per violation) and on every shipped part. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { footprintOf, parseGlb, validatePartGlb } from './glb';
import { DEFAULT_PART_TRIANGLES } from './limits';
import { defaultRepoRoot } from './part-files';
import { glbOf, partGlb } from './test-glb';

const problemsOf = (edit: (json: Record<string, any>) => void, options = {}) => validatePartGlb(partGlb(edit), options).problems;

describe('validatePartGlb', () => {
  it('passes a minimal good part and reports its stats', () => {
    const v = validatePartGlb(partGlb());
    expect(v).toMatchObject({ ok: true, problems: [], warnings: [] });
    expect(v.stats).toMatchObject({ triangles: 12, nodes: 2, meshes: 1, materials: ['hd.white'], ports: ['in'], anims: [] });
    expect(v.stats?.bounds).toEqual({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5], size: [1, 1, 1] });
  });

  it('passes every shipped part (the contract the asset tests enforce)', () => {
    const dir = join(defaultRepoRoot(), 'packages/editor-2.5d-react/assets/models');
    const files = readdirSync(dir).filter((f) => f.endsWith('.glb'));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const v = validatePartGlb(new Uint8Array(readFileSync(join(dir, f))));
      expect(v.problems, f).toEqual([]);
      expect(v.warnings, f).toEqual([]);
      expect(v.stats?.ports.length, f).toBeGreaterThan(0);
    }
  });

  it('a file that is not a GLB is one readable problem, never a throw', () => {
    expect(validatePartGlb(new Uint8Array([1, 2, 3])).problems).toEqual([expect.stringMatching(/shorter than/)]);
    const bad = partGlb();
    bad[0] = 0;
    expect(validatePartGlb(bad).problems).toEqual([expect.stringMatching(/bad magic/)]);
    const truncated = partGlb().subarray(0, 40);
    expect(validatePartGlb(truncated).problems).toEqual([expect.stringMatching(/header says/)]);
    const v1 = partGlb();
    new DataView(v1.buffer).setUint32(4, 1, true);
    expect(validatePartGlb(v1).problems).toEqual([expect.stringMatching(/version 1/)]);
    expect(validatePartGlb(glbOf([1, 2])).problems).toEqual(['the JSON chunk is not an object']);
    expect(validatePartGlb(new Uint8Array(Buffer.concat([Buffer.from(glbOf({}).subarray(0, 20)), Buffer.from('{nope')]))).ok).toBe(false);
  });

  it('materials: only hd.* finishes (suffixes like .001 are fine), at least one, every primitive has one', () => {
    expect(problemsOf((j) => (j.materials = [{ name: 'hd.white.001' }]))).toEqual([]);
    expect(problemsOf((j) => (j.materials = [{ name: 'steel' }]))).toEqual([expect.stringMatching(/material 0 "steel" is not an hd\.\* finish/)]);
    expect(problemsOf((j) => (j.materials = [{ name: 'hd.chrome' }]))).toEqual([expect.stringMatching(/"hd\.chrome" is not an hd\.\* finish/)]);
    expect(problemsOf((j) => delete j.materials)).toEqual(expect.arrayContaining([expect.stringMatching(/^no materials/)]));
    expect(problemsOf((j) => delete j.meshes[0].primitives[0].material)).toEqual([expect.stringMatching(/has no material/)]);
  });

  it('double-sided materials are a warning, not a violation', () => {
    const v = validatePartGlb(partGlb((j) => (j.materials[0].doubleSided = true)));
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([expect.stringMatching(/double-sided/)]);
  });

  it('ports: at least one, empties only, no children, unique, sane names', () => {
    expect(problemsOf((j) => (j.nodes[1].name = 'socket'))).toEqual([expect.stringMatching(/^no port\.\* empty/)]);
    expect(problemsOf((j) => (j.nodes[1].mesh = 0))).toEqual([expect.stringMatching(/"port\.in" must be an empty/)]);
    expect(
      problemsOf((j) => {
        j.nodes.push({ name: 'child' });
        j.nodes[1].children = [2];
      }),
    ).toEqual([expect.stringMatching(/"port\.in" must have no children/)]);
    expect(
      problemsOf((j) => {
        j.nodes.push({ name: 'port.in' });
        j.scenes[0].nodes.push(2);
      }),
    ).toEqual([expect.stringMatching(/declared twice/)]);
    expect(problemsOf((j) => (j.nodes[1].name = 'port.'))).toEqual([expect.stringMatching(/name after "port\." must be/)]);
  });

  it('anim pivots are empties and are reported', () => {
    const ok = validatePartGlb(
      partGlb((j) => {
        j.nodes.push({ name: 'anim.shaft', children: [0] });
        j.scenes[0].nodes = [2, 1];
      }),
    );
    expect(ok.problems).toEqual([]);
    expect(ok.stats?.anims).toEqual(['shaft']);
    expect(
      problemsOf((j) => {
        j.nodes.push({ name: 'anim.shaft', mesh: 0 });
        j.scenes[0].nodes.push(2);
      }),
    ).toEqual([expect.stringMatching(/"anim\.shaft" must be an empty/)]);
  });

  it('no cameras, lights, animations, skins, textures or required extensions', () => {
    expect(problemsOf((j) => (j.cameras = [{ type: 'orthographic' }]))).toEqual([expect.stringMatching(/1 camera/)]);
    expect(
      problemsOf((j) => {
        j.cameras = [{ type: 'orthographic' }];
        j.nodes.push({ name: 'cam', camera: 0 });
        j.scenes[0].nodes.push(2);
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/"cam" is a camera/)]));
    expect(
      problemsOf((j) => {
        j.nodes.push({ name: 'sun', extensions: { KHR_lights_punctual: { light: 0 } } });
        j.scenes[0].nodes.push(2);
      }),
    ).toEqual([expect.stringMatching(/"sun" is a light/)]);
    expect(problemsOf((j) => (j.animations = [{}]))).toEqual([expect.stringMatching(/animation/)]);
    expect(problemsOf((j) => (j.skins = [{}]))).toEqual([expect.stringMatching(/skin/)]);
    expect(problemsOf((j) => (j.images = [{}]))).toEqual([expect.stringMatching(/untextured/)]);
    expect(problemsOf((j) => (j.extensionsRequired = j.extensionsUsed = ['KHR_draco_mesh_compression']))).toEqual([expect.stringMatching(/KHR_draco_mesh_compression is required/)]);
    const used = validatePartGlb(partGlb((j) => (j.extensionsUsed = ['KHR_materials_unlit'])));
    expect(used.ok).toBe(true);
    expect(used.warnings).toEqual([expect.stringMatching(/KHR_materials_unlit is used/)]);
  });

  it('triangle budget: default and per call; non-triangle primitives are refused', () => {
    expect(problemsOf((j) => (j.accessors[1].count = (DEFAULT_PART_TRIANGLES + 1) * 3))).toEqual([expect.stringMatching(/5001 triangles, over the budget of 5000/)]);
    expect(problemsOf(() => undefined, { maxTriangles: 10 })).toEqual([expect.stringMatching(/12 triangles, over the budget of 10/)]);
    // No indices: POSITION count / 3.
    expect(validatePartGlb(partGlb((j) => delete j.meshes[0].primitives[0].indices)).stats?.triangles).toBe(8);
    expect(problemsOf((j) => (j.meshes[0].primitives[0].mode = 1))).toEqual([expect.stringMatching(/mode 1/)]);
  });

  it('bounds: too big, too small, below the floor, nothing above it (Z-up)', () => {
    const box = (min: number[], max: number[]) => (j: Record<string, any>) => Object.assign(j.accessors[0], { min, max });
    expect(problemsOf(box([-3, 0, -0.5], [3, 1, 0.5]))).toEqual([expect.stringMatching(/6 units across \(max 5\)/)]);
    expect(
      problemsOf((j) => {
        box([-0.01, 0, -0.01], [0.01, 0.02, 0.01])(j);
        j.nodes[1].translation = [0, 0, 0];
      }),
    ).toEqual([expect.stringMatching(/only 0\.02 units across/)]);
    expect(problemsOf(box([-0.5, -1.5, -0.5], [0.5, 1, 0.5]))).toEqual([expect.stringMatching(/reaches y = -1\.5/)]);
    expect(problemsOf(box([-0.5, -1, -0.5], [0.5, 0, 0.5]))).toEqual(expect.arrayContaining([expect.stringMatching(/nothing is above the floor/)]));
  });

  it('bounds follow node transforms (translation, rotation, scale, matrix, parents)', () => {
    const lifted = validatePartGlb(partGlb((j) => (j.nodes[0].translation = [0, 0.5, 0])));
    expect(lifted.stats?.bounds?.max[1]).toBe(1.5);
    // 90 degrees about Z: the box's x and y swap.
    const s = Math.SQRT1_2;
    const turned = validatePartGlb(partGlb((j) => (j.nodes[0].rotation = [0, 0, s, s])));
    expect(turned.stats?.bounds?.min).toEqual([-1, -0.5, -0.5]);
    const scaled = validatePartGlb(partGlb((j) => (j.nodes[0].scale = [2, 1, 1])));
    expect(scaled.stats?.bounds?.size).toEqual([2, 1, 1]);
    const matrix = validatePartGlb(partGlb((j) => (j.nodes[0].matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.25, 0, 0, 1])));
    expect(matrix.stats?.bounds?.min[0]).toBe(-0.25);
    const parented = validatePartGlb(
      partGlb((j) => {
        j.nodes.push({ name: 'root', translation: [0, 0.25, 0], children: [0] });
        j.scenes[0].nodes = [2, 1];
      }),
    );
    expect(parented.stats?.bounds?.min[1]).toBe(0.25);
  });

  it('anchor: the origin must be on (or next to) the part', () => {
    expect(problemsOf((j) => (j.nodes[0].translation = [3, 0, 0]))).toEqual([expect.stringMatching(/origin \(the placement anchor\) is 2\.5 units outside/)]);
    // Within the 10% slack: fine.
    expect(problemsOf((j) => (j.nodes[0].translation = [0.55, 0, 0]))).toEqual([]);
  });

  it('broken structure: missing scene, dangling node, cycles, min/max-less accessors, version', () => {
    expect(problemsOf((j) => delete j.scenes)).toEqual(expect.arrayContaining([expect.stringMatching(/no scene 0/), expect.stringMatching(/no geometry/)]));
    expect(problemsOf((j) => j.scenes[0].nodes.push(9))).toEqual([expect.stringMatching(/node 9 does not exist/)]);
    expect(problemsOf((j) => (j.nodes[0].children = [0]))).toEqual(expect.arrayContaining([expect.stringMatching(/reachable twice/)]));
    expect(problemsOf((j) => delete j.accessors[0].min)).toEqual(expect.arrayContaining([expect.stringMatching(/lacks min \/ max/)]));
    expect(problemsOf((j) => (j.asset.version = '1.0'))).toEqual([expect.stringMatching(/asset\.version/)]);
  });

  it('lists every problem at once', () => {
    const problems = problemsOf((j) => {
      j.materials = [{ name: 'steel' }];
      j.nodes[1].name = 'socket';
      j.cameras = [{}];
    });
    expect(problems).toHaveLength(3);
  });
});

describe('parseGlb', () => {
  it('reads the JSON chunk; a second chunk must be BIN', () => {
    expect(parseGlb(partGlb()).asset?.version).toBe('2.0');
    const glb = Buffer.from(partGlb());
    const extra = Buffer.alloc(8);
    extra.writeUInt32LE(0, 0);
    extra.writeUInt32LE(0x12345678, 4);
    const two = Buffer.concat([glb, extra]);
    two.writeUInt32LE(two.byteLength, 8);
    expect(() => parseGlb(new Uint8Array(two))).toThrow(/second GLB chunk is not BIN/);
  });
});

describe('footprintOf', () => {
  it('covers the box around the origin in whole cells, with the top as height', () => {
    expect(footprintOf({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] })).toEqual({ w: 1, h: 1, height: 1 });
    // Off-centre: the footprint is centred on the origin, so it doubles the far side.
    expect(footprintOf({ min: [-0.2, -0.3, -0.1], max: [1.2, 0.05, 0.1] })).toEqual({ w: 3, h: 1, height: 0.1 });
  });
});
