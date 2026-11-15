/**
 * Running Blender headless for `blender_*` tools: find the binary, read its
 * version, and run one part script with a wall-clock limit and bounded output.
 *
 * The invocation is the one `packages/editor-2.5d-react/scripts/build-parts.mjs`
 * uses (`-b --factory-startup --python-exit-code 1 --python <script> -- --out
 * <glb> [--preview <png>]`, cwd `blender/`), so a part built here is
 * byte-identical to `pnpm parts:build`. That script is not reused directly
 * because it has no timeout, keeps all output and cannot be killed;
 * `blender.test.ts` fails if the two invocations drift apart.
 *
 * Safety (Blender runs arbitrary Python):
 * - only behind tier `exec` AND `HOLODECK_MCP_ALLOW_BLENDER=1` (server.ts);
 * - `--factory-startup`: no user preferences or add-ons;
 * - a minimal environment (PATH, HOME, TMPDIR, locale): none of the server's
 *   tokens or secrets reach the script, and Python ignores PYTHON* variables
 *   (Blender does unless `--python-use-system-env`);
 * - its own process group, killed as a whole (SIGKILL) on timeout or when the
 *   server closes, so a script that forks cannot leave processes behind;
 * - stdout / stderr kept to the last MAX_BLENDER_LOG_BYTES.
 * We never ask Blender for network access, but its Python *can* open sockets:
 * that is why the gate exists (see docs/MCP.md, "Blender").
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ToolError } from './errors';
import { DEFAULT_BLENDER_TIMEOUT_MS, MAX_BLENDER_LOG_BYTES, MAX_BLENDER_LOG_LINES } from './limits';

export const MAC_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
/** The flags before `--python` (keep in step with build-parts.mjs; blender.test.ts checks). */
export const BLENDER_ARGS: readonly string[] = ['-b', '--factory-startup', '--python-exit-code', '1'];
/** Environment variables passed through to Blender. Everything else is dropped. */
export const BLENDER_ENV_KEYS: readonly string[] = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'LOGNAME', 'SYSTEMROOT', 'DISPLAY'];
const VERSION_TIMEOUT_MS = 30_000;

export type BlenderSource = 'option' | 'BLENDER' | 'app' | 'path';

export interface BlenderLocation {
  /** Absolute binary, or null when none was found. */
  path: string | null;
  /** Where it came from: the server option, `$BLENDER`, the macOS app bundle, or `blender` on PATH. */
  source: BlenderSource | null;
  /** Why none was found (e.g. `$BLENDER` points at nothing). */
  reason?: string;
}

/**
 * Same order as build-parts.mjs `findBlender`: `$BLENDER` (which must exist:
 * a wrong `$BLENDER` is "not found", never a silent fall-through), then the
 * macOS app bundle, then `blender` on PATH.
 */
export function findBlender(env: NodeJS.ProcessEnv = process.env, explicit?: string | null): BlenderLocation {
  if (explicit === null) return { path: null, source: null, reason: 'Blender is disabled for this server' };
  if (explicit !== undefined) return existsSync(explicit) ? { path: explicit, source: 'option' } : { path: null, source: null, reason: `${explicit} does not exist` };
  const fromEnv = env.BLENDER?.trim();
  if (fromEnv) return existsSync(fromEnv) ? { path: fromEnv, source: 'BLENDER' } : { path: null, source: null, reason: `$BLENDER=${fromEnv} does not exist` };
  if (process.platform === 'darwin' && existsSync(MAC_BLENDER)) return { path: MAC_BLENDER, source: 'app' };
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8', env: { PATH: env.PATH ?? '' }, timeout: 5000 });
  const hit = which.status === 0 ? (which.stdout.split(/\r?\n/)[0] ?? '').trim() : '';
  return hit ? { path: hit, source: 'path' } : { path: null, source: null, reason: 'no $BLENDER, no /Applications/Blender.app, no blender on PATH' };
}

/** The subset of `env` Blender gets. */
export function blenderEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { PYTHONNOUSERSITE: '1' };
  for (const key of BLENDER_ENV_KEYS) if (env[key] !== undefined) out[key] = env[key];
  return out;
}

/** Output kept from a child: the last `max` bytes, plus how much was dropped. */
export class LogTail {
  private chunks: Buffer[] = [];
  private kept = 0;
  dropped = 0;

  constructor(private readonly max = MAX_BLENDER_LOG_BYTES) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.kept += chunk.byteLength;
    while (this.kept > this.max && this.chunks.length) {
      const first = this.chunks[0]!;
      const excess = this.kept - this.max;
      if (first.byteLength <= excess) {
        this.chunks.shift();
        this.kept -= first.byteLength;
        this.dropped += first.byteLength;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.kept -= excess;
        this.dropped += excess;
      }
    }
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** The last `n` non-empty lines. */
export function tailLines(text: string, n = MAX_BLENDER_LOG_LINES): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(-n);
}

/** The useful part of a failed run: the Python traceback if there is one, else error-ish lines, else the tail. */
export function failureSummary(text: string, n = MAX_BLENDER_LOG_LINES): string[] {
  const lines = text.split(/\r?\n/);
  const tb = lines.findLastIndex((l) => l.startsWith('Traceback'));
  const picked = tb >= 0 ? lines.slice(tb) : lines.filter((l) => /error|exception/i.test(l));
  const out = (picked.length ? picked : lines).filter((l) => l.trim() !== '');
  return out.slice(0, n);
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** Killed because the runner closed (the server is shutting down). */
  aborted: boolean;
  ms: number;
  log: string;
  droppedBytes: number;
}

export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Runs Blender processes and kills them all on `close()`. One process group
 * per run (`detached: true` makes the child a group leader on POSIX, so
 * `process.kill(-pid)` reaches anything it forked).
 */
export class BlenderProcesses {
  private readonly running = new Set<ChildProcess>();
  private closed = false;

  /** Run `binary args...`; resolves when it exits (or is killed), never rejects for a non-zero exit. */
  run(binary: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    if (this.closed) return Promise.reject(new ToolError('the Blender runner is closed (the MCP server is shutting down)', [], 'closed'));
    const started = Date.now();
    const tail = new LogTail();
    return new Promise<RunResult>((resolveRun, rejectRun) => {
      let child: ChildProcess;
      try {
        child = spawn(binary, [...args], {
          cwd: options.cwd,
          env: options.env ?? blenderEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });
      } catch (error) {
        rejectRun(new ToolError(`could not start Blender (${binary})`, [error instanceof Error ? error.message : String(error)], 'blender_failed'));
        return;
      }
      this.running.add(child);
      let timedOut = false;
      let aborted = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup(child);
      }, options.timeoutMs ?? DEFAULT_BLENDER_TIMEOUT_MS);
      child.stdout?.on('data', (d: Buffer) => tail.push(d));
      child.stderr?.on('data', (d: Buffer) => tail.push(d));
      (child as ChildProcess & { abortRun?: () => void }).abortRun = () => {
        aborted = true;
        killGroup(child);
      };
      child.once('error', (error) => {
        clearTimeout(timer);
        this.running.delete(child);
        rejectRun(new ToolError(`could not start Blender (${binary})`, [error.message], 'blender_failed'));
      });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        this.running.delete(child);
        // The leader is gone; make sure nothing it forked lingers either.
        killGroup(child);
        resolveRun({ code, signal, timedOut, aborted, ms: Date.now() - started, log: tail.text(), droppedBytes: tail.dropped });
      });
    });
  }

  /** How many Blender processes are running (tests). */
  get active(): number {
    return this.running.size;
  }

  /** Kill every running process group; later runs are refused. */
  close(): void {
    this.closed = true;
    for (const child of this.running) (child as ChildProcess & { abortRun?: () => void }).abortRun?.();
  }
}

function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // ESRCH: the group is already gone.
  }
}

/** `Blender 5.2.2 LTS` from `blender --version` (first line that starts with "Blender"). */
export function parseBlenderVersion(output: string): string | null {
  const line = output.split(/\r?\n/).find((l) => /^Blender \d/.test(l.trim()));
  return line ? line.trim() : null;
}

/** Ask a binary for its version; null (with the reason) when it does not answer like Blender. */
export async function blenderVersion(processes: BlenderProcesses, binary: string, cwd: string): Promise<{ version: string | null; error?: string }> {
  try {
    const run = await processes.run(binary, ['--version'], { cwd, timeoutMs: VERSION_TIMEOUT_MS });
    const version = parseBlenderVersion(run.log);
    if (run.timedOut) return { version: null, error: `--version did not answer in ${VERSION_TIMEOUT_MS / 1000} s` };
    if (run.code !== 0 || !version) return { version, error: `--version exited ${run.code ?? run.signal}: ${tailLines(run.log, 3).join(' / ') || '(no output)'}` };
    return { version };
  } catch (error) {
    return { version: null, error: error instanceof Error ? error.message : String(error) };
  }
}
