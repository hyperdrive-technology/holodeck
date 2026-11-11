/** Finding and running Blender: discovery order, the invocation, environment, bounded logs, timeouts and process-group kills (fake Blender). */
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLENDER_ARGS, BlenderProcesses, blenderEnv, blenderVersion, failureSummary, findBlender, LogTail, MAC_BLENDER, parseBlenderVersion, tailLines } from './blender';
import { defaultRepoRoot } from './part-files';
import { writeFakeBlender } from './test-glb';
import { tempDir } from './test-support';

let dir: string;
let cleanup: () => Promise<void>;
let fake: string;
beforeAll(async () => {
  ({ dir, cleanup } = await tempDir());
  fake = await writeFakeBlender(dir);
});
afterAll(() => cleanup());

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('findBlender', () => {
  it('an explicit binary wins; null disables; a missing one is not found', () => {
    expect(findBlender({ BLENDER: '/nope' }, fake)).toEqual({ path: fake, source: 'option' });
    expect(findBlender({}, null)).toMatchObject({ path: null });
    expect(findBlender({}, join(dir, 'missing'))).toMatchObject({ path: null, reason: expect.stringContaining('does not exist') });
  });

  it('$BLENDER next, and a wrong $BLENDER is "not found", never a fall-through (build-parts.mjs order)', () => {
    expect(findBlender({ BLENDER: fake })).toEqual({ path: fake, source: 'BLENDER' });
    expect(findBlender({ BLENDER: join(dir, 'gone') })).toMatchObject({ path: null, reason: expect.stringContaining('$BLENDER=') });
  });

  it('then the macOS app bundle, then blender on PATH', () => {
    const found = findBlender({ PATH: dir });
    if (process.platform === 'darwin' && found.source === 'app') expect(found.path).toBe(MAC_BLENDER);
    else expect(found).toMatchObject({ path: null, reason: expect.stringContaining('no blender on PATH') });
  });

  it('uses the same flags as build-parts.mjs (the two invocations must not drift)', () => {
    const script = readFileSync(join(defaultRepoRoot(), 'packages/editor-2.5d-react/scripts/build-parts.mjs'), 'utf8');
    const flags = BLENDER_ARGS.map((a) => `'${a}'`).join(', ');
    expect(script).toContain(`[${flags}, '--python', script, '--', '--out', out]`);
    expect(script).toContain("'/Applications/Blender.app/Contents/MacOS/Blender'");
    expect(MAC_BLENDER).toBe('/Applications/Blender.app/Contents/MacOS/Blender');
  });
});

describe('blenderEnv', () => {
  it('passes only an allowlist (no tokens, no PYTHON*), and turns off user site-packages', () => {
    const env = blenderEnv({ PATH: '/bin', HOME: '/h', GITHUB_TOKEN: 'x', AWS_SECRET_ACCESS_KEY: 'y', PYTHONPATH: '/evil', HOLODECK_MCP_ALLOW_BLENDER: '1' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', PYTHONNOUSERSITE: '1' });
  });
});

describe('logs', () => {
  it('LogTail keeps only the last N bytes and counts the rest', () => {
    const tail = new LogTail(10);
    tail.push(Buffer.from('0123456789'));
    tail.push(Buffer.from('abcdef'));
    expect(tail.text()).toBe('6789abcdef');
    expect(tail.dropped).toBe(6);
    tail.push(Buffer.from('X'.repeat(25)));
    expect(tail.text()).toBe('X'.repeat(10));
    expect(tail.dropped).toBe(31);
  });

  it('tailLines and failureSummary pick the useful lines', () => {
    expect(tailLines('a\n\nb\nc\n', 2)).toEqual(['b', 'c']);
    const log = 'Blender 5.2\nread prefs\nTraceback (most recent call last):\n  File "x.py", line 1\nValueError: bad\n';
    expect(failureSummary(log)).toEqual(['Traceback (most recent call last):', '  File "x.py", line 1', 'ValueError: bad']);
    expect(failureSummary('ok\nError: no such file\nmore')).toEqual(['Error: no such file']);
    expect(failureSummary('just\nnoise')).toEqual(['just', 'noise']);
  });

  it('parseBlenderVersion reads the first "Blender <n>" line', () => {
    expect(parseBlenderVersion('Blender 5.2.2 LTS\n\tbuild date: 2026')).toBe('Blender 5.2.2 LTS');
    expect(parseBlenderVersion('Python 3.11')).toBeNull();
  });
});

describe('BlenderProcesses (fake Blender)', () => {
  const script = async (name: string, body: string) => {
    const path = join(dir, `${name}.py`);
    await writeFile(path, body);
    return path;
  };
  const runArgs = (py: string, out: string) => [...BLENDER_ARGS, '--python', py, '--', '--out', out];

  it('runs with the given cwd and only the filtered environment', async () => {
    const p = new BlenderProcesses();
    const out = join(dir, 'env.glb');
    const glb = join(dir, 'src.glb');
    await writeFile(glb, 'GLB');
    const py = await script('env', `# FAKE: copy ${glb}\n`);
    const run = await p.run(fake, runArgs(py, out), { cwd: dir, env: blenderEnv({ ...process.env, SECRET_TOKEN: 'leak' }) });
    expect(run).toMatchObject({ code: 0, timedOut: false, aborted: false });
    const rec = JSON.parse(await readFile(`${out}.run.json`, 'utf8'));
    expect(rec.argv.slice(0, 4)).toEqual(['-b', '--factory-startup', '--python-exit-code', '1']);
    expect(rec.env).not.toContain('SECRET_TOKEN');
    expect(rec.env).toContain('PYTHONNOUSERSITE');
    expect(await readFile(out, 'utf8')).toBe('GLB');
    expect(p.active).toBe(0);
  });

  it('a timeout kills the whole process group (a forked grandchild too)', async () => {
    const p = new BlenderProcesses();
    const pids = join(dir, 'pids.json');
    const py = await script('hang', `# FAKE: hang ${pids}\n`);
    const started = Date.now();
    const run = await p.run(fake, runArgs(py, join(dir, 'hang.glb')), { cwd: dir, timeoutMs: 700 });
    expect(run.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    const { parent, child } = JSON.parse(await readFile(pids, 'utf8'));
    await expect.poll(() => alive(parent) || alive(child), { timeout: 5000 }).toBe(false);
  });

  it('close() aborts a running build and refuses new ones', async () => {
    const p = new BlenderProcesses();
    const pids = join(dir, 'pids2.json');
    const py = await script('hang2', `# FAKE: hang ${pids}\n`);
    const running = p.run(fake, runArgs(py, join(dir, 'hang2.glb')), { cwd: dir, timeoutMs: 60_000 });
    await expect.poll(async () => readFile(pids, 'utf8').then(() => true, () => false), { timeout: 5000 }).toBe(true);
    p.close();
    const run = await running;
    expect(run).toMatchObject({ aborted: true, timedOut: false });
    await expect(p.run(fake, ['--version'], { cwd: dir })).rejects.toMatchObject({ code: 'closed' });
    const { child } = JSON.parse(await readFile(pids, 'utf8'));
    await expect.poll(() => alive(child), { timeout: 5000 }).toBe(false);
  });

  it('keeps a bounded log of a chatty run, ending with its last line', async () => {
    const p = new BlenderProcesses();
    const py = await script('spam', '# FAKE: spam\n');
    const run = await p.run(fake, runArgs(py, join(dir, 'spam.glb')), { cwd: dir });
    expect(run.log.length).toBeLessThanOrEqual(64 * 1024);
    expect(run.droppedBytes).toBeGreaterThan(900_000);
    expect(tailLines(run.log).at(-1)).toBe('[holodeck] wrote ' + join(dir, 'spam.glb'));
  });

  it('a binary that cannot start is a blender_failed error', async () => {
    const p = new BlenderProcesses();
    await expect(p.run(join(dir, 'missing-binary'), ['--version'], { cwd: dir })).rejects.toMatchObject({ code: 'blender_failed' });
  });

  it('blenderVersion reads the fake version; a non-Blender binary says why', async () => {
    const p = new BlenderProcesses();
    expect(await blenderVersion(p, fake, dir)).toEqual({ version: 'Blender 9.9.9 (fake)' });
    const notBlender = join(dir, 'not-blender');
    await writeFile(notBlender, '#!/bin/sh\necho hello\nexit 3\n', { mode: 0o755 });
    expect(await blenderVersion(p, notBlender, dir)).toMatchObject({ version: null, error: expect.stringContaining('exited 3') });
  });
});
