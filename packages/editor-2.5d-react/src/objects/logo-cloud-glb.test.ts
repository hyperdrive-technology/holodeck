/**
 * logoAnchorFromModel against the shipped @holodeck/library-cloud GLBs
 * (holodeck#138). Every top-face archetype keeps a flat, +Y-facing slot; the
 * billboard's `logo` empty is authored on the sign's front face (local +Y =
 * +Z normal, local -Z = image top = world +Y), so its plane must stand
 * upright and face +Z. The library-cloud GLB contract test pins the authored
 * basis; this pins what the editor makes of it.
 *
 * Reads the GLBs from the sibling package in this repo (no install-time dep).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { LOGO_LIFT, logoAnchorFromModel, logoPlaneQuaternion } from './logo';

const models = fileURLToPath(new URL('../../../library-cloud/assets/models/', import.meta.url));
const names = existsSync(models) ? readdirSync(models).filter((n) => n.endsWith('.glb')).map((n) => n.slice(0, -4)).sort() : [];

async function load(name: string) {
  const bytes = readFileSync(join(models, `${name}.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return (await new GLTFLoader().parseAsync(data, '')).scene;
}

describe('logo anchors on the library-cloud GLBs', () => {
  it('finds the library-cloud models', () => {
    expect(names.length).toBeGreaterThanOrEqual(26);
  });

  it.each(names.filter((n) => n !== 'billboard'))('%s: flat top-face slot (normal +Y, image top -Z)', async (name) => {
    const a = logoAnchorFromModel(await load(name))!;
    expect(a.source).toBe('node');
    expect(a.normal![1]).toBeCloseTo(1, 5);
    const q = logoPlaneQuaternion(a);
    expect(new Vector3(0, 0, 1).applyQuaternion(q).y).toBeCloseTo(1, 5);
    expect(new Vector3(0, 1, 0).applyQuaternion(q).z).toBeCloseTo(-1, 5);
  });

  it('billboard: upright slot on the +Z front face, image top up', async () => {
    expect(names, 'cloud:billboard GLB shipped by library-cloud').toContain('billboard');
    const scene = await load('billboard');
    const a = logoAnchorFromModel(scene)!;
    expect(a.source).toBe('node');
    expect(a.normal![0]).toBeCloseTo(0, 5);
    expect(a.normal![1]).toBeCloseTo(0, 5);
    expect(a.normal![2]).toBeCloseTo(1, 5);
    // Authored at Y=1.36 on the sign's front face (z=0.08), edge 1.00; lifted off the face along +Z.
    expect(a.position[1]).toBeCloseTo(1.36, 3);
    expect(a.position[2]).toBeCloseTo(0.08 + LOGO_LIFT, 3);
    expect(a.size).toBeCloseTo(1, 3);
    const q = logoPlaneQuaternion(a);
    expect(new Vector3(0, 0, 1).applyQuaternion(q).z).toBeCloseTo(1, 5);
    expect(new Vector3(0, 1, 0).applyQuaternion(q).y).toBeCloseTo(1, 5);
  });
});
