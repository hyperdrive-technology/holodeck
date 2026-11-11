/** Part names, the repo files the Blender tools may touch, and the generated model map. */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { MAX_PART_NAME_LENGTH } from './limits';
import {
  defaultRepoRoot,
  fileExists,
  installedModels,
  modelIdentifier,
  modelIndexSource,
  partNameProblem,
  partScripts,
  readRepoFile,
  repoLayout,
  writeRepoFile,
} from './part-files';
import { tempDir } from './test-support';

describe('part names', () => {
  it('accepts lower-case words joined by "-" (like the shipped brite-tank)', () => {
    for (const ok of ['mixer', 'brite-tank', 'plate-heat-exchanger', 'pump2', 'a', 'x'.repeat(MAX_PART_NAME_LENGTH), 'valve-v2']) expect(partNameProblem(ok), ok).toBeNull();
  });

  it('refuses paths, hidden files, other spellings and reserved names', () => {
    const bad = [
      '',
      '../valve',
      'parts/valve',
      'a/b',
      'a\\b',
      '.hidden',
      'valve.py',
      'Valve',
      'my_part',
      'a--b',
      '-a',
      'a-',
      'a-1b',
      '1valve',
      'mixer ',
      'mi xer',
      'a\0b',
      'x'.repeat(MAX_PART_NAME_LENGTH + 1),
      'cloud',
      'holodeck-bpy',
      'index',
      'brewery',
      'café',
    ];
    for (const name of bad) expect(partNameProblem(name), JSON.stringify(name)).not.toBeNull();
    expect(partNameProblem(42)).toBe('name: required');
  });
});

describe('model map (assets/models/index.ts)', () => {
  it('the generator reproduces the checked-in file byte for byte', () => {
    const layout = repoLayout(defaultRepoRoot());
    const names = ['brite-tank', 'fermenter', 'heat-exchanger', 'kettle', 'mash-tun', 'pump', 'valve'];
    expect(modelIndexSource(names)).toBe(readFileSync(layout.modelIndex, 'utf8'));
  });

  it('adds a model in sorted order, with a quoted key and camelCase binding when needed', () => {
    const text = modelIndexSource(['valve', 'plate-heat-exchanger', 'mixer']);
    expect(text).toContain("import mixer from './mixer.glb?url';\nimport plateHeatExchanger from './plate-heat-exchanger.glb?url';\nimport valve from './valve.glb?url';");
    expect(text).toContain("  mixer,\n  'plate-heat-exchanger': plateHeatExchanger,\n  valve,\n});");
  });

  it('reserved words get a suffix; colliding bindings are refused', () => {
    expect(modelIdentifier('switch')).toBe('switchGlb');
    expect(modelIdentifier('new-tank')).toBe('newTank');
    expect(modelIndexSource(['switch'])).toContain("import switchGlb from './switch.glb?url';\n");
    expect(modelIndexSource(['switch'])).toContain('  switch: switchGlb,\n');
    expect(() => modelIndexSource(['switch', 'switch-glb'])).toThrow(/would both import as switchGlb/);
    expect(() => modelIndexSource(['../x'])).toThrow(ToolError);
  });
});

describe('repo files', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ dir, cleanup } = await tempDir());
    await mkdir(join(dir, 'repo/blender/parts'), { recursive: true });
    await mkdir(join(dir, 'repo/packages/editor-2.5d-react/assets/models'), { recursive: true });
  });
  afterEach(() => cleanup());
  const layout = () => repoLayout(join(dir, 'repo'));

  it('writes atomically and reads back with a size cap', async () => {
    const target = join(layout().partsDir, 'mixer.py');
    await writeRepoFile(layout(), target, 'print(1)\n');
    expect(await readFile(target, 'utf8')).toBe('print(1)\n');
    await writeRepoFile(layout(), target, 'print(2)\n');
    expect((await readRepoFile(layout(), target, 100)).toString()).toBe('print(2)\n');
    await expect(readRepoFile(layout(), target, 3)).rejects.toMatchObject({ code: 'too_large' });
    await expect(readRepoFile(layout(), join(layout().partsDir, 'nope.py'), 100)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('never writes through a symlink, and refuses a folder that resolves outside the repo', async () => {
    const outside = join(dir, 'outside.py');
    await writeFile(outside, 'secret');
    await symlink(outside, join(layout().partsDir, 'evil.py'));
    await expect(writeRepoFile(layout(), join(layout().partsDir, 'evil.py'), 'x')).rejects.toMatchObject({ code: 'invalid_path' });
    expect(await readFile(outside, 'utf8')).toBe('secret');

    await mkdir(join(dir, 'elsewhere'));
    await mkdir(join(dir, 'repo2/blender'), { recursive: true });
    await symlink(join(dir, 'elsewhere'), join(dir, 'repo2/blender/parts'));
    const escaped = repoLayout(join(dir, 'repo2'));
    await expect(writeRepoFile(escaped, join(escaped.partsDir, 'a.py'), 'x')).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('a missing folder is a clear no_repo error', async () => {
    const missing = repoLayout(join(dir, 'nothing-here'));
    await expect(writeRepoFile(missing, join(missing.partsDir, 'a.py'), 'x')).rejects.toMatchObject({ code: 'no_repo' });
  });

  it('fileExists: false when absent, refuses a folder in the way', async () => {
    expect(await fileExists(join(layout().partsDir, 'none.py'))).toBe(false);
    await mkdir(join(layout().partsDir, 'dir.py'));
    await expect(fileExists(join(layout().partsDir, 'dir.py'))).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('lists top-level scripts (not _private, not cloud/) and models', async () => {
    const l = layout();
    await mkdir(join(l.partsDir, 'cloud'));
    for (const f of ['b.py', 'a.py', '_helper.py', 'notes.txt', 'cloud/server.py']) await writeFile(join(l.partsDir, f), '');
    for (const f of ['z.glb', 'y.glb', 'index.ts']) await writeFile(join(l.modelsDir, f), '');
    expect(await partScripts(l)).toEqual(['a', 'b']);
    expect(await installedModels(l)).toEqual(['y', 'z']);
  });
});
