import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { MAX_DOCUMENT_BYTES, MAX_PATH_LENGTH } from './limits';
import { tempDir } from './test-support';
import { etagOf, Workspace } from './workspace';

let dir: string;
let cleanup: () => Promise<void>;
let ws: Workspace;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  ws = await Workspace.open(dir);
});
afterEach(() => cleanup());

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error as ToolError;
  }
  throw new Error('expected a refusal');
};

describe('Workspace paths', () => {
  it.each([
    ['', 'required'],
    ['/etc/passwd.holodeck.json', 'relative'],
    ['C:/x.holodeck.json', 'relative'],
    ['../up.holodeck.json', '".."'],
    ['a/../../up.holodeck.json', '".."'],
    ['a\\..\\..\\up.holodeck.json', '".."'],
    ['scene.json', 'must end in .holodeck.json'],
    ['nul\0.holodeck.json', 'NUL'],
    ['.git/x.holodeck.json', 'start with "."'],
    ['.hidden.holodeck.json', 'start with "."'],
    ['node_modules/x.holodeck.json', 'node_modules'],
    [`${'a'.repeat(MAX_PATH_LENGTH)}.holodeck.json`, 'longer than'],
  ])('refuses %j', async (path, why) => {
    const error = await refusal(ws.read(path));
    expect(error.code).toBe('invalid_path');
    expect(error.problems.join(' ')).toContain(why);
  });

  it('accepts nested relative paths and normalises them', () => {
    expect(ws.lexical('screens/./line-1.holodeck.json').rel).toBe('screens/line-1.holodeck.json');
  });

  it('refuses a symlinked file that points outside the root', async () => {
    const outside = await tempDir();
    try {
      await writeFile(join(outside.dir, 'secret.holodeck.json'), '{}');
      await symlink(join(outside.dir, 'secret.holodeck.json'), join(dir, 'link.holodeck.json'));
      expect((await refusal(ws.read('link.holodeck.json'))).message).toContain('outside the workspace');
      expect((await refusal(ws.write('link.holodeck.json', '{}'))).message).toContain('outside the workspace');
    } finally {
      await outside.cleanup();
    }
  });

  it('refuses a symlinked folder that points outside the root, for reads and new files', async () => {
    const outside = await tempDir();
    try {
      await symlink(outside.dir, join(dir, 'out'));
      expect((await refusal(ws.write('out/new.holodeck.json', '{}'))).message).toContain('outside the workspace');
      expect(await readdir(outside.dir)).toEqual([]);
    } finally {
      await outside.cleanup();
    }
  });

  it('follows a symlink that stays inside the root', async () => {
    await mkdir(join(dir, 'real'));
    await writeFile(join(dir, 'real', 'a.holodeck.json'), 'x');
    await symlink(join(dir, 'real'), join(dir, 'alias'));
    expect((await ws.read('alias/a.holodeck.json')).text).toBe('x');
  });

  it('refuses a root that does not exist', async () => {
    await expect(Workspace.open(join(dir, 'missing'))).rejects.toThrow(/does not exist/);
  });
});

describe('Workspace reads and writes', () => {
  it('reports a missing file as not_found', async () => {
    expect((await refusal(ws.read('nope.holodeck.json'))).code).toBe('not_found');
  });

  it('writes atomically, creating folders, and leaves no temp files', async () => {
    const written = await ws.write('a/b/c.holodeck.json', 'hello');
    expect(written).toEqual({ path: 'a/b/c.holodeck.json', text: 'hello', etag: etagOf('hello') });
    expect(await readFile(join(dir, 'a/b/c.holodeck.json'), 'utf8')).toBe('hello');
    expect(await readdir(join(dir, 'a/b'))).toEqual(['c.holodeck.json']);
  });

  it('expect=null refuses to replace an existing file', async () => {
    await ws.write('a.holodeck.json', 'one');
    const error = await refusal(ws.write('a.holodeck.json', 'two', null));
    expect(error.code).toBe('conflict');
    expect((await ws.read('a.holodeck.json')).text).toBe('one');
  });

  it('an etag that no longer matches is a conflict and nothing is written', async () => {
    const first = await ws.write('a.holodeck.json', 'one');
    await ws.write('a.holodeck.json', 'two');
    const error = await refusal(ws.write('a.holodeck.json', 'three', first.etag));
    expect(error.code).toBe('conflict');
    expect((await ws.read('a.holodeck.json')).text).toBe('two');
  });

  it('a matching etag writes', async () => {
    const first = await ws.write('a.holodeck.json', 'one');
    await ws.write('a.holodeck.json', 'two', first.etag);
    expect((await ws.read('a.holodeck.json')).text).toBe('two');
  });

  it('refuses to read or write files over the size limit', async () => {
    const big = 'x'.repeat(MAX_DOCUMENT_BYTES + 1);
    expect((await refusal(ws.write('big.holodeck.json', big))).code).toBe('too_large');
    await writeFile(join(dir, 'big.holodeck.json'), big);
    expect((await refusal(ws.read('big.holodeck.json'))).code).toBe('too_large');
  });

  it('writes export files only with their own suffix', async () => {
    await ws.write('parts.components.csv', 'a,b', undefined, '.components.csv');
    expect((await refusal(ws.write('parts.csv', 'a,b', undefined, '.components.csv'))).problems.join()).toContain('.components.csv');
  });

  it('concurrent create-only writes: exactly one wins, the others get conflict (no clobbering)', async () => {
    const results = await Promise.allSettled(['a', 'b', 'c', 'd'].map((t) => ws.write('new.holodeck.json', t, null)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBe(1);
    for (const r of results) if (r.status === 'rejected') expect((r.reason as ToolError).code).toBe('conflict');
    expect((await ws.read('new.holodeck.json')).text).toBe((ok[0] as PromiseFulfilledResult<{ text: string }>).value.text);
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('a create-only write never replaces a file another writer made first', async () => {
    await writeFile(join(dir, 'raced.holodeck.json'), 'theirs');
    expect((await refusal(ws.write('raced.holodeck.json', 'mine', null))).code).toBe('conflict');
    expect(await readFile(join(dir, 'raced.holodeck.json'), 'utf8')).toBe('theirs');
  });

  it('concurrent writes guarded by the same etag: one wins, the rest conflict', async () => {
    const base = await ws.write('a.holodeck.json', 'v0');
    const results = await Promise.allSettled(['v1', 'v2', 'v3'].map((t) => ws.write('a.holodeck.json', t, base.etag)));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as ToolError).code)).toEqual(['conflict', 'conflict']);
  });

  it('a dangling symlink or a file used as a folder reads as not_found', async () => {
    await symlink(join(dir, 'gone.holodeck.json'), join(dir, 'dangling.holodeck.json'));
    expect((await refusal(ws.read('dangling.holodeck.json'))).code).toBe('not_found');
    await writeFile(join(dir, 'file'), 'x');
    expect((await refusal(ws.read('file/inner.holodeck.json'))).code).toBe('not_found');
  });

  it('exclusive runs calls for one path one at a time, other paths in parallel', async () => {
    const order: string[] = [];
    const step = (tag: string, ms: number) => async () => {
      order.push(`${tag}+`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${tag}-`);
    };
    await Promise.all([ws.exclusive('a.holodeck.json', step('a1', 30)), ws.exclusive('./a.holodeck.json', step('a2', 1)), ws.exclusive('b.holodeck.json', step('b', 1))]);
    expect(order.indexOf('a1-')).toBeLessThan(order.indexOf('a2+'));
    expect(order.indexOf('b-')).toBeLessThan(order.indexOf('a1-'));
    // A failing call does not wedge the queue.
    await expect(ws.exclusive('a.holodeck.json', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(ws.exclusive('a.holodeck.json', async () => 'ok')).resolves.toBe('ok');
  });

  it('lists documents, skipping hidden folders and node_modules', async () => {
    await ws.write('b.holodeck.json', '{}');
    await ws.write('screens/a.holodeck.json', '{}');
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'x.holodeck.json'), '{}');
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'y.holodeck.json'), '{}');
    await writeFile(join(dir, 'notes.json'), '{}');
    expect(await ws.list()).toEqual(['b.holodeck.json', 'screens/a.holodeck.json']);
    expect(await ws.list(1)).toEqual(['b.holodeck.json']);
  });
});
