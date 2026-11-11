/**
 * The Blender part tools end to end over MCP, with a FAKE Blender (test-glb.ts)
 * and a throwaway repo, so they run everywhere and fast: the gates, name and
 * path rules, overwrite rules, timeouts, failures, validation, preview and
 * install (including the regenerated model map). Real Blender: blender-real.test.ts.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { MAX_PART_SOURCE_BYTES } from './limits';
import { modelIndexSource } from './part-files';
import { SceneRenderer, type ModelRenderInput } from './render';
import { makeRepo, partGlb, twoColourPng, writeFakeBlender } from './test-glb';
import { harness, tempDir, type Harness } from './test-support';

/** Records model renders; answers with a PNG, or throws what a real renderer would. */
class FakeRenderer extends SceneRenderer {
  calls: { model: ModelRenderInput; size: { width: number; height: number } }[] = [];
  failWith: ToolError | null = null;
  override renderModel(model: ModelRenderInput, size: { width: number; height: number }): Promise<Buffer> {
    this.calls.push({ model, size });
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(twoColourPng());
  }
}

let dir: string;
let cleanup: () => Promise<void>;
let repo: string;
let fake: string;
let good: string;
let h: Harness;
let renderer: FakeRenderer;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  repo = await makeRepo(dir);
  fake = await writeFakeBlender(dir);
  good = join(dir, 'good.glb');
  await writeFile(good, partGlb());
});
afterEach(async () => {
  await h?.close();
  await cleanup();
});

const open = async (opts: { tier?: 'read' | 'author' | 'exec'; allow?: boolean; binary?: string | null; timeoutMs?: number } = {}) => {
  renderer = new FakeRenderer();
  h = await harness({ tier: opts.tier ?? 'exec', renderer, blender: { allow: opts.allow ?? true, binary: opts.binary === undefined ? fake : opts.binary, repoDir: repo, timeoutMs: opts.timeoutMs } });
  return h;
};
const script = (marker: string) => `# a part\n${marker}\nimport holodeck_bpy as hd\n`;
const goodScript = () => script(`# FAKE: copy ${good}`);
const images = async (name: string, args: Record<string, unknown>) => {
  const raw = (await h.client.callTool({ name, arguments: args })) as CallToolResult;
  return { raw, images: raw.content.filter((c) => c.type === 'image'), texts: raw.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])) };
};
const partsDir = () => join(repo, 'blender/parts');
const modelsDir = () => join(repo, 'packages/editor-2.5d-react/assets/models');

describe('gates', () => {
  it('below tier exec the run tools refuse with the tier; the env gate is checked too', async () => {
    await open({ tier: 'author' });
    for (const [tool, args] of [
      ['blender_build_part', { name: 'mixer', source: goodScript() }],
      ['blender_preview', { name: 'valve' }],
      ['part_install', { name: 'mixer' }],
    ] as const) {
      const r = await h.call(tool, args);
      expect(r.data.error?.code, tool).toBe('tier');
      expect(r.text).toContain('HOLODECK_MCP_TIER=exec');
    }
    await expect(readFile(join(partsDir(), 'mixer.py'))).rejects.toThrow();
  });

  it('tier exec without HOLODECK_MCP_ALLOW_BLENDER=1 refuses and writes nothing', async () => {
    await open({ allow: false });
    for (const [tool, args] of [
      ['blender_build_part', { name: 'mixer', source: goodScript() }],
      ['blender_preview', { name: 'valve' }],
      ['part_install', { name: 'mixer' }],
    ] as const) {
      const r = await h.call(tool, args);
      expect(r.data.error?.code, tool).toBe('blender_disabled');
      expect(r.text).toContain('HOLODECK_MCP_ALLOW_BLENDER=1');
    }
    await expect(readFile(join(partsDir(), 'mixer.py'))).rejects.toThrow();
  });

  it('the allow flag defaults from the environment, and only "1" opens it', async () => {
    const { PartWorkbench } = await import('./part-workbench');
    expect(new PartWorkbench({ env: { HOLODECK_MCP_ALLOW_BLENDER: '1' } }).allowed).toBe(true);
    expect(new PartWorkbench({ env: { HOLODECK_MCP_ALLOW_BLENDER: 'true' } }).allowed).toBe(false);
    expect(new PartWorkbench({ env: {} }).allowed).toBe(false);
    expect(new PartWorkbench({ env: { HOLODECK_MCP_REPO: repo } }).layout.root).toBe(repo);
  });

  it('blender_status reports Blender, the gate and the repo at any tier; never an error', async () => {
    await open({ tier: 'read', allow: false });
    const r = await h.call('blender_status');
    expect(r.isError, r.text).toBe(false);
    expect(r.data.blender).toEqual({ found: true, path: fake, source: 'option', version: 'Blender 9.9.9 (fake)' });
    expect(r.data.gate).toMatchObject({ open: false, tier: 'read', allowBlender: false });
    expect((r.data.gate as { reasons: string[] }).reasons).toHaveLength(2);
    expect(r.data.scripts).toEqual(['valve']);
    expect(r.data.models).toEqual(['valve']);
    expect(r.data.hints).toEqual([expect.stringContaining('HOLODECK_MCP_ALLOW_BLENDER=1')]);
  });

  it('blender_status without Blender says how to get it', async () => {
    await open({ binary: null });
    const r = await h.call('blender_status');
    expect(r.data.blender).toMatchObject({ found: false, path: null });
    expect(r.data.gate).toMatchObject({ open: true, reasons: [] });
    expect(r.data.hints).toEqual([expect.stringContaining('$BLENDER')]);
  });
});

describe('blender_build_part', () => {
  it('writes the script, builds to scratch, validates and returns the Workbench preview', async () => {
    await open();
    const { raw, images: pics, texts } = await images('blender_build_part', { name: 'mixer', source: goodScript() });
    expect(raw.isError, texts.join('\n')).toBeFalsy();
    expect(pics).toHaveLength(1);
    expect(texts[0]).toMatch(/Workbench preview of mixer/);
    const data = raw.structuredContent as Record<string, any>;
    expect(data).toMatchObject({ name: 'mixer', script: 'blender/parts/mixer.py', overwrote: false, validation: { ok: true, problems: [] } });
    expect(data.log.at(-1)).toMatch(/\[holodeck\] wrote .*mixer\.glb$/);
    expect(data.glb.path).not.toContain(repo); // scratch, not assets/models
    expect(await readFile(join(partsDir(), 'mixer.py'), 'utf8')).toBe(goodScript());
    await expect(readFile(join(modelsDir(), 'mixer.glb'))).rejects.toThrow();
    // Blender ran from blender/ with the build-parts.mjs flags.
    const rec = JSON.parse(await readFile(`${data.glb.path}.run.json`, 'utf8'));
    expect(rec.cwd).toBe(await import('node:fs/promises').then((fs) => fs.realpath(join(repo, 'blender'))));
    expect(rec.argv).toEqual(['-b', '--factory-startup', '--python-exit-code', '1', '--python', join(partsDir(), 'mixer.py'), '--', '--out', data.glb.path, '--preview', data.glb.path.replace(/\.glb$/, '.png')]);
  });

  it('preview: false returns no image', async () => {
    await open();
    const { images: pics, raw } = await images('blender_build_part', { name: 'mixer', source: goodScript(), preview: false });
    expect(raw.isError).toBeFalsy();
    expect(pics).toHaveLength(0);
  });

  it('a build that breaks the contract still succeeds, with the problems and next steps', async () => {
    await open();
    const bad = join(dir, 'bad.glb');
    await writeFile(bad, partGlb((j) => (j.materials = [{ name: 'steel' }])));
    const r = await h.call('blender_build_part', { name: 'mixer', source: script(`# FAKE: copy ${bad}`), preview: false });
    expect(r.isError).toBe(false);
    expect(r.data.validation).toMatchObject({ ok: false, problems: [expect.stringContaining('"steel"')] });
    expect(r.data.next).toEqual([expect.stringContaining('fix the problems')]);
  });

  it('refuses bad names and path escapes before touching anything', async () => {
    await open();
    for (const name of ['../escape', 'a/b', '.hidden', 'Mixer', 'my_part', 'x.py', 'cloud', 'x'.repeat(49)]) {
      const r = await h.call('blender_build_part', { name, source: goodScript() });
      expect(r.isError, name).toBe(true);
    }
    expect((await import('node:fs/promises').then((fs) => fs.readdir(partsDir()))).sort()).toEqual(['valve.py']);
    expect((await import('node:fs/promises').then((fs) => fs.readdir(dir))).includes('escape.py')).toBe(false);
  });

  it('caps the script size (schema) and refuses a NUL', async () => {
    await open();
    const big = await h.call('blender_build_part', { name: 'mixer', source: 'x'.repeat(MAX_PART_SOURCE_BYTES + 1) });
    expect(big.isError).toBe(true);
    // Under the character cap but over the byte cap (multi-byte characters).
    const wide = await h.call('blender_build_part', { name: 'mixer', source: 'é'.repeat(MAX_PART_SOURCE_BYTES / 2 + 1) });
    expect(wide.data.error?.code).toBe('too_large');
    const nul = await h.call('blender_build_part', { name: 'mixer', source: 'a\0b' });
    expect(nul.data.error?.code).toBe('invalid_request');
  });

  it('a shipped part is only replaced with overwrite: true; its own scripts rebuild freely', async () => {
    await open();
    const original = await readFile(join(partsDir(), 'valve.py'), 'utf8');
    const refused = await h.call('blender_build_part', { name: 'valve', source: goodScript() });
    expect(refused.data.error?.code).toBe('conflict');
    expect(refused.text).toContain('blender/parts/valve.py');
    expect(await readFile(join(partsDir(), 'valve.py'), 'utf8')).toBe(original);
    const replaced = await h.call('blender_build_part', { name: 'valve', source: goodScript(), overwrite: true, preview: false });
    expect(replaced.data).toMatchObject({ overwrote: true });

    expect((await h.call('blender_build_part', { name: 'mixer', source: goodScript(), preview: false })).isError).toBe(false);
    const again = await h.call('blender_build_part', { name: 'mixer', source: goodScript() + '# v2\n', preview: false });
    expect(again.isError, again.text).toBe(false);
    expect(again.data.overwrote).toBe(true);
  });

  it('a model installed without a script also counts as existing', async () => {
    await open();
    await writeFile(join(modelsDir(), 'orphan.glb'), partGlb());
    expect((await h.call('blender_build_part', { name: 'orphan', source: goodScript() })).data.error?.code).toBe('conflict');
  });

  it('a Python error returns the traceback; the script stays for the next try', async () => {
    await open();
    const r = await h.call('blender_build_part', { name: 'mixer', source: script('# FAKE: fail') });
    expect(r.data.error).toMatchObject({ code: 'blender_failed' });
    expect(r.data.error?.problems).toEqual(
      expect.arrayContaining(['Traceback (most recent call last):', 'RuntimeError: material "steel" is not hd.*', expect.stringContaining('fix it and call blender_build_part again')]),
    );
    expect(await readFile(join(partsDir(), 'mixer.py'), 'utf8')).toBe(script('# FAKE: fail'));
    expect((await h.call('part_validate', { name: 'mixer', source: 'build' })).data.error?.code).toBe('not_found');
  });

  it('exit 0 without a GLB is an error that names hd.run_part', async () => {
    await open();
    const r = await h.call('blender_build_part', { name: 'mixer', source: script('# no marker') });
    expect(r.data.error?.code).toBe('blender_failed');
    expect(r.text).toContain('hd.run_part');
  });

  it('a hung script is killed at the timeout (the server default; per call it is 5 s at least)', async () => {
    await open({ timeoutMs: 700 });
    const started = Date.now();
    const r = await h.call('blender_build_part', { name: 'mixer', source: script(`# FAKE: hang ${join(dir, 'pids.json')}`) });
    expect(r.data.error?.code).toBe('timeout');
    expect(r.text).toContain('0.7 s');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(h.context.parts.processes.active).toBe(0);
    expect((await h.call('blender_build_part', { name: 'mixer', source: goodScript(), timeoutMs: 100 })).isError).toBe(true);
  });

  it('no Blender: no_blender, and no script is written', async () => {
    await open({ binary: null });
    const r = await h.call('blender_build_part', { name: 'mixer', source: goodScript() });
    expect(r.data.error?.code).toBe('no_blender');
    await expect(readFile(join(partsDir(), 'mixer.py'))).rejects.toThrow();
  });
});

describe('part_validate', () => {
  it('checks this session\'s build, or the installed model, at tier read', async () => {
    await open();
    await h.call('blender_build_part', { name: 'mixer', source: goodScript(), preview: false });
    const build = await h.call('part_validate', { name: 'mixer' });
    expect(build.data).toMatchObject({ name: 'mixer', source: 'build', ok: true, stats: { triangles: 12, ports: ['in'] } });
    const tight = await h.call('part_validate', { name: 'mixer', maxTriangles: 5 });
    expect(tight.data).toMatchObject({ ok: false, problems: [expect.stringContaining('over the budget of 5')] });
    const installed = await h.call('part_validate', { name: 'valve' });
    expect(installed.data).toMatchObject({ source: 'installed', path: 'packages/editor-2.5d-react/assets/models/valve.glb', ok: true });
    expect((await h.call('part_validate', { name: 'nope' })).data.error?.code).toBe('not_found');
    expect((await h.call('part_validate', { name: '../valve' })).isError).toBe(true);
  });
});

describe('blender_preview', () => {
  it('Workbench (from the build) + styled render of the GLB placed by its bounds', async () => {
    await open();
    await h.call('blender_build_part', { name: 'mixer', source: goodScript() });
    const { raw, images: pics, texts } = await images('blender_preview', { name: 'mixer', width: 320, height: 200 });
    expect(raw.isError, texts.join('\n')).toBeFalsy();
    expect(pics).toHaveLength(2);
    expect(texts.slice(0, 2)).toEqual([expect.stringMatching(/^Workbench preview of mixer/), expect.stringMatching(/^mixer in the Holodeck style/)]);
    expect(renderer.calls).toHaveLength(1);
    expect(renderer.calls[0]!.size).toEqual({ width: 320, height: 200 });
    expect(renderer.calls[0]!.model).toMatchObject({ footprint: { w: 1, h: 1 }, height: 1, label: 'mixer' });
    expect(Buffer.from(renderer.calls[0]!.model.glb)).toEqual(Buffer.from(partGlb()));
  });

  it('an installed part: Workbench from its script (a scratch run), styled from the installed GLB', async () => {
    await open();
    await writeFile(join(partsDir(), 'valve.py'), goodScript());
    const { raw, images: pics } = await images('blender_preview', { name: 'valve' });
    expect(raw.isError).toBeFalsy();
    expect(pics).toHaveLength(2);
    expect((raw.structuredContent as Record<string, unknown>).source).toBe('installed');
    // The repo is untouched: the run wrote to scratch only.
    expect(Buffer.from(renderer.calls[0]!.model.glb)).toEqual(await readFile(join(modelsDir(), 'valve.glb')));
  });

  it('no WebGPU is an explicit error, never a blank image; styled: false skips the browser', async () => {
    await open();
    await h.call('blender_build_part', { name: 'mixer', source: goodScript(), preview: false });
    renderer.failWith = new ToolError('WebGPU is not available in this Chromium', [], 'unsupported');
    const r = await images('blender_preview', { name: 'mixer' });
    expect(r.raw.isError).toBe(true);
    expect(r.images).toHaveLength(0);
    expect(JSON.stringify(r.raw.structuredContent)).toContain('"unsupported"');
    const only = await images('blender_preview', { name: 'mixer', styled: false });
    expect(only.raw.isError).toBeFalsy();
    expect(only.images).toHaveLength(1);
    expect((await h.call('blender_preview', { name: 'mixer', styled: false, workbench: false })).data.error?.code).toBe('invalid_request');
  });
});

describe('part_install', () => {
  it('copies the build into assets/models and registers it in the model map', async () => {
    await open();
    await h.call('blender_build_part', { name: 'mixer', source: goodScript(), preview: false });
    const r = await h.call('part_install', { name: 'mixer' });
    expect(r.isError, r.text).toBe(false);
    expect(r.data).toMatchObject({
      name: 'mixer',
      model: 'packages/editor-2.5d-react/assets/models/mixer.glb',
      script: 'blender/parts/mixer.py',
      index: 'packages/editor-2.5d-react/assets/models/index.ts',
      registered: true,
      replaced: false,
    });
    expect(await readFile(join(modelsDir(), 'mixer.glb'))).toEqual(Buffer.from(partGlb()));
    expect(await readFile(join(modelsDir(), 'index.ts'), 'utf8')).toBe(modelIndexSource(['mixer', 'valve']));
    expect((await h.call('blender_status')).data.models).toEqual(['mixer', 'valve']);

    // Again: exists -> conflict; overwrite replaces the GLB, the map is unchanged.
    expect((await h.call('part_install', { name: 'mixer' })).data.error?.code).toBe('conflict');
    const again = await h.call('part_install', { name: 'mixer', overwrite: true });
    expect(again.data).toMatchObject({ registered: false, replaced: true });
  });

  it('refuses without a build, with a failing build, or when the script changed since', async () => {
    await open();
    expect((await h.call('part_install', { name: 'mixer' })).data.error?.code).toBe('not_found');

    const bad = join(dir, 'bad.glb');
    await writeFile(bad, partGlb((j) => (j.nodes[1].name = 'socket')));
    await h.call('blender_build_part', { name: 'mixer', source: script(`# FAKE: copy ${bad}`), preview: false });
    const invalid = await h.call('part_install', { name: 'mixer' });
    expect(invalid.data.error).toMatchObject({ code: 'invalid_part', problems: [expect.stringContaining('no port.* empty')] });
    await expect(readFile(join(modelsDir(), 'mixer.glb'))).rejects.toThrow();

    await h.call('blender_build_part', { name: 'mixer', source: goodScript(), preview: false });
    await writeFile(join(partsDir(), 'mixer.py'), goodScript() + '# edited by hand\n');
    expect((await h.call('part_install', { name: 'mixer' })).data.error).toMatchObject({ code: 'conflict', message: expect.stringContaining('changed since it was built') });
    await expect(readFile(join(modelsDir(), 'mixer.glb'))).rejects.toThrow();
  });

  it('refuses (and copies nothing) when index.ts has hand edits the generator would drop', async () => {
    await open();
    await h.call('blender_build_part', { name: 'mixer', source: goodScript(), preview: false });
    const index = join(modelsDir(), 'index.ts');
    await writeFile(index, (await readFile(index, 'utf8')) + '\n// hand edit\n');
    const r = await h.call('part_install', { name: 'mixer' });
    expect(r.data.error).toMatchObject({ code: 'conflict', message: expect.stringContaining('index.ts') });
    await expect(readFile(join(modelsDir(), 'mixer.glb'))).rejects.toThrow();
  });

  it('closing the server removes the scratch builds', async () => {
    await open();
    const r = await h.call('blender_build_part', { name: 'mixer', source: goodScript(), preview: false });
    const glb = (r.data.glb as { path: string }).path;
    await readFile(glb);
    await h.close();
    await expect(readFile(glb)).rejects.toThrow();
    h = undefined as unknown as Harness;
  });
});
