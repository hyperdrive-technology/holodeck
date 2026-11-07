/**
 * The folder this server may read and write documents in, and nothing else.
 *
 * Every document path a tool receives is relative to the workspace root and
 * must end in `.holodeck.json`. A path is refused when it is absolute, climbs
 * out with `..`, contains a NUL, or resolves (through a symlink in the file
 * or any parent folder) to somewhere outside the root's real path. Writes go
 * to a temp file in the same folder and are renamed into place, so a reader
 * never sees half a document.
 */

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ToolError } from './errors';
import { MAX_DOCUMENT_BYTES, MAX_PATH_LENGTH } from './limits';

export const DOCUMENT_SUFFIX = '.holodeck.json';
/** Files `scene_export` may write besides documents. */
export const EXPORT_SUFFIXES = ['.components.csv'] as const;
export type FileSuffix = typeof DOCUMENT_SUFFIX | (typeof EXPORT_SUFFIXES)[number];

/** Short content hash a caller passes back to edit only the version it read (optimistic concurrency). */
export function etagOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface DocumentFile {
  /** Workspace-relative, `/`-separated. */
  path: string;
  text: string;
  etag: string;
}

const within = (root: string, abs: string) => abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep);
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

export class Workspace {
  private constructor(public readonly root: string) {}

  /** `root` must be an existing folder; it is resolved to its real path once. */
  static async open(root: string): Promise<Workspace> {
    let real: string;
    try {
      real = await realpath(resolve(root));
    } catch {
      throw new Error(`workspace root ${JSON.stringify(root)} does not exist`);
    }
    if (!(await stat(real)).isDirectory()) throw new Error(`workspace root ${JSON.stringify(root)} is not a folder`);
    return new Workspace(real);
  }

  /** Check `path` and return its absolute form. Does not touch the file system. */
  lexical(path: string, suffix: FileSuffix = DOCUMENT_SUFFIX): { abs: string; rel: string } {
    const problems: string[] = [];
    if (typeof path !== 'string' || path.trim() === '') problems.push('path: required');
    else {
      if (path.length > MAX_PATH_LENGTH) problems.push(`path: longer than ${MAX_PATH_LENGTH} characters`);
      if (path.includes('\0')) problems.push('path: contains a NUL character');
      if (isAbsolute(path) || /^[a-zA-Z]:/.test(path) || path.startsWith('\\')) problems.push('path: must be relative to the workspace root');
      const segments = path.split(/[\\/]/);
      if (segments.includes('..')) problems.push('path: must not contain ".."');
      // Dot folders / files (.git, .holodeck-mcp.json, temp files) and node_modules are off limits.
      else if (segments.some((seg) => seg.startsWith('.') && seg !== '.')) problems.push('path: no segment may start with "." (hidden files and folders are off limits)');
      if (segments.includes('node_modules')) problems.push('path: must not be inside node_modules');
      if (!path.endsWith(suffix)) problems.push(`path: must end in ${suffix}`);
    }
    if (problems.length) throw new ToolError(`invalid document path ${JSON.stringify(path)}`, problems, 'invalid_path');
    const abs = resolve(this.root, path);
    if (!within(this.root, abs)) throw new ToolError(`path ${JSON.stringify(path)} is outside the workspace`, [], 'invalid_path');
    return { abs, rel: relative(this.root, abs).split(sep).join('/') };
  }

  /**
   * `path` resolved on disk: the deepest existing ancestor (and the file,
   * when it exists) must have a real path inside the root.
   */
  private async resolveReal(path: string, suffix: FileSuffix = DOCUMENT_SUFFIX): Promise<{ abs: string; rel: string; exists: boolean }> {
    const { abs, rel } = this.lexical(path, suffix);
    let probe = abs;
    for (;;) {
      try {
        const real = await realpath(probe);
        if (!within(this.root, real)) throw new ToolError(`path ${JSON.stringify(path)} resolves outside the workspace`, [], 'invalid_path');
        break;
      } catch (error) {
        if (error instanceof ToolError) throw error;
        if (!isMissing(error)) throw error;
        const parent = dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    let exists = false;
    try {
      const info = await lstat(abs);
      if (!info.isFile() && !info.isSymbolicLink()) throw new ToolError(`${rel} is not a file`, [], 'invalid_path');
      exists = true;
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (!isMissing(error)) throw error;
    }
    return { abs, rel, exists };
  }

  async exists(path: string): Promise<boolean> {
    return (await this.resolveReal(path)).exists;
  }

  async read(path: string, suffix: FileSuffix = DOCUMENT_SUFFIX): Promise<DocumentFile> {
    const { abs, rel, exists } = await this.resolveReal(path, suffix);
    if (!exists) throw new ToolError(`no document at ${rel}`, [], 'not_found');
    const handle = await open(abs, 'r');
    try {
      const { size } = await handle.stat();
      if (size > MAX_DOCUMENT_BYTES) throw new ToolError(`${rel} is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`, [], 'too_large');
      const text = await handle.readFile('utf8');
      return { path: rel, text, etag: etagOf(text) };
    } finally {
      await handle.close();
    }
  }

  /**
   * Write `text` to `path` atomically. `expect`: the etag the caller's copy
   * was based on (`null` = the file must not exist yet; `undefined` = no check).
   */
  async write(path: string, text: string, expect?: string | null, suffix: FileSuffix = DOCUMENT_SUFFIX): Promise<DocumentFile> {
    const { abs, rel, exists } = await this.resolveReal(path, suffix);
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) throw new ToolError(`the document would be larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`, [], 'too_large');
    if (expect === null && exists) throw new ToolError(`${rel} already exists`, ['pass overwrite: true to replace it'], 'conflict');
    if (typeof expect === 'string') {
      if (!exists) throw new ToolError(`${rel} no longer exists`, [], 'conflict');
      const current = await this.read(rel, suffix);
      if (current.etag !== expect) {
        throw new ToolError(`${rel} changed since you read it (etag ${expect}, now ${current.etag})`, ['read it again (scene_get) and redo the edit'], 'conflict');
      }
    }
    await mkdir(dirname(abs), { recursive: true });
    // mkdir may have created folders: re-check that the target folder is still inside.
    if (!within(this.root, await realpath(dirname(abs)))) throw new ToolError(`path ${JSON.stringify(path)} resolves outside the workspace`, [], 'invalid_path');
    const tmp = join(dirname(abs), `.${randomUUID()}.tmp`);
    try {
      const handle = await open(tmp, 'wx', 0o644);
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, abs);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return { path: rel, text, etag: etagOf(text) };
  }

  /** Every `*.holodeck.json` under the root (skipping dot folders and node_modules), at most `limit`. */
  async list(limit = 500): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 8 || found.length >= limit) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (found.length >= limit) return;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) await walk(abs, depth + 1);
        else if (entry.isFile() && entry.name.endsWith(DOCUMENT_SUFFIX)) found.push(relative(this.root, abs).split(sep).join('/'));
      }
    };
    await walk(this.root, 0);
    return found;
  }
}
