/**
 * The Blender part tools against a REAL Blender (5.2.2 LTS is what the parts
 * are tested with), in a throwaway repo with the real holodeck_bpy.py. Skipped
 * cleanly when no Blender is installed (CI has none); the fake-Blender suite
 * (part-tools.test.ts) covers the same tools everywhere.
 *
 * The styled preview also needs the studio build and a Chromium (as
 * scene_render does); without WebGPU it must be an explicit `unsupported`.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findBlender } from './blender';
import { validatePartGlb } from './glb';
import { modelIndexSource } from './part-files';
import { defaultStudioDist, findChromium, isUniform, SceneRenderer } from './render';
import { makeRepo } from './test-glb';
import { harness, tempDir, type Harness } from './test-support';

const blender = findBlender().path;
let chromium: string | null = null;
try {
  chromium = findChromium();
} catch {
  chromium = null;
}
const studioBuilt = existsSync(join(defaultStudioDist(), 'index.html'));

/** A tiny part through the real helper: an 8-sided drum (hd.white) with one port. */
const DRUM = `import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import holodeck_bpy as hd  # noqa: E402


def build():
    white = hd.material("hd.white")
    hd.cylinder("body", 0.4, 0.4, 0.8, 8, white, position_t=(0, 0.4, 0))
    hd.add_port("in", (0.4, 0.4, 0))


hd.run_part(build, "test-drum")
`;

describe.skipIf(!blender)('Blender part tools (real Blender)', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let repo: string;
  let h: Harness;
  beforeAll(async () => {
    ({ dir, cleanup } = await tempDir());
    repo = await makeRepo(dir);
    h = await harness({ tier: 'exec', renderer: new SceneRenderer(), blender: { allow: true, repoDir: repo } });
  });
  afterAll(async () => {
    await h?.close();
    await cleanup();
  });

  it('blender_status finds it and reads its version', async () => {
    const r = await h.call('blender_status');
    expect(r.data.blender).toMatchObject({ found: true, path: blender, version: expect.stringMatching(/^Blender \d+\.\d+/) });
    expect(r.data.gate).toMatchObject({ open: true });
  }, 60_000);

  it('builds a part: GLB in scratch, contract ok, a real Workbench preview', async () => {
    const raw = (await h.client.callTool({ name: 'blender_build_part', arguments: { name: 'test-drum', source: DRUM } })) as CallToolResult;
    const text = raw.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
    expect(raw.isError, text).toBeFalsy();
    const data = raw.structuredContent as Record<string, any>;
    expect(data.validation).toMatchObject({ ok: true, problems: [], warnings: [] });
    // 8 side quads (16 triangles) + two octagon caps (6 each).
    expect(data.validation.stats).toMatchObject({ triangles: 28, materials: ['hd.white'], ports: ['in'] });
    expect(data.validation.stats.bounds.min[1]).toBeCloseTo(0, 5);
    expect(data.validation.stats.bounds.max[1]).toBeCloseTo(0.8, 5);
    const image = raw.content.find((c) => c.type === 'image') as { data: string } | undefined;
    expect(image).toBeDefined();
    const png = Buffer.from(image!.data, 'base64');
    expect(PNG.sync.read(png).width).toBe(640);
    expect(isUniform(png)).toBe(false);
  }, 120_000);

  it('a Python error comes back as the traceback', async () => {
    const broken = DRUM.replace('hd.material("hd.white")', 'hd.material("steel")');
    const r = await h.call('blender_build_part', { name: 'test-broken', source: broken, preview: false });
    expect(r.data.error?.code).toBe('blender_failed');
    expect(r.data.error?.problems.join('\n')).toMatch(/Traceback[\s\S]*steel/);
  }, 120_000);

  it('installs the build and registers it in the model map', async () => {
    const r = await h.call('part_install', { name: 'test-drum' });
    expect(r.isError, r.text).toBe(false);
    const installed = await readFile(join(repo, 'packages/editor-2.5d-react/assets/models/test-drum.glb'));
    expect(validatePartGlb(new Uint8Array(installed)).ok).toBe(true);
    expect(await readFile(join(repo, 'packages/editor-2.5d-react/assets/models/index.ts'), 'utf8')).toBe(modelIndexSource(['test-drum', 'valve']));
  }, 60_000);

  it('rebuilding the same script is byte-identical (--factory-startup, empty scene)', async () => {
    const first = await readFile(join(repo, 'packages/editor-2.5d-react/assets/models/test-drum.glb'));
    const r = await h.call('blender_build_part', { name: 'test-drum', source: DRUM, preview: false });
    expect(r.isError, r.text).toBe(false);
    expect(await readFile((r.data.glb as { path: string }).path)).toEqual(first);
  }, 120_000);

  describe.skipIf(!chromium || !studioBuilt)('styled preview (studio build + Chromium)', () => {
    it('Workbench + the Holodeck style, or an explicit unsupported (never a blank image)', async () => {
      const raw = (await h.client.callTool({ name: 'blender_preview', arguments: { name: 'test-drum', width: 400, height: 300 } })) as CallToolResult;
      if (raw.isError) {
        expect(process.env.CI, JSON.stringify(raw.content)).toBeFalsy();
        expect(JSON.stringify(raw.structuredContent)).toContain('"unsupported"');
        return;
      }
      const pngs = raw.content.flatMap((c) => (c.type === 'image' ? [Buffer.from(c.data, 'base64')] : []));
      expect(pngs).toHaveLength(2);
      const styled = pngs[1]!;
      expect([PNG.sync.read(styled).width, PNG.sync.read(styled).height]).toEqual([400, 300]);
      expect(isUniform(styled)).toBe(false);
      if (process.env.HOLODECK_MCP_SHOTS) {
        await writeFile(join(process.env.HOLODECK_MCP_SHOTS, 'blender-preview-workbench.png'), pngs[0]!);
        await writeFile(join(process.env.HOLODECK_MCP_SHOTS, 'blender-preview-styled.png'), styled);
      }
    }, 240_000);
  });
});
