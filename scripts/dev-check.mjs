#!/usr/bin/env node
/**
 * dev-check — the one local entry point for checks in this repo (holodeck).
 *
 *   scripts/dev-check.sh [fast|push|full] [--base <ref>] [--list] [--e2e]
 *
 * Tiers (TESTING.md; ~/dev/hyperdrive/.agents/plans/dev-loop-shift-left.md):
 *   fast  (L1, pre-push hook) the packages whose files changed: type check + the unit tests
 *         related to the changed files (`vitest related`, render tests skipped). ≤ 60 s.
 *   push  (L2, before a PR / review) every CI job the diff selects (scripts/ci-scope.mjs JOBS:
 *         the touched packages and the ones that read them): install, type check, all tests.
 *   full  (L3, before merging a minor PR) every phase of every CI job, whatever the diff: the
 *         same scripts/ci-package.sh and scripts/ci-studio.sh phases CI runs, plus the Blender
 *         rebuild check when Blender is installed. --e2e adds the studio's Playwright e2e.
 *
 * The diff is HEAD + staged + unstaged + untracked-not-ignored files against the merge-base of
 * HEAD and `--base` (default origin/main). Fail closed: a file outside every package that is not
 * known-inert selects the whole `push` set; a workflow / toolchain / lockfile / package config
 * change selects `full`; an unreadable diff selects `full`.
 *
 * Steps run in parallel up to DEV_CHECK_JOBS (default: a third of the CPUs, at least 2), with
 * two kinds of lock: a package directory (no two pnpm installs/builds in one package at once)
 * and `browser` (one headless-WebGPU user at a time: parallel render suites race for the GPU and
 * time out). Each step's output goes to .dev-check/logs/<step>.log; a failing step's tail is
 * printed. The last line is exactly
 *   dev-check: <mode> PASS|FAIL in <N>s — <step>=<passed count or ok|FAIL|skip>; …
 * and every run (not --list) writes .dev-check/last.json, which
 * ~/dev/hyperdrive/scripts/ci-local-status.sh reads to post `ci/local`.
 *
 * One source of truth with CI: package and studio steps ARE the CI scripts' phases
 * (ci-package.sh / ci-studio.sh --only <phase>), push selection IS ci-scope.mjs decide() over
 * JOBS, and scripts/dev-check.test.mjs pins the scripts-test and Blender commands against the
 * workflows. Same shape as holodeck-sdk/wormhole scripts/dev-check.mjs (contract, last.json).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { decide, INERT_PATHS, JOBS, SHARED_PATHS } from './ci-scope.mjs';

export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MODES = ['fast', 'push', 'full'];
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** The SDK is a file: dependency at ../holodeck-sdk/ts (a symlink to the main checkout in a worktree). */
const SDK_DIR = '../holodeck-sdk/ts';

/**
 * Every local target and the CI job that covers it (JOBS in scripts/ci-scope.mjs).
 * kind: package = packages/<name> gated by scripts/ci-package.sh; studio = apps/studio gated
 * by scripts/ci-studio.sh; scripts = the repo scripts' node:test suites; blender = the rebuild
 * check from blender-drift.yml. The small-packages list must equal ci.yml's PACKAGES (pinned).
 */
export const TARGETS = {
  'editor-2.5d-react': { kind: 'package', job: 'editor-2.5d-react' },
  'editor-2d-react': { kind: 'package', job: 'editor-2d-react' },
  'viewer-3d-react': { kind: 'package', job: 'viewer-3d-react' },
  'flow-runtime': { kind: 'package', job: 'small-packages' },
  'provider-http': { kind: 'package', job: 'small-packages' },
  'library-cloud': { kind: 'package', job: 'small-packages' },
  'provider-aws': { kind: 'package', job: 'small-packages' },
  'assets-aws': { kind: 'package', job: 'small-packages' },
  scripts: { kind: 'scripts', job: 'small-packages' },
  studio: { kind: 'studio', job: 'studio' },
  mcp: { kind: 'package', job: 'studio' },
  blender: { kind: 'blender', job: 'blender-drift' },
};

/** The scripts suites, exactly as ci.yml's small-packages job runs them (pinned). */
export const SCRIPTS_TEST = 'node --test "scripts/**/*.test.mjs"';

/** blender-drift.yml's two rebuild checks: [package, command] (pinned against the workflow). */
export const BLENDER_CHECKS = [
  ['library-cloud', 'pnpm exec vitest run src/cloud-glb.test.ts'],
  ['editor-2.5d-react', 'pnpm exec vitest run src/models/valve-glb.test.ts'],
];

/** Packages whose `test` phase drives a browser (the others skip render tests or have none). */
const RENDER_TESTS = new Set(['editor-2.5d-react', 'mcp']);

/**
 * Paths that change what every check means: escalate to `full`. Package lockfiles and configs
 * too: the plan's rule is "lockfile / toolchain / workflow / root config change → full".
 */
export const FULL_PATHS = [
  [/^\.github\/workflows\//, 'CI workflow'],
  [/^\.github\/holodeck-sdk-ref$/, 'holodeck-sdk ref pin'],
  [/^\.node-version$/, 'Node toolchain pin'],
  [/^(packages|apps)\/[^/]+\/(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/, 'dependencies / lockfile'],
  [/^(packages|apps)\/[^/]+\/(tsconfig[^/]*\.json|vitest\.(config|workspace)\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|tsup\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s)$/, 'build / test config'],
  [/^scripts\/(ci-package\.sh|ci-studio\.sh|ci-scope\.mjs|dev-check\.mjs)$/, 'CI / dev-check plumbing'],
];

// ---------------------------------------------------------------------------------------------
// Pure planning logic (unit-tested in dev-check.test.mjs).
// ---------------------------------------------------------------------------------------------

/** @returns {{ mode: string, base: string, list: boolean, e2e: boolean, help?: boolean }} */
export function parseArgs(argv) {
  const out = { mode: 'fast', base: 'origin/main', list: false, e2e: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (MODES.includes(arg)) out.mode = arg;
    else if (arg === '--list') out.list = true;
    else if (arg === '--e2e') out.e2e = true;
    else if (arg === '--base') {
      if (!argv[i + 1]) throw new Error('--base needs a ref');
      out.base = argv[++i];
    } else if (arg.startsWith('--base=')) out.base = arg.slice('--base='.length);
    else if (arg === '-h' || arg === '--help') out.help = true;
    else throw new Error(`unknown argument: ${arg} (usage: dev-check.sh [fast|push|full] [--base <ref>] [--list] [--e2e])`);
  }
  return out;
}

const matches = (patterns, file) => patterns.some((p) => new RegExp(p).test(file));

/**
 * Classifies one changed path for `fast`.
 * @returns {{ kind: 'full' | 'unowned' | 'inert' | 'target', target?: string, why: string }}
 */
export function classify(file) {
  const full = FULL_PATHS.find(([re]) => re.test(file));
  if (full) return { kind: 'full', why: full[1] };
  if (/^\.githooks\//.test(file)) return { kind: 'target', target: 'scripts', why: 'git hooks' };
  if (/^scripts\//.test(file)) return { kind: 'target', target: 'scripts', why: 'repo script' };
  const pkg = file.match(/^packages\/([^/]+)\//)?.[1];
  if (pkg && TARGETS[pkg]?.kind === 'package') return { kind: 'target', target: pkg, why: `packages/${pkg}` };
  if (/^apps\/studio\//.test(file)) return { kind: 'target', target: 'studio', why: 'apps/studio' };
  if (matches(INERT_PATHS, file)) return { kind: 'inert', why: 'inert (docs, Markdown, licence, repo metadata)' };
  // blender/, examples/, packages without a gate (cli), new top-level dirs, shared CI inputs:
  // no file-level mapping to a package's tests, so the whole push set (fail closed).
  return { kind: 'unowned', why: matches(SHARED_PATHS, file) ? 'shared CI input' : 'no fast rule owns it' };
}

/**
 * Decides what to run.
 * @param {{
 *   mode: string, e2e?: boolean, changed: string[] | null,
 *   phases: (pkg: string) => string[],   // scripts/ci-package.sh <pkg> --phases
 *   studio: { phases: string[], deps: string[] },  // scripts/ci-studio.sh --phases / --deps
 *   chromium?: string | null, blender?: boolean, sdkBuilt?: boolean,
 * }} input
 * @returns {{ mode: string, requested: string, reasons: string[], notes: string[], nothingChanged: boolean, steps: Step[] }}
 *
 * @typedef {{ name: string, target: string, cwd: string, command: string, env: Record<string, string>,
 *   needs: string[], locks: string[], why: string }} Step
 */
export function plan({ mode, e2e = false, changed, phases, studio, chromium = null, blender = false, sdkBuilt = true }) {
  const reasons = [];
  const notes = [];
  let effective = mode;
  const RANK = { fast: 0, push: 1, full: 2 };
  const escalate = (to, reason) => {
    reasons.push(reason);
    if (RANK[to] > RANK[effective]) effective = to;
  };

  if (changed === null) escalate('full', 'could not read the diff: full (fail closed)');
  const files = changed ?? [];
  const nothingChanged = changed !== null && files.length === 0;

  /** fast: target → changed files inside it (repo-relative) and the first reason. */
  const fastTargets = new Map();
  for (const file of files) {
    const c = classify(file);
    if (c.kind === 'full') escalate('full', `${file}: ${c.why} → full`);
    else if (c.kind === 'unowned') escalate('push', `${file}: ${c.why} → push (fail closed)`);
    else if (c.kind === 'target') {
      if (!fastTargets.has(c.target)) fastTargets.set(c.target, { files: [], why: `${file} (${c.why})` });
      fastTargets.get(c.target).files.push(file);
    }
  }
  if (nothingChanged && effective !== 'full') return { mode: effective, requested: mode, reasons, notes, nothingChanged, steps: [] };

  /** push/full: target → why. push uses CI's own scope decision per job. */
  const selected = new Map();
  if (effective === 'full') {
    for (const t of Object.keys(TARGETS)) selected.set(t, 'full: every CI job');
  } else if (effective === 'push') {
    for (const [t, { job }] of Object.entries(TARGETS)) {
      const spec = JOBS[job];
      const d = decide({ event: 'pull_request', changed: files, paths: spec.paths, shared: spec.shared !== false });
      if (d.run) selected.set(t, `CI job ${job}: ${d.reason}`);
    }
  } else {
    for (const [t, { why }] of fastTargets) selected.set(t, why);
  }

  // Environment shared by every step: CI's package jobs have no Blender; the browser is the
  // local Chrome when one exists (render tests then run as on CI), else render tests skip.
  // npm_config_confirm_modules_purge=false: steps run without a TTY, where pnpm would otherwise
  // abort an install that has to rebuild node_modules (AGENTS.md's `CI=true pnpm install`
  // works around the same prompt, but CI=true also switches tests to their stricter CI branches).
  const baseEnv = { HOLODECK_SKIP_BLENDER: '1', npm_config_confirm_modules_purge: 'false' };
  const browser = effective !== 'fast' && chromium;
  if (browser) baseEnv.HOLODECK_CHROMIUM = chromium;
  else baseEnv.HOLODECK_SKIP_RENDER_TESTS = '1';
  if (effective === 'fast') notes.push('fast: render tests skipped (HOLODECK_SKIP_RENDER_TESTS=1); they run in push/full');
  else if (!chromium) notes.push(`no Chrome found (set HOLODECK_CHROMIUM): render tests, the Vite consumer check and e2e are SKIPPED; they still run on CI`);

  const steps = [];
  const add = (step) => steps.push({ env: baseEnv, needs: [], locks: [], ...step });
  const sdk = sdkBuilt ? [] : ['sdk:build'];
  if (!sdkBuilt && selected.size) {
    add({ name: 'sdk:build', target: 'sdk', cwd: SDK_DIR, command: 'pnpm install --frozen-lockfile && pnpm build', locks: ['sdk'], why: `${SDK_DIR}/dist missing (file: dependency of every package)` });
  }
  /** Chains a target's steps: each needs the previous one of the same target. */
  const chain = (list) => list.forEach((s, i) => add({ ...s, needs: [...(s.needs ?? []), ...(i ? [list[i - 1].name] : sdk)] }));
  const ci = (pkg, only) => `scripts/ci-package.sh ${pkg} --only ${only}`;

  for (const [target, why] of selected) {
    const { kind } = TARGETS[target];
    const dir = kind === 'package' ? `packages/${target}` : kind === 'studio' ? 'apps/studio' : '.';
    const fast = fastTargets.get(target);

    if (kind === 'scripts') {
      add({ name: 'scripts:test', target, cwd: '.', command: SCRIPTS_TEST, why });
      continue;
    }

    if (kind === 'blender') {
      if (effective === 'fast') continue;
      if (!blender) {
        notes.push('Blender not installed: the GLB rebuild check is SKIPPED here (blender-drift.yml runs it on CI)');
        continue;
      }
      chain(BLENDER_CHECKS.map(([pkg, command]) => ({
        name: `blender:${pkg}`, target, cwd: `packages/${pkg}`, command,
        // Readers only (the rebuilds go to a temp dir), so no package lock.
        env: { HOLODECK_REQUIRE_BLENDER: '1', HOLODECK_SKIP_RENDER_TESTS: '1' }, why,
      })));
      continue;
    }

    if (effective === 'fast') {
      // Type check + the tests related to the changed files (vitest follows imports; a changed
      // test file selects itself). Deleted files are left out: vitest cannot resolve them.
      const prefix = `${dir}/`;
      const rel = fast.files.map((f) => f.slice(prefix.length)).filter((f) => /\.(m?[jt]sx?|json)$/.test(f));
      const list = [{ name: `${target}:typecheck`, target, cwd: dir, command: 'pnpm type-check', locks: [], why }];
      if (rel.length) {
        list.push({ name: `${target}:related`, target, cwd: dir, command: `pnpm exec vitest related --run --passWithNoTests ${rel.map(shellQuote).join(' ')}`, locks: [], why });
      }
      chain(list);
      continue;
    }

    if (kind === 'package') {
      // push: install + type check + tests. full: every phase, as three steps:
      //   <pkg>:build          install, type check, build and the dist smoke checks
      //   <pkg>:test           the tests (render tests drive the browser in editor-2.5d-react, mcp)
      //   <pkg>:vite-consumer  the Vite consumer check (browser), where the package has one
      // Builds go first (CI: tests first) so the studio and the MCP server wait only for the
      // builds, not for editor-2.5d-react's minutes of render tests.
      const all = phases(target);
      const groups = effective === 'full'
        ? [['build', all.filter((p) => p !== 'test' && p !== 'vite-consumer')], ['test', ['test']], ['vite-consumer', all.includes('vite-consumer') && browser ? ['vite-consumer'] : []]]
        : [['test', all.filter((p) => ['install', 'typecheck', 'test'].includes(p))]];
      if (effective === 'full' && !browser && all.includes('vite-consumer')) notes.push(`${target}: Vite consumer check SKIPPED (no Chrome)`);
      const usesBrowser = (name) => browser && (name === 'vite-consumer' || (name === 'test' && RENDER_TESTS.has(target)));
      chain(groups.filter(([, list]) => list.length).map(([name, list]) => ({
        name: `${target}:${name}`, target, cwd: '.', command: ci(target, list.join(',')),
        locks: [dir, ...(usesBrowser(name) ? ['browser'] : [])], why,
      })));
      continue;
    }

    // studio: its file: deps must be built (and not rebuilt underneath it) before it installs.
    // full builds them in their own <pkg>:build steps; push builds them in one studio:deps step.
    //   studio:check  install, type check, unit tests (+ the production build in full)
    //   studio:e2e    Playwright over the production build (--e2e, browser)
    const list = [];
    let depNeeds = [];
    if (effective === 'full') depNeeds = studio.deps.map((d) => `${d}:build`);
    else list.push({ name: 'studio:deps', target, cwd: '.', command: 'scripts/ci-studio.sh --only deps', locks: studio.deps.map((d) => `packages/${d}`), why });
    const check = studio.phases.filter((p) => ['install', 'typecheck', 'test'].includes(p) || (p === 'build' && effective === 'full'));
    list.push({ name: 'studio:check', target, cwd: '.', command: `scripts/ci-studio.sh --only ${check.join(',')}`, needs: depNeeds, locks: ['apps/studio'], why });
    if (e2e && effective !== 'full') notes.push('--e2e needs the production build: use it with full');
    else if (e2e && !browser) notes.push('--e2e: no Chrome found, studio e2e SKIPPED');
    else if (e2e) list.push({ name: 'studio:e2e', target, cwd: '.', command: 'scripts/ci-studio.sh --only e2e', locks: ['apps/studio', 'browser'], why });
    chain(list);
  }

  // mcp installs the four built packages (and its render test reads apps/studio/dist), so its
  // steps wait for whatever this run builds of them; mcp's chain head gets the extra needs.
  const names = new Set(steps.map((s) => s.name));
  const mcpHead = steps.find((s) => s.target === 'mcp');
  if (mcpHead && effective !== 'fast') {
    const before = [...studio.deps.map((d) => `${d}:build`), 'studio:deps', 'studio:check'].filter((n) => names.has(n));
    mcpHead.needs = [...mcpHead.needs, ...before];
  }
  return { mode: effective, requested: mode, reasons, notes, nothingChanged, steps };
}

/** POSIX single-quote a word for `sh -c` when it needs it. */
export function shellQuote(word) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Passed-test count from a step's output, or null when it printed none. Sums every summary line
 * (several ci-package phases or `pnpm -r` runs add up). Recognises Vitest (`Tests  12 passed (12)`,
 * `Tests  163 passed | 6 skipped (169)`), node:test (`ℹ pass 12`, TAP `# pass 12`) and
 * Playwright (`  12 passed (30.1s)`).
 */
export function passedCount(output) {
  const text = output.replace(ANSI, '');
  let total = null;
  for (const re of [/\bTests\s+(\d+) passed\b/g, /^[ℹ#] pass (\d+)$/gm, /^\s+(\d+) passed \(\d/gm]) {
    for (const m of text.matchAll(re)) total = (total ?? 0) + Number(m[1]);
  }
  return total;
}

/** The contract's last line. */
export function summaryLine(mode, results, seconds, note) {
  const pass = results.every((r) => r.result !== 'fail');
  const parts = results.map((r) => `${r.name}=${r.result === 'pass' ? (r.passed ?? 'ok') : r.result === 'skip' ? 'skip' : 'FAIL'}`);
  const tail = parts.length ? parts.join('; ') : note;
  return `dev-check: ${mode} ${pass ? 'PASS' : 'FAIL'} in ${Math.round(seconds)}s — ${tail}`;
}

/**
 * Runs steps respecting needs (a step whose need failed is skipped), locks and a parallelism
 * cap. `run(step)` resolves to a result { name, result: 'pass'|'fail', ... }. Results come back
 * in the plan's order. Pure scheduling: unit-tested with a fake `run`.
 */
export async function schedule(steps, run, { jobs = 2, onStart = () => {} } = {}) {
  const state = new Map(steps.map((s) => [s.name, 'waiting']));
  const results = new Map();
  const held = new Set();
  let running = 0;
  return new Promise((resolveAll) => {
    const pump = () => {
      for (const step of steps) {
        if (state.get(step.name) !== 'waiting') continue;
        const needs = step.needs.filter((n) => state.has(n));
        if (needs.some((n) => ['fail', 'skip'].includes(state.get(n)))) {
          state.set(step.name, 'skip');
          results.set(step.name, { name: step.name, command: step.command, seconds: 0, result: 'skip', passed: null, skipped: `needs ${needs.find((n) => ['fail', 'skip'].includes(state.get(n)))}` });
          continue;
        }
        if (!needs.every((n) => state.get(n) === 'pass')) continue;
        if (running >= jobs || step.locks.some((l) => held.has(l))) continue;
        state.set(step.name, 'running');
        running += 1;
        step.locks.forEach((l) => held.add(l));
        onStart(step);
        Promise.resolve(run(step)).then((r) => {
          running -= 1;
          step.locks.forEach((l) => held.delete(l));
          state.set(step.name, r.result);
          results.set(step.name, r);
          pump();
        });
      }
      // A skip can unblock nothing new but may finish the run; re-check until stable.
      if (running === 0) {
        const waiting = steps.filter((s) => state.get(s.name) === 'waiting');
        if (waiting.length && waiting.some((s) => s.needs.some((n) => ['fail', 'skip'].includes(state.get(n))))) return pump();
        for (const s of waiting) results.set(s.name, { name: s.name, command: s.command, seconds: 0, result: 'skip', passed: null, skipped: 'unsatisfiable needs' });
        resolveAll(steps.map((s) => results.get(s.name)));
      }
    };
    pump();
  });
}

// ---------------------------------------------------------------------------------------------
// Machine, git and process plumbing.
// ---------------------------------------------------------------------------------------------

function sh(command, args, cwd = REPO_ROOT) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

/**
 * Changed paths vs the merge-base of HEAD and `base`: committed, staged and unstaged changes
 * (`git diff <merge-base>` compares the working tree) plus untracked files that are not ignored.
 * Returns { base: <merge-base sha or the ref>, changed: string[] | null } (null = unreadable).
 */
export function changedFiles(baseRef, cwd = REPO_ROOT) {
  const mergeBase = sh('git', ['merge-base', 'HEAD', baseRef], cwd)?.trim();
  if (!mergeBase) return { base: baseRef, changed: null };
  // -z: git C-quotes non-ASCII names otherwise, and they would then match no rule.
  const diff = sh('git', ['diff', '--name-only', '--no-renames', '-z', mergeBase], cwd);
  const untracked = sh('git', ['ls-files', '--others', '--exclude-standard', '-z'], cwd);
  if (diff === null || untracked === null) return { base: mergeBase, changed: null };
  const files = new Set([...diff.split('\0'), ...untracked.split('\0')].filter(Boolean));
  return { base: mergeBase, changed: [...files].sort() };
}

/**
 * HOLODECK_CHROMIUM if set (must exist), else the macOS Chrome, else null. HOLODECK_SKIP_RENDER_TESTS=1
 * (the packages' own opt-out) means no browser: render tests, the Vite consumer check and e2e skip
 * with a note. Use it when the Mac's GPU is busy (other sessions' WebGPU e2e: holodeck#300) and
 * let the boat CI run cover the browser steps.
 */
export function findChromium(env = process.env) {
  if (env.HOLODECK_SKIP_RENDER_TESTS === '1') return null;
  if (env.HOLODECK_CHROMIUM) return existsSync(env.HOLODECK_CHROMIUM) ? env.HOLODECK_CHROMIUM : null;
  return existsSync(MAC_CHROME) ? MAC_CHROME : null;
}

async function findBlender() {
  const { findBlender: find } = await import(pathToFileURL(join(REPO_ROOT, 'packages/editor-2.5d-react/scripts/build-parts.mjs')).href);
  return find();
}

function ciPhases(script, ...args) {
  const out = sh(join(REPO_ROOT, 'scripts', script), args);
  if (out === null) throw new Error(`scripts/${script} ${args.join(' ')} failed`);
  return out.split('\n').filter(Boolean);
}

function runStep(step, logDir) {
  return new Promise((resolve) => {
    const started = performance.now();
    const log = join(logDir, `${step.name.replaceAll(/[^\w.-]/g, '_')}.log`);
    const file = createWriteStream(log);
    const env = { ...process.env, ...step.env };
    const child = spawn('sh', ['-c', step.command], { cwd: join(REPO_ROOT, step.cwd), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const take = (d) => {
      output += d;
      file.write(d);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => {
      file.end();
      const seconds = Number(((performance.now() - started) / 1000).toFixed(2));
      resolve({ name: step.name, command: step.command, seconds, result: code === 0 ? 'pass' : 'fail', passed: code === 0 ? passedCount(output) : null, log, output });
    });
  });
}

function writeLast(record) {
  const dir = join(REPO_ROOT, '.dev-check');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'last.json'), `${JSON.stringify(record, null, 2)}\n`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`dev-check: ${error.message}`);
    return 2;
  }
  if (args.help) {
    console.log('usage: scripts/dev-check.sh [fast|push|full] [--base <ref>] [--list] [--e2e]\nSee TESTING.md.');
    return 0;
  }
  const started = performance.now();
  const { base, changed } = changedFiles(args.base);
  const chromium = findChromium();
  const blender = await findBlender();
  const sdkBuilt = existsSync(join(REPO_ROOT, SDK_DIR, 'dist/index.js'));
  const p = plan({
    mode: args.mode,
    e2e: args.e2e,
    changed,
    phases: (pkg) => ciPhases('ci-package.sh', pkg, '--phases'),
    studio: { phases: ciPhases('ci-studio.sh', '--phases'), deps: ciPhases('ci-studio.sh', '--deps') },
    chromium,
    blender,
    sdkBuilt,
  });
  const jobs = Number(process.env.DEV_CHECK_JOBS) || Math.max(2, Math.floor(availableParallelism() / 3));

  const header = p.mode === p.requested ? p.mode : `${p.requested} → ${p.mode}`;
  console.log(`dev-check ${header} (base ${base.slice(0, 12)}, ${changed === null ? 'diff unreadable' : `${changed.length} changed file(s)`}, ${jobs} parallel)`);
  for (const reason of p.reasons.slice(0, 10)) console.log(`  escalated: ${reason}`);
  if (p.reasons.length > 10) console.log(`  … and ${p.reasons.length - 10} more`);
  for (const note of p.notes) console.log(`  note: ${note}`);

  if (args.list) {
    if (!p.steps.length) console.log('  nothing to run');
    let target;
    for (const step of p.steps) {
      if (step.target !== target) console.log(`${step.target} ← ${step.why}`);
      target = step.target;
      const extra = [step.needs.length ? `after ${step.needs.join(', ')}` : '', step.locks.includes('browser') ? 'browser' : ''].filter(Boolean).join('; ');
      console.log(`  ${step.name.padEnd(28)} ${step.cwd === '.' ? '' : `(cd ${step.cwd}) `}${step.command}${extra ? `  [${extra}]` : ''}`);
    }
    return 0;
  }

  const logDir = join(REPO_ROOT, '.dev-check/logs');
  mkdirSync(logDir, { recursive: true });
  const results = await schedule(p.steps, async (step) => {
    const r = await runStep(step, logDir);
    const mark = r.result === 'pass' ? '✔' : '✘';
    console.log(`${mark} ${step.name} ${r.seconds.toFixed(1)}s${r.passed !== null ? ` (${r.passed} passed)` : ''}`);
    if (r.result === 'fail') {
      const tail = r.output.replace(ANSI, '').trimEnd().split('\n').slice(-60).join('\n');
      console.log(`---- ${step.name}: (cd ${step.cwd} && ${step.command}) — last 60 lines, full log ${r.log}\n${tail}\n----`);
    }
    delete r.output;
    return r;
  }, { jobs, onStart: (step) => console.log(`▶ ${step.name}: (cd ${step.cwd} && ${step.command})   ← ${step.why}`) });
  for (const r of results.filter((x) => x.result === 'skip')) console.log(`- ${r.name} skipped (${r.skipped})`);

  const seconds = (performance.now() - started) / 1000;
  const note = p.nothingChanged ? `nothing changed vs ${base.slice(0, 12)}` : 'nothing selected (inert files only)';
  const summary = summaryLine(p.mode, results, seconds, note);
  const pass = results.every((r) => r.result === 'pass');
  writeLast({
    mode: p.mode,
    requested: p.requested,
    result: pass ? 'PASS' : 'FAIL',
    head: sh('git', ['rev-parse', 'HEAD'])?.trim() ?? null,
    dirty: (sh('git', ['status', '--porcelain']) ?? 'unknown').trim() !== '',
    base,
    seconds: Number(seconds.toFixed(1)),
    e2e: args.e2e,
    notes: p.notes,
    steps: results,
    summary,
  });
  console.log(`\n${summary}`);
  return pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
