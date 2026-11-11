/**
 * State and logic behind the Blender part tools (`blender_status`,
 * `blender_build_part`, `part_validate`, `blender_preview`, `part_install`):
 *
 *   build    write blender/parts/<name>.py, run Blender headless, GLB + Workbench
 *            PNG into a per-server scratch folder (never assets/models), validate
 *   validate the part contract on that build, or on an installed model
 *   install  copy a validated build to assets/models and regenerate the model map
 *
 * Builds are remembered per server (name -> scratch files + the hash of the
 * script they came from); `part_install` refuses a build whose script changed
 * since. Blender runs one at a time, and an install never overlaps a build.
 * The scratch folder is removed when the server closes.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLENDER_ARGS, BlenderProcesses, blenderEnv, blenderVersion, failureSummary, findBlender, tailLines, type BlenderLocation } from './blender';
import { ToolError } from './errors';
import { validatePartGlb, type PartValidation } from './glb';
import { DEFAULT_BLENDER_TIMEOUT_MS, MAX_PART_GLB_BYTES, MAX_PART_SOURCE_BYTES } from './limits';
import {
  assertPartName,
  defaultRepoRoot,
  fileExists,
  installedModels,
  modelIndexSource,
  modelPath,
  partScripts,
  readRepoFile,
  repoLayout,
  repoPath,
  scriptPath,
  writeRepoFile,
  type RepoLayout,
} from './part-files';
import { serialised } from './workspace';

export const ALLOW_BLENDER_ENV = 'HOLODECK_MCP_ALLOW_BLENDER';
export const REPO_ENV = 'HOLODECK_MCP_REPO';

export interface BlenderOptions {
  /** Open the Blender gate (default: `HOLODECK_MCP_ALLOW_BLENDER=1` in `env`). The tier must be `exec` as well. */
  allow?: boolean;
  /** Blender binary; `null` = none (default: `findBlender(env)`). */
  binary?: string | null;
  /** The holodeck repo root (default: `HOLODECK_MCP_REPO`, else the repo this package sits in). */
  repoDir?: string;
  /** Environment for discovery and the gate; Blender itself only gets `blenderEnv(env)`. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  /** Default wall-clock limit of one Blender run. */
  timeoutMs?: number;
}

export interface PartBuild {
  name: string;
  glb: string;
  png: string | null;
  /** sha256 of the script the GLB was built from. */
  scriptSha: string;
  builtAt: string;
  maxTriangles: number | undefined;
  validation: PartValidation;
}

export type GlbSource = 'auto' | 'build' | 'installed';

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

async function bytesIfExists(path: string, max: number): Promise<Buffer | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    if (info.size > max) throw new ToolError(`${path} is ${info.size} bytes, over the ${max}-byte limit`, [], 'too_large');
    return await readFile(path);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export class PartWorkbench {
  readonly layout: RepoLayout;
  readonly allowed: boolean;
  readonly processes = new BlenderProcesses();
  private readonly env: NodeJS.ProcessEnv;
  private readonly builds = new Map<string, PartBuild>();
  /** Scripts this server created (rewriting them needs no `overwrite`). */
  private readonly created = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private scratch: Promise<string> | null = null;
  private versions = new Map<string, Promise<{ version: string | null; error?: string }>>();
  private closed = false;

  constructor(private readonly options: BlenderOptions = {}) {
    this.env = options.env ?? process.env;
    this.allowed = options.allow ?? this.env[ALLOW_BLENDER_ENV]?.trim() === '1';
    this.layout = repoLayout(options.repoDir ?? (this.env[REPO_ENV]?.trim() || defaultRepoRoot()));
  }

  locate(): BlenderLocation {
    return findBlender(this.env, this.options.binary);
  }

  /** Refuse unless the env gate is open (the tier is checked by the tool wrapper). */
  assertAllowed(tool: string): void {
    if (!this.allowed) {
      throw new ToolError(
        `${tool} runs Blender (arbitrary Python) and is off: the server was started without ${ALLOW_BLENDER_ENV}=1`,
        [`restart the server with HOLODECK_MCP_TIER=exec and ${ALLOW_BLENDER_ENV}=1 to allow Blender part builds`, 'blender_status shows the gate'],
        'blender_disabled',
      );
    }
  }

  /** One Blender run or install at a time. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return serialised(this.locks, 'blender', fn);
  }

  private scratchDir(): Promise<string> {
    this.scratch ??= mkdtemp(join(tmpdir(), 'holodeck-mcp-parts-'));
    return this.scratch;
  }

  private binary(): string {
    const found = this.locate();
    if (!found.path) {
      throw new ToolError('Blender not found', [found.reason ?? 'not installed', 'set $BLENDER to the Blender binary, or install Blender (macOS: /Applications/Blender.app); tested with 5.2.2 LTS'], 'no_blender');
    }
    return found.path;
  }

  version(binary: string): Promise<{ version: string | null; error?: string }> {
    let cached = this.versions.get(binary);
    if (!cached) {
      cached = blenderVersion(this.processes, binary, this.layout.blenderDir);
      this.versions.set(binary, cached);
    }
    return cached;
  }

  buildOf(name: string): PartBuild | undefined {
    return this.builds.get(name);
  }

  get buildList(): PartBuild[] {
    return [...this.builds.values()];
  }

  async scripts(): Promise<string[]> {
    return partScripts(this.layout).catch(() => []);
  }

  async models(): Promise<string[]> {
    return installedModels(this.layout).catch(() => []);
  }

  /** Run `script` headless: GLB to `out`, optional Workbench PNG. Throws a ToolError on any failure, with the useful log lines. */
  private async runScript(script: string, out: string, png: string | null, timeoutMs: number | undefined): Promise<{ ms: number; log: string[]; droppedBytes: number }> {
    const binary = this.binary();
    await rm(out, { force: true });
    if (png) await rm(png, { force: true });
    const args = [...BLENDER_ARGS, '--python', script, '--', '--out', out, ...(png ? ['--preview', png] : [])];
    const timeout = timeoutMs ?? this.options.timeoutMs ?? DEFAULT_BLENDER_TIMEOUT_MS;
    const run = await this.processes.run(binary, args, { cwd: this.layout.blenderDir, timeoutMs: timeout, env: blenderEnv(this.env) });
    if (run.aborted) throw new ToolError('the Blender run was stopped: the MCP server is shutting down', [], 'closed');
    if (run.timedOut) throw new ToolError(`Blender did not finish in ${timeout / 1000} s and was killed`, ['a loop that never ends, or a very heavy mesh?', ...tailLines(run.log, 20)], 'timeout');
    if (run.code !== 0) throw new ToolError(`Blender exited ${run.code ?? run.signal}: the script failed`, failureSummary(run.log), 'blender_failed');
    if (!(await bytesIfExists(out, MAX_PART_GLB_BYTES))) {
      throw new ToolError('Blender exited 0 but wrote no GLB', ['the script must end with hd.run_part(build, "<name>"), which reads --out and exports', ...tailLines(run.log, 20)], 'blender_failed');
    }
    return { ms: run.ms, log: tailLines(run.log), droppedBytes: run.droppedBytes };
  }

  /** `blender_build_part`. */
  async build(args: { name: string; source: string; overwrite: boolean; preview: boolean; timeoutMs?: number; maxTriangles?: number }) {
    assertPartName(args.name);
    const bytes = Buffer.byteLength(args.source, 'utf8');
    if (bytes > MAX_PART_SOURCE_BYTES) throw new ToolError(`the script is ${bytes} bytes, over the ${MAX_PART_SOURCE_BYTES}-byte limit`, [], 'too_large');
    if (args.source.includes('\0')) throw new ToolError('the script contains a NUL character', [], 'invalid_request');
    return this.exclusive(async () => {
      if (this.closed) throw new ToolError('the MCP server is shutting down', [], 'closed');
      this.binary(); // fail before writing anything when there is no Blender
      const script = scriptPath(this.layout, args.name);
      const existed = await fileExists(script);
      const installed = await fileExists(modelPath(this.layout, args.name));
      if ((existed || installed) && !this.created.has(args.name) && !args.overwrite) {
        throw new ToolError(
          `part "${args.name}" already exists (${[existed && repoPath(this.layout, script), installed && repoPath(this.layout, modelPath(this.layout, args.name))].filter(Boolean).join(', ')})`,
          ['pick another name, or pass overwrite: true to replace its script (git keeps the original)'],
          'conflict',
        );
      }
      await writeRepoFile(this.layout, script, args.source);
      this.created.add(args.name);
      this.builds.delete(args.name);
      const dir = await this.scratchDir();
      const out = join(dir, `${args.name}.glb`);
      const png = args.preview ? join(dir, `${args.name}.png`) : null;
      let run;
      try {
        run = await this.runScript(script, out, png, args.timeoutMs);
      } catch (error) {
        // The script stays written (that is how the agent iterates): say so.
        if (error instanceof ToolError) throw new ToolError(error.message, [...error.problems, `the script is at ${repoPath(this.layout, script)}; fix it and call blender_build_part again (no overwrite needed)`], error.code);
        throw error;
      }
      const glb = (await bytesIfExists(out, MAX_PART_GLB_BYTES))!;
      const validation = validatePartGlb(glb, { maxTriangles: args.maxTriangles });
      const previewPng = png ? await bytesIfExists(png, MAX_PART_GLB_BYTES) : null;
      const build: PartBuild = {
        name: args.name,
        glb: out,
        png: previewPng ? png : null,
        scriptSha: sha(args.source),
        builtAt: new Date().toISOString(),
        maxTriangles: args.maxTriangles,
        validation,
      };
      this.builds.set(args.name, build);
      return { build, glbBytes: glb.byteLength, preview: previewPng, script: repoPath(this.layout, script), overwrote: existed, ms: run.ms, log: run.log, droppedBytes: run.droppedBytes };
    });
  }

  /** The GLB `source` names: this server's build, the installed model, or (auto) the build if there is one. */
  async glb(name: string, source: GlbSource): Promise<{ source: 'build' | 'installed'; path: string; bytes: Buffer; build?: PartBuild }> {
    assertPartName(name);
    const build = this.builds.get(name);
    if (source === 'build' || (source === 'auto' && build)) {
      if (!build) throw new ToolError(`no build of "${name}" in this server session`, ['blender_build_part first, or pass source: "installed"'], 'not_found');
      const bytes = await bytesIfExists(build.glb, MAX_PART_GLB_BYTES);
      if (!bytes) throw new ToolError(`the build of "${name}" is gone from the scratch folder`, ['build it again'], 'not_found');
      return { source: 'build', path: build.glb, bytes, build };
    }
    const path = modelPath(this.layout, name);
    if (!(await fileExists(path))) {
      throw new ToolError(`no installed model "${name}"`, [`installed: ${(await this.models()).join(', ') || 'none'}`, 'or blender_build_part it first'], 'not_found');
    }
    return { source: 'installed', path: repoPath(this.layout, path), bytes: await readRepoFile(this.layout, path, MAX_PART_GLB_BYTES) };
  }

  /** A Workbench PNG of `name`: the build's, or a fresh headless run of its script (writes only to scratch). */
  async workbenchPng(name: string, build: PartBuild | undefined, timeoutMs?: number): Promise<Buffer> {
    if (build?.png) {
      const png = await bytesIfExists(build.png, MAX_PART_GLB_BYTES);
      if (png) return png;
    }
    return this.exclusive(async () => {
      if (this.closed) throw new ToolError('the MCP server is shutting down', [], 'closed');
      const script = scriptPath(this.layout, name);
      if (!(await fileExists(script))) throw new ToolError(`no script ${repoPath(this.layout, script)} to render a Workbench preview from`, ['pass workbench: false for the styled render only'], 'not_found');
      const dir = await this.scratchDir();
      const png = join(dir, `${name}.preview.png`);
      await this.runScript(script, join(dir, `${name}.preview.glb`), png, timeoutMs);
      const bytes = await bytesIfExists(png, MAX_PART_GLB_BYTES);
      if (!bytes) throw new ToolError('Blender wrote no preview PNG', ['does the script end with hd.run_part(build, "<name>")? It renders the --preview path'], 'blender_failed');
      return bytes;
    });
  }

  /** `part_install`. */
  async install(name: string, overwrite: boolean) {
    assertPartName(name);
    return this.exclusive(async () => {
      if (this.closed) throw new ToolError('the MCP server is shutting down', [], 'closed');
      const build = this.builds.get(name);
      if (!build) throw new ToolError(`no build of "${name}" in this server session`, ['blender_build_part it first (installs only take a build from this session)'], 'not_found');
      const script = scriptPath(this.layout, name);
      if (!(await fileExists(script))) throw new ToolError(`${repoPath(this.layout, script)} is gone since the build`, ['build it again'], 'conflict');
      if (sha(await readRepoFile(this.layout, script, MAX_PART_SOURCE_BYTES)) !== build.scriptSha) {
        throw new ToolError(`${repoPath(this.layout, script)} changed since it was built`, ['build it again so the GLB matches the script'], 'conflict');
      }
      const glb = await bytesIfExists(build.glb, MAX_PART_GLB_BYTES);
      if (!glb) throw new ToolError(`the build of "${name}" is gone from the scratch folder`, ['build it again'], 'not_found');
      const validation = validatePartGlb(glb, { maxTriangles: build.maxTriangles });
      if (!validation.ok) throw new ToolError(`the build of "${name}" does not meet the part contract; nothing was installed`, validation.problems, 'invalid_part');
      const target = modelPath(this.layout, name);
      const replaced = await fileExists(target);
      if (replaced && !overwrite) {
        throw new ToolError(`${repoPath(this.layout, target)} already exists`, ['pass overwrite: true to replace it (git keeps the original)'], 'conflict');
      }
      // The model map: refuse before copying anything if index.ts has edits the generator would drop.
      const before = await installedModels(this.layout);
      const indexText = (await readRepoFile(this.layout, this.layout.modelIndex, 1024 * 1024)).toString('utf8');
      if (indexText !== modelIndexSource(before)) {
        throw new ToolError(
          `${repoPath(this.layout, this.layout.modelIndex)} does not match what part_install generates for the models on disk`,
          ['it has hand edits, or a GLB was added without its import: fix it by hand (or restore it with git), then install again'],
          'conflict',
        );
      }
      const after = before.includes(name) ? before : [...before, name].sort();
      await writeRepoFile(this.layout, target, glb);
      const registered = !before.includes(name);
      if (registered) await writeRepoFile(this.layout, this.layout.modelIndex, modelIndexSource(after));
      return {
        name,
        model: repoPath(this.layout, target),
        script: repoPath(this.layout, script),
        index: repoPath(this.layout, this.layout.modelIndex),
        registered,
        replaced,
        bytes: glb.byteLength,
        validation,
      };
    });
  }

  /** Kill any running Blender, drop the scratch folder; later builds are refused. */
  async close(): Promise<void> {
    this.closed = true;
    this.processes.close();
    const dir = await this.scratch?.catch(() => null);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}
