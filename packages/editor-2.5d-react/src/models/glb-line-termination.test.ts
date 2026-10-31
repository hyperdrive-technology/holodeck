import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { danglingLineEnds, edgeLineSegments } from '../../assets/process/line-termination';
import { HOLODECK_STYLE } from '../../assets/process/style';

/**
 * Des 2026-10-30: vertical lines must end on a horizontal ring. Checks the
 * creases `applyHolodeckStyle` would outline on a GLB (same EdgesGeometry,
 * same threshold rules: `hd_edge_threshold` extras, `hd_edges: false`),
 * over the whole model in world space so a line may end on another mesh's ring.
 */
async function glbEdgeSegments(name: string): Promise<Float32Array> {
  const buf = readFileSync(resolve(__dirname, '../../assets/models', `${name}.glb`));
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  const parts: Float32Array[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    let threshold = HOLODECK_STYLE.edges.threshold;
    let off = false;
    for (let p: typeof o | null = o; p; p = p.parent) {
      if (p.userData.hd_edges === false || p.userData.hd_edges === 0) off = true;
      if (typeof p.userData.hd_edge_threshold === 'number') {
        threshold = p.userData.hd_edge_threshold;
        break;
      }
    }
    if (!off) parts.push(edgeLineSegments(mesh.geometry, threshold, mesh.matrixWorld));
  });
  const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of parts) {
    out.set(a, i);
    i += a.length;
  }
  return out;
}

describe('GLB creases end on rings', () => {
  it('mixer.glb (the agitated vessel)', async () => {
    const segs = await glbEdgeSegments('mixer');
    expect(segs.length).toBeGreaterThan(600);
    expect(danglingLineEnds(segs)).toEqual([]);
  });
});
