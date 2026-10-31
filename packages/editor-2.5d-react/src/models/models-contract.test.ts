import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { materialFinishForName } from '../../assets/process/apply-style';
import { parseGlbJson, sceneBounds } from './glb-json';

/**
 * Contract every Blender-built part must meet, so a new parts/<name>.py is
 * covered without writing a test first. Part-specific dimensions belong in
 * <part>-glb.test.ts (see valve-glb.test.ts).
 */
const PKG = resolve(__dirname, '../..');
const MODELS = join(PKG, 'assets/models');
const PARTS_SRC = resolve(PKG, '../../blender/parts');
const glbs = readdirSync(MODELS).filter((f) => f.endsWith('.glb')).sort();

describe('assets/models contract', () => {
  it('has a GLB for every Blender part script and a script for every GLB', () => {
    const scripts = readdirSync(PARTS_SRC).filter((f) => f.endsWith('.py')).map((f) => f.replace(/\.py$/, ''));
    expect(glbs.map((f) => f.replace(/\.glb$/, ''))).toEqual(scripts.sort());
  });

  describe.each(glbs)('%s', (file) => {
    const gltf = parseGlbJson(new Uint8Array(readFileSync(join(MODELS, file))));
    const names = gltf.nodes.map((n) => n.name ?? '');

    it('uses only hd.* finish materials', () => {
      expect(gltf.materials?.length ?? 0).toBeGreaterThan(0);
      for (const material of gltf.materials ?? []) {
        expect(materialFinishForName(material.name), material.name).not.toBeNull();
      }
    });

    it('declares at least one port.* empty and no camera/light nodes', () => {
      expect(names.some((n) => n.startsWith('port.'))).toBe(true);
      for (const node of gltf.nodes) {
        expect((node as { camera?: number }).camera, node.name).toBeUndefined();
        expect((node as { extensions?: unknown }).extensions, node.name).toBeUndefined();
      }
    });

    it('keeps port.* empties mesh-free', () => {
      for (const node of gltf.nodes.filter((n) => n.name?.startsWith('port.'))) {
        expect(node.mesh, node.name).toBeUndefined();
        expect(node.children ?? [], node.name).toHaveLength(0);
      }
    });

    it('sits on or above the floor at a scene-sensible size', () => {
      const box = sceneBounds(gltf);
      const size = box.max.clone().sub(box.min);
      // Parts sit beside 0.1-radius pipes: anything over 5 units or under
      // 0.05 is almost certainly a unit or axis-conversion mistake.
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(5);
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.05);
      expect(box.min.y).toBeGreaterThan(-1);
    });
  });

  it('finds the part sources directory', () => {
    expect(existsSync(PARTS_SRC)).toBe(true);
  });
});
