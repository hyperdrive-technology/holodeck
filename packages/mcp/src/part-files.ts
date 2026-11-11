/**
 * The files Blender part tools touch in the holodeck repo, and nothing else:
 *
 *   blender/parts/<name>.py                                  blender_build_part writes it
 *   packages/editor-2.5d-react/assets/models/<name>.glb      part_install copies the built GLB here
 *   packages/editor-2.5d-react/assets/models/index.ts        part_install regenerates its model map
 *
 * `<name>` matches PART_NAME (lower-case words joined by `-`, like the shipped
 * `brite-tank`), so it can never be a path, a hidden file or `..`. Each write
 * goes to a temp file in the same folder and is renamed into place; a target
 * that is a symlink, or a folder that resolves outside the repo, is refused.
 *
 * Registration: the library's built-in GLBs are an explicit import map
 * (`assets/models/index.ts`, `BUILTIN_MODEL_URLS`; see that file for why it is
 * not a glob). `modelIndexSource` generates it from the GLB names; a test
 * pins that the generator reproduces the checked-in file byte for byte, so
 * hand edits and installs never disagree. The parts page (`pnpm parts`)
 * globs the folder and needs nothing.
 */

import { randomUUID } from 'node:crypto';
import { lstat, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from './errors';
import { MAX_PART_NAME_LENGTH } from './limits';

/** Lower-case words of letters and digits joined by single hyphens, starting with a letter (each word, too). */
export const PART_NAME = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*$/;
/** Names that are folders or helpers in blender/ (or would shadow them). */
export const RESERVED_PART_NAMES: ReadonlySet<string> = new Set(['cloud', 'holodeck-bpy', 'index', 'brewery']);

/** Why `name` is not a valid part name, or null. */
export function partNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name === '') return 'name: required';
  if (name.length > MAX_PART_NAME_LENGTH) return `name: at most ${MAX_PART_NAME_LENGTH} characters`;
  if (!PART_NAME.test(name)) return `name: ${JSON.stringify(name)} must be lower-case words of letters and digits joined by "-", each starting with a letter (e.g. "mixer", "plate-heat-exchanger")`;
  if (RESERVED_PART_NAMES.has(name)) return `name: "${name}" is reserved`;
  return null;
}

export function assertPartName(name: string): void {
  const problem = partNameProblem(name);
  if (problem) throw new ToolError(`invalid part name ${JSON.stringify(name).slice(0, 80)}`, [problem], 'invalid_name');
}

export interface RepoLayout {
  /** The holodeck repo root. */
  root: string;
  /** `blender/` (Blender's cwd; holds holodeck_bpy.py). */
  blenderDir: string;
  /** `blender/parts/`. */
  partsDir: string;
  /** `packages/editor-2.5d-react/assets/models/`. */
  modelsDir: string;
  /** `.../assets/models/index.ts`. */
  modelIndex: string;
}

/** The repo next to this package: packages/mcp/{src,dist} -> the holodeck root. */
export function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

export function repoLayout(root: string): RepoLayout {
  const abs = resolve(root);
  const modelsDir = join(abs, 'packages/editor-2.5d-react/assets/models');
  return { root: abs, blenderDir: join(abs, 'blender'), partsDir: join(abs, 'blender/parts'), modelsDir, modelIndex: join(modelsDir, 'index.ts') };
}

/** Repo-relative, `/`-separated (what results show). */
export const repoPath = (layout: RepoLayout, abs: string): string => relative(layout.root, abs).split(sep).join('/');

export const scriptPath = (layout: RepoLayout, name: string): string => join(layout.partsDir, `${name}.py`);
export const modelPath = (layout: RepoLayout, name: string): string => join(layout.modelsDir, `${name}.glb`);

const within = (root: string, abs: string) => abs === root || abs.startsWith(root + sep);
const errno = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/** Does a regular file exist at `abs`? A symlink, folder or other entry there is refused. */
export async function fileExists(abs: string): Promise<boolean> {
  try {
    const info = await lstat(abs);
    if (!info.isFile()) throw new ToolError(`${abs} is not a regular file (a symlink or folder is never written through)`, [], 'invalid_path');
    return true;
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if (errno(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Throw unless `dir` exists and its real path is inside the repo's real root. */
async function checkFolder(layout: RepoLayout, dir: string): Promise<void> {
  let realRoot: string;
  let realDir: string;
  try {
    [realRoot, realDir] = await Promise.all([realpath(layout.root), realpath(dir)]);
  } catch {
    throw new ToolError(`${repoPath(layout, dir)} does not exist in ${layout.root}`, ['is HOLODECK_MCP_REPO the holodeck repo root?'], 'no_repo');
  }
  if (!within(realRoot, realDir)) throw new ToolError(`${repoPath(layout, dir)} resolves outside the repo`, [], 'invalid_path');
}

/**
 * Write `data` to `abs` (a file directly inside one of the layout's folders):
 * temp file + rename, so a reader never sees half a file. The target must be
 * a regular file or absent.
 */
export async function writeRepoFile(layout: RepoLayout, abs: string, data: string | Uint8Array): Promise<void> {
  await checkFolder(layout, dirname(abs));
  await fileExists(abs);
  const tmp = join(dirname(abs), `.${randomUUID()}.tmp`);
  try {
    const handle = await open(tmp, 'wx', 0o644);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, abs);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Read a regular file inside the repo, at most `max` bytes. */
export async function readRepoFile(layout: RepoLayout, abs: string, max: number): Promise<Buffer> {
  await checkFolder(layout, dirname(abs));
  if (!(await fileExists(abs))) throw new ToolError(`no file at ${repoPath(layout, abs)}`, [], 'not_found');
  const handle = await open(abs, 'r');
  try {
    const { size } = await handle.stat();
    if (size > max) throw new ToolError(`${repoPath(layout, abs)} is ${size} bytes, over the ${max}-byte limit`, [], 'too_large');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/** The `<name>.glb` files in the models folder, sorted. */
export async function installedModels(layout: RepoLayout): Promise<string[]> {
  const entries = await readdir(layout.modelsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.glb'))
    .map((e) => e.name.slice(0, -'.glb'.length))
    .sort();
}

/** The part scripts in blender/parts (top level only; `cloud/` belongs to library-cloud), sorted. */
export async function partScripts(layout: RepoLayout): Promise<string[]> {
  const entries = await readdir(layout.partsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.py') && !e.name.startsWith('_'))
    .map((e) => e.name.slice(0, -'.py'.length))
    .sort();
}

// --- assets/models/index.ts ----------------------------------------------------

/** Words JavaScript will not take as an import binding. */
const RESERVED_WORDS = new Set(
  'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield arguments eval'.split(' '),
);

/** `brite-tank` -> `briteTank`; a reserved word gets a `Glb` suffix (`switch` -> `switchGlb`). */
export function modelIdentifier(name: string): string {
  const camel = name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return RESERVED_WORDS.has(camel) ? `${camel}Glb` : camel;
}

const INDEX_HEADER = `/**
 * Bundled GLB part models as URLs: an explicit asset map, one static import
 * per file, so every toolchain that touches this module can see the assets.
 *
 * - Source (Vite dev/build, Vitest): Vite's \`?url\` suffix emits the file as an
 *   asset and returns its served URL.
 * - Built package (tsup): \`glbUrlPlugin\` in \`tsup.config.ts\` rewrites each
 *   \`./<name>.glb?url\` import to \`new URL('./models/<name>.glb', import.meta.url).href\`
 *   and copies the GLB to \`dist/models/\`. That expression is the cross-bundler
 *   asset idiom (Vite, webpack 5, Rollup, Parcel) and resolves to a \`file:\` URL
 *   under plain Node (the CJS build gets \`import.meta.url\` from tsup's shim).
 *
 * This replaced \`import.meta.glob\`, which is Vite-only and which tsup leaves
 * untransformed, so the built package threw on import (holodeck#7).
 * Adding a model: drop the GLB here and add a line below, or let the MCP
 * \`part_install\` tool do both (it regenerates this file with
 * \`packages/mcp/src/part-files.ts\`, whose test pins the exact format);
 * \`index.test.ts\` fails if the map and the directory disagree.
 */
`;

const INDEX_FOOTER = `
/** URL of a bundled model; throws on an unknown name so a typo fails loudly. */
export function modelUrl(name: string): string {
  const url = Object.prototype.hasOwnProperty.call(BUILTIN_MODEL_URLS, name) ? BUILTIN_MODEL_URLS[name] : undefined;
  if (!url) {
    throw new Error(\`unknown built-in model "\${name}" (have: \${Object.keys(BUILTIN_MODEL_URLS).sort().join(', ')})\`);
  }
  return url;
}
`;

/**
 * The full `assets/models/index.ts` for these model names. Throws when two
 * names would get the same import binding (`a-bc` and `a-bC` cannot both
 * exist under PART_NAME, but a reserved-word suffix could collide).
 */
export function modelIndexSource(names: readonly string[]): string {
  const sorted = [...new Set(names)].sort();
  const seen = new Map<string, string>();
  for (const name of sorted) {
    assertPartName(name);
    const id = modelIdentifier(name);
    const other = seen.get(id);
    if (other) throw new ToolError(`models "${other}" and "${name}" would both import as ${id}`, ['pick another part name'], 'conflict');
    seen.set(id, name);
  }
  const imports = sorted.map((name) => `import ${modelIdentifier(name)} from './${name}.glb?url';`).join('\n');
  const entries = sorted
    .map((name) => {
      const id = modelIdentifier(name);
      if (id === name) return `  ${name},`;
      return `  ${name.includes('-') ? `'${name}'` : name}: ${id},`;
    })
    .join('\n');
  return `${INDEX_HEADER}${imports}

/** Basename without extension (\`fermenter\`) -> asset URL. */
export const BUILTIN_MODEL_URLS: Readonly<Record<string, string>> = Object.freeze({
${entries}
});
${INDEX_FOOTER}`;
}
