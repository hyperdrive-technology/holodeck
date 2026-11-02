#!/usr/bin/env node
/**
 * Does this CI job need to run for this change? Writes `run=true|false` to
 * $GITHUB_OUTPUT (or stdout without it) and explains the decision in the log.
 *
 *   node scripts/ci-scope.mjs --event "$EVENT" --base "$BASE_SHA" \
 *     --sdk-ref "$SDK_REF" --paths '^packages/flow-runtime/' [--paths ...] [--no-shared]
 *
 * Why step-level and not `on.paths`: the package jobs are required checks on
 * main, and a required check from a path-filtered workflow never reports on PRs
 * outside the paths, which blocks them forever. So every job still starts, but
 * after this step it skips its install/test/build steps (a job whose steps are
 * skipped by `if` still passes).
 *
 * Fail closed: anything other than a pull_request with a readable diff runs
 * everything, and so does a paired SDK branch (an unmerged holodeck-sdk change
 * can affect every package, whatever this repo's diff says).
 *
 * --no-shared: match only --paths, not SHARED_PATHS (the Blender rebuild does not
 * depend on the other workflows or on scripts/).
 *
 * --base is the PR base commit (github.event.pull_request.base.sha). On a
 * pull_request run HEAD is GitHub's merge commit, so `git diff base HEAD` is
 * exactly what the PR changes. The checkout is shallow; the base is fetched.
 *
 * Tests: scripts/ci-scope.test.mjs (node --test "scripts/**\/*.test.mjs").
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Paths every job depends on: the workflows, the SDK ref pin, the toolchain
 * pin and the shared scripts the package jobs run (smoke-dist, this file).
 */
export const SHARED_PATHS = [
  '^\\.github/workflows/',
  '^\\.github/holodeck-sdk-ref$',
  '^\\.node-version$',
  '^scripts/',
];

/**
 * @param {{ event: string, sdkRef?: string, changed?: string[] | null, paths: string[], shared?: boolean }} input
 *   changed: file paths changed by the PR, or null when the diff could not be read.
 * @returns {{ run: boolean, reason: string }}
 */
export function decide({ event, sdkRef = 'main', changed, paths, shared = true }) {
  if (event !== 'pull_request') return { run: true, reason: `${event || 'unknown'} event: always run` };
  if (sdkRef && sdkRef !== 'main') return { run: true, reason: `paired holodeck-sdk ref ${sdkRef}: always run` };
  if (!Array.isArray(changed)) return { run: true, reason: 'could not read the PR diff: run (fail closed)' };
  if (paths.length === 0) return { run: true, reason: 'no paths given: run' };
  const patterns = [...paths, ...(shared ? SHARED_PATHS : [])].map((p) => new RegExp(p));
  const hit = changed.find((file) => patterns.some((re) => re.test(file)));
  if (hit) return { run: true, reason: `${hit} changed` };
  return { run: false, reason: `none of the ${changed.length} changed file(s) match ${paths.join(' | ')}: skip` };
}

/** Parse `--name value` pairs and the `--no-shared` switch; `--paths` may repeat. */
export function parseArgs(argv) {
  const out = { event: '', base: '', sdkRef: 'main', paths: [], cwd: '.', shared: true };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--no-shared') {
      out.shared = false;
      i -= 1;
      continue;
    }
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === '--event') out.event = value;
    else if (flag === '--base') out.base = value;
    else if (flag === '--sdk-ref') out.sdkRef = value;
    else if (flag === '--paths') out.paths.push(value);
    else if (flag === '--cwd') out.cwd = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

/** Changed files between base and HEAD, or null if git cannot tell. */
function changedFiles(base, cwd) {
  if (!base) return null;
  try {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    git('fetch', '--no-tags', '--depth=1', 'origin', base);
    // --no-renames: a file moved out of a path must still list its old path.
    return git('diff', '--no-renames', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  } catch (error) {
    console.error(`ci-scope: ${error.message}`);
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changed = args.event === 'pull_request' ? changedFiles(args.base, args.cwd) : [];
  const { run, reason } = decide({ event: args.event, sdkRef: args.sdkRef, changed, paths: args.paths, shared: args.shared });
  console.log(`ci-scope: run=${run} (${reason})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
