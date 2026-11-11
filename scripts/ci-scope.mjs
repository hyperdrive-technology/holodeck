#!/usr/bin/env node
/**
 * Does this CI job need to run for this change? Writes `run=true|false` to
 * $GITHUB_OUTPUT (or stdout without it) and explains the decision in the log.
 *
 *   node scripts/ci-scope.mjs --event "$EVENT" --base "$BASE_SHA" \
 *     --sdk-ref "$SDK_REF" --job <name>
 *   node scripts/ci-scope.mjs ... --paths '^packages/flow-runtime/' [--paths ...] [--no-shared]
 *
 * --job <name> takes the job's paths (and its --no-shared) from JOBS below, the one table of
 * "which paths affect which CI job". The workflows pass --job; scripts/dev-check.mjs reads the
 * same table to pick local steps, so CI and the local ladder cannot disagree about scope.
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
 * Also fail closed on unowned files: a changed file that is neither inside one
 * package/app/blender dir (OWNED_PATHS) nor known-inert (INERT_PATHS: docs,
 * Markdown, licence) runs everything. Root package.json, tsconfig.json,
 * examples/, a new top-level dir — whatever we did not classify — can affect
 * every package, so an unknown file must never be read as "touches nothing".
 *
 * --no-shared: match only --paths, not SHARED_PATHS or the unowned-file rule (the
 * Blender rebuild does not depend on the other workflows, scripts/ or root config).
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

/** Paths that belong to exactly one job's scope (matched by that job's --paths). */
export const OWNED_PATHS = ['^packages/[^/]+/', '^apps/[^/]+/', '^blender/'];

/** Paths no build or test reads. Anything else outside OWNED_PATHS runs every job. */
export const INERT_PATHS = [
  '^docs/',
  '^[^/]+\\.md$',
  '^LICENSE$',
  '^\\.github/(CODEOWNERS|dependabot\\.yml|actionlint\\.yaml)$',
];

/**
 * Every scoped CI job and the paths whose change can affect it (regexes on repo-relative paths).
 * A job's paths must list every directory its tests read, not just its own package:
 * - editor-2.5d-react: models-contract needs one GLB per blender/parts/*.py, and the logo/objects
 *   tests load packages/library-cloud/assets/models.
 * - small-packages: all five packages run, or none. assets-aws tests import provider-aws
 *   DEFAULT_PART_HINTS, and library-cloud/assets-aws conformance tests consume the
 *   editor-2.5d-react contracts, so a change to any of them (or to editor-2.5d-react) selects all.
 * - studio: the studio and the MCP server consume the BUILT editor-2.5d-react, provider-http,
 *   provider-aws and library-cloud (file: deps), and the MCP server bundles apps/studio/src.
 * - blender-drift (shared: false): only the Blender scripts, the GLBs and their build tooling feed
 *   the rebuild; other workflows, scripts/ and root config do not.
 * The other two package legs read only their own package (checked 2026-11-03 with rg for ../../
 * reads). scripts/ci-scope.test.mjs pins the cross-reads and that the workflows use --job.
 */
export const JOBS = {
  'editor-2.5d-react': { paths: ['^(packages/(editor-2\\.5d-react|library-cloud)|blender)/'] },
  'editor-2d-react': { paths: ['^packages/editor-2d-react/'] },
  'viewer-3d-react': { paths: ['^packages/viewer-3d-react/'] },
  'small-packages': { paths: ['^packages/(flow-runtime|provider-http|library-cloud|provider-aws|assets-aws|editor-2\\.5d-react)/'] },
  studio: { paths: ['^apps/studio/', '^packages/(editor-2\\.5d-react|provider-http|provider-aws|library-cloud|mcp)/'] },
  'blender-drift': {
    shared: false,
    paths: [
      '^blender/',
      '^packages/library-cloud/',
      '^packages/editor-2\\.5d-react/assets/models/',
      '^packages/editor-2\\.5d-react/scripts/build-parts\\.mjs$',
      '^packages/editor-2\\.5d-react/src/models/',
      '^\\.github/workflows/blender-drift\\.yml$',
      '^scripts/ci-scope\\.mjs$',
    ],
  },
};

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
  if (shared) {
    const known = [...OWNED_PATHS, ...INERT_PATHS].map((p) => new RegExp(p));
    const unowned = changed.find((file) => !known.some((re) => re.test(file)));
    if (unowned) return { run: true, reason: `${unowned} is outside every package and not known-inert: run (fail closed)` };
  }
  return { run: false, reason: `none of the ${changed.length} changed file(s) match ${paths.join(' | ')}: skip` };
}

/** Parse `--name value` pairs and the `--no-shared` switch; `--paths` may repeat; `--job` names a JOBS entry. */
export function parseArgs(argv) {
  const out = { event: '', base: '', sdkRef: 'main', paths: [], cwd: '.', shared: true };
  /** --job fills paths/shared from JOBS; applied after the loop so flag order does not matter. */
  let job;
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
    else if (flag === '--job') job = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  if (job !== undefined) {
    const spec = JOBS[job];
    if (!spec) throw new Error(`unknown job ${job} (known: ${Object.keys(JOBS).join(', ')})`);
    if (out.paths.length) throw new Error('--job and --paths are exclusive');
    out.paths = [...spec.paths];
    if (spec.shared === false) out.shared = false;
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
    // -z: without it git C-quotes names with non-ASCII/special characters
    // ("packages/x/caf\303\251.ts"), which then fail the ^packages/ match and skip.
    return git('diff', '--no-renames', '--name-only', '-z', base, 'HEAD').split('\0').filter(Boolean);
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
