/**
 * Tests for dev-check.mjs: path classification, the plan per tier, the scheduler, the summary
 * contract, and pins that its commands are the ones the workflows run.
 *
 *   node --test "scripts/**\/*.test.mjs"
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  BLENDER_CHECKS,
  changedFiles,
  classify,
  findChromium,
  parseArgs,
  passedCount,
  plan,
  REPO_ROOT,
  schedule,
  SCRIPTS_TEST,
  shellQuote,
  summaryLine,
  TARGETS,
} from './dev-check.mjs';

const run = (script, ...args) => execFileSync(join(REPO_ROOT, 'scripts', script), args, { encoding: 'utf8' }).split('\n').filter(Boolean);
/** The real phase lists, so plans here match what the scripts would do. */
const PHASES = Object.fromEntries(Object.entries(TARGETS).filter(([, t]) => t.kind === 'package').map(([p]) => [p, run('ci-package.sh', p, '--phases')]));
const STUDIO = { phases: run('ci-studio.sh', '--phases'), deps: run('ci-studio.sh', '--deps') };
const CHROME = '/chrome';
const mk = (input) => plan({ phases: (p) => PHASES[p], studio: STUDIO, chromium: CHROME, blender: true, ...input });
const names = (p) => p.steps.map((s) => s.name);
const workflow = (name) => readFileSync(join(REPO_ROOT, '.github/workflows', name), 'utf8');

// --- arguments ----------------------------------------------------------------

test('parseArgs: mode, base, flags; unknown arguments are errors', () => {
  assert.deepEqual(parseArgs([]), { mode: 'fast', base: 'origin/main', list: false, e2e: false });
  assert.deepEqual(parseArgs(['full', '--base', 'abc', '--list', '--e2e']), { mode: 'full', base: 'abc', list: true, e2e: true });
  assert.equal(parseArgs(['--base=x']).base, 'x');
  assert.throws(() => parseArgs(['--base']), /needs a ref/);
  assert.throws(() => parseArgs(['quick']), /unknown argument/);
});

// --- classification -------------------------------------------------------------

test('classify: package, studio and script files map to their target', () => {
  assert.deepEqual(classify('packages/flow-runtime/src/run.ts'), { kind: 'target', target: 'flow-runtime', why: 'packages/flow-runtime' });
  assert.equal(classify('apps/studio/src/app.tsx').target, 'studio');
  assert.equal(classify('scripts/smoke-dist.mjs').target, 'scripts');
  assert.equal(classify('.githooks/pre-push').target, 'scripts');
});

test('classify: workflows, toolchain, lockfiles, package config and CI plumbing escalate to full', () => {
  for (const file of [
    '.github/workflows/ci.yml',
    '.node-version',
    '.github/holodeck-sdk-ref',
    'packages/editor-2.5d-react/pnpm-lock.yaml',
    'packages/provider-aws/package.json',
    'apps/studio/package.json',
    'packages/editor-2.5d-react/vitest.config.ts',
    'packages/editor-2.5d-react/vitest.workspace.ts',
    'packages/flow-runtime/tsup.config.ts',
    'packages/mcp/tsconfig.json',
    'apps/studio/playwright.config.ts',
    'scripts/ci-package.sh',
    'scripts/ci-scope.mjs',
    'scripts/dev-check.mjs',
  ]) assert.equal(classify(file).kind, 'full', file);
});

test('classify: docs and root Markdown are inert; everything else outside a package fails closed', () => {
  for (const file of ['docs/x.md', 'README.md', 'TESTING.md', 'LICENSE', '.gitignore']) assert.equal(classify(file).kind, 'inert', file);
  for (const file of ['blender/parts/valve.py', 'examples/brewery/scene.json', 'package.json', 'tsconfig.json', 'packages/cli/src/a.ts', 'newdir/a.ts']) {
    assert.equal(classify(file).kind, 'unowned', file);
  }
});

// --- plans --------------------------------------------------------------------------

test('fast: type check + related tests of the touched package only, render tests skipped', () => {
  const p = mk({ mode: 'fast', changed: ['packages/flow-runtime/src/run.ts', 'packages/flow-runtime/README.md', 'docs/a.md'] });
  assert.equal(p.mode, 'fast');
  assert.deepEqual(names(p), ['flow-runtime:typecheck', 'flow-runtime:related']);
  const [tc, rel] = p.steps;
  assert.equal(tc.cwd, 'packages/flow-runtime');
  assert.equal(rel.command, 'pnpm exec vitest related --run --passWithNoTests src/run.ts');
  assert.deepEqual(rel.needs, ['flow-runtime:typecheck']);
  assert.equal(rel.env.HOLODECK_SKIP_RENDER_TESTS, '1');
  assert.equal(rel.env.HOLODECK_SKIP_BLENDER, '1');
  assert.equal(rel.env.HOLODECK_CHROMIUM, undefined);
});

test('fast: a change with no code file type-checks only; file names are shell-quoted', () => {
  assert.deepEqual(names(mk({ mode: 'fast', changed: ['packages/mcp/README.md'] })), ['mcp:typecheck']);
  const p = mk({ mode: 'fast', changed: ["apps/studio/src/it's.ts"] });
  assert.match(p.steps[1].command, /'src\/it'\\''s\.ts'$/);
  assert.equal(p.steps[1].cwd, 'apps/studio');
});

test('fast: script changes run the scripts suites, exactly as CI does', () => {
  const p = mk({ mode: 'fast', changed: ['scripts/smoke-dist.mjs'] });
  assert.deepEqual(names(p), ['scripts:test']);
  assert.equal(p.steps[0].command, SCRIPTS_TEST);
});

test('fast: an unowned file escalates to push, a workflow to full, an unreadable diff to full', () => {
  assert.equal(mk({ mode: 'fast', changed: ['blender/parts/valve.py'] }).mode, 'push');
  assert.equal(mk({ mode: 'fast', changed: ['.github/workflows/ci.yml'] }).mode, 'full');
  const p = mk({ mode: 'fast', changed: null });
  assert.equal(p.mode, 'full');
  assert.match(p.reasons[0], /fail closed/);
});

test('fast/push with nothing changed run nothing; full always runs', () => {
  for (const mode of ['fast', 'push']) {
    const p = mk({ mode, changed: [] });
    assert.equal(p.nothingChanged, true);
    assert.deepEqual(p.steps, []);
  }
  assert.ok(mk({ mode: 'full', changed: [] }).steps.length > 10);
});

test('fast with only inert files runs nothing', () => {
  assert.deepEqual(mk({ mode: 'fast', changed: ['README.md', 'docs/x.md'] }).steps, []);
});

test('push: the CI jobs the diff selects (ci-scope JOBS), install + type check + tests, with render tests', () => {
  const p = mk({ mode: 'push', changed: ['packages/viewer-3d-react/src/a.ts'] });
  assert.deepEqual(names(p), ['viewer-3d-react:test']);
  assert.equal(p.steps[0].command, 'scripts/ci-package.sh viewer-3d-react --only install,typecheck,test');
  assert.equal(p.steps[0].env.HOLODECK_CHROMIUM, CHROME);
});

test('push: a library-cloud change selects its readers: editor-2.5d-react, the small packages, the studio, mcp, Blender', () => {
  const p = mk({ mode: 'push', changed: ['packages/library-cloud/src/parts.json'] });
  const targets = [...new Set(p.steps.map((s) => s.target))].sort();
  assert.deepEqual(targets, ['assets-aws', 'blender', 'editor-2.5d-react', 'flow-runtime', 'library-cloud', 'mcp', 'provider-aws', 'provider-http', 'scripts', 'studio']);
  // The studio's file: deps are built once, in studio:deps, before the studio and mcp install.
  const deps = p.steps.find((s) => s.name === 'studio:deps');
  assert.deepEqual(deps.locks.sort(), STUDIO.deps.map((d) => `packages/${d}`).sort());
  assert.deepEqual(p.steps.find((s) => s.name === 'studio:check').needs, ['studio:deps']);
  assert.equal(p.steps.find((s) => s.name === 'studio:check').command, 'scripts/ci-studio.sh --only install,typecheck,test');
  assert.deepEqual(p.steps.find((s) => s.name === 'mcp:test').needs.sort(), ['studio:check', 'studio:deps']);
});

test('push: render tests lock the browser; Blender checks run with HOLODECK_REQUIRE_BLENDER, only if installed', () => {
  const p = mk({ mode: 'push', changed: ['blender/parts/valve.py', 'packages/flow-runtime/src/a.ts'] });
  assert.ok(p.steps.find((s) => s.name === 'editor-2.5d-react:test').locks.includes('browser'));
  assert.ok(!p.steps.find((s) => s.name === 'flow-runtime:test').locks.includes('browser'));
  const blender = p.steps.filter((s) => s.target === 'blender');
  assert.deepEqual(blender.map((s) => s.command), BLENDER_CHECKS.map(([, c]) => c));
  assert.equal(blender[0].env.HOLODECK_REQUIRE_BLENDER, '1');
  assert.equal(blender[0].env.HOLODECK_SKIP_BLENDER, undefined);
  const none = mk({ mode: 'push', changed: ['blender/parts/valve.py'], blender: false });
  assert.equal(none.steps.filter((s) => s.target === 'blender').length, 0);
  assert.ok(none.notes.some((n) => /Blender not installed/.test(n)));
});

test('push without Chrome: render tests skip, and the run says so', () => {
  const p = mk({ mode: 'push', changed: ['packages/editor-2.5d-react/src/a.ts'], chromium: null });
  const t = p.steps.find((s) => s.name === 'editor-2.5d-react:test');
  assert.equal(t.env.HOLODECK_SKIP_RENDER_TESTS, '1');
  assert.ok(!t.locks.includes('browser'));
  assert.ok(p.notes.some((n) => /SKIPPED/.test(n)));
});

test('full: every target, builds before tests, every ci-package phase exactly once', () => {
  const p = mk({ mode: 'full', changed: ['README.md'] });
  assert.deepEqual([...new Set(p.steps.map((s) => s.target))].sort(), Object.keys(TARGETS).sort());
  for (const [pkg, phases] of Object.entries(PHASES)) {
    const ran = p.steps.filter((s) => s.target === pkg).flatMap((s) => s.command.match(/--only (\S+)$/)[1].split(','));
    assert.deepEqual([...ran].sort(), [...phases].sort(), pkg);
    assert.equal(p.steps.filter((s) => s.target === pkg)[0].name, `${pkg}:build`, pkg);
  }
  // The studio waits for the builds of its deps only; mcp also for the studio build.
  assert.deepEqual(p.steps.find((s) => s.name === 'studio:check').needs, STUDIO.deps.map((d) => `${d}:build`));
  assert.match(p.steps.find((s) => s.name === 'studio:check').command, /install,typecheck,test,build$/);
  assert.ok(p.steps.find((s) => s.name === 'mcp:build').needs.includes('studio:check'));
  assert.ok(!names(p).includes('studio:e2e'));
});

test('full --e2e adds the studio e2e (browser); without Chrome it is skipped with a note', () => {
  const p = mk({ mode: 'full', e2e: true, changed: [] });
  const e2e = p.steps.find((s) => s.name === 'studio:e2e');
  assert.equal(e2e.command, 'scripts/ci-studio.sh --only e2e');
  assert.ok(e2e.locks.includes('browser'));
  const none = mk({ mode: 'full', e2e: true, changed: [], chromium: null });
  assert.ok(!names(none).includes('studio:e2e'));
  assert.ok(!names(none).includes('editor-2.5d-react:vite-consumer'));
  assert.ok(none.notes.some((n) => /e2e SKIPPED/.test(n)));
});

test('a missing SDK build is built first and every chain waits for it', () => {
  const p = mk({ mode: 'push', changed: ['packages/viewer-3d-react/src/a.ts'], sdkBuilt: false });
  assert.deepEqual(names(p), ['sdk:build', 'viewer-3d-react:test']);
  assert.equal(p.steps[0].cwd, '../holodeck-sdk/ts');
  assert.deepEqual(p.steps[1].needs, ['sdk:build']);
});

test('every step needs only steps that exist earlier in the plan (no cycles, no dangling needs)', () => {
  for (const input of [{ mode: 'full', e2e: true, changed: [] }, { mode: 'push', changed: ['packages/library-cloud/src/a.ts'] }, { mode: 'full', changed: [], sdkBuilt: false }]) {
    const p = mk(input);
    const seen = new Set();
    for (const s of p.steps) {
      for (const n of s.needs) assert.ok(seen.has(n), `${s.name} needs ${n}`);
      seen.add(s.name);
    }
  }
});

// --- scheduler ----------------------------------------------------------------------

const step = (name, extra = {}) => ({ name, command: name, needs: [], locks: [], ...extra });

test('schedule: runs up to `jobs` at once, respects needs and locks, returns plan order', async () => {
  const log = [];
  let live = 0;
  let peak = 0;
  const steps = [step('a', { locks: ['browser'] }), step('b', { locks: ['browser'] }), step('c'), step('d', { needs: ['c'] })];
  const results = await schedule(steps, async (s) => {
    live += 1;
    peak = Math.max(peak, live);
    log.push(`start ${s.name}`);
    await new Promise((r) => setTimeout(r, 5));
    log.push(`end ${s.name}`);
    live -= 1;
    return { name: s.name, result: 'pass' };
  }, { jobs: 2 });
  assert.deepEqual(results.map((r) => r.name), ['a', 'b', 'c', 'd']);
  assert.equal(peak, 2);
  // a and b share the browser lock: never overlap.
  assert.ok(log.indexOf('end a') < log.indexOf('start b'));
  assert.ok(log.indexOf('end c') < log.indexOf('start d'));
});

test('schedule: a failed step skips everything that needs it, transitively; others still run', async () => {
  const steps = [step('a'), step('b', { needs: ['a'] }), step('c', { needs: ['b'] }), step('d')];
  const results = await schedule(steps, async (s) => ({ name: s.name, result: s.name === 'a' ? 'fail' : 'pass' }), { jobs: 1 });
  assert.deepEqual(results.map((r) => r.result), ['fail', 'skip', 'skip', 'pass']);
  assert.match(results[2].skipped, /needs b/);
});

test('schedule: an empty plan resolves', async () => {
  assert.deepEqual(await schedule([], async () => ({})), []);
});

// --- output contract ------------------------------------------------------------------

test('passedCount: Vitest, node:test and Playwright summaries add up; none → null', () => {
  assert.equal(passedCount('      Tests  164 passed | 1 skipped (165)\n'), 164);
  assert.equal(passedCount('\x1b[2m Tests \x1b[22m 12 passed (12)\n Tests  3 passed (3)'), 15);
  assert.equal(passedCount('ℹ tests 32\nℹ pass 32\nℹ fail 0\n'), 32);
  assert.equal(passedCount('  21 passed (41.2s)\n'), 21);
  assert.equal(passedCount(' Test Files  2 passed (2)\n'), null);
  assert.equal(passedCount('built in 2s'), null);
});

test('summaryLine: the exact last-line contract', () => {
  const ok = summaryLine('push', [{ name: 'a:test', result: 'pass', passed: 3 }, { name: 'b:build', result: 'pass', passed: null }], 12.4, '');
  assert.equal(ok, 'dev-check: push PASS in 12s — a:test=3; b:build=ok');
  const bad = summaryLine('full', [{ name: 'a', result: 'fail' }, { name: 'b', result: 'skip' }], 1, '');
  assert.equal(bad, 'dev-check: full FAIL in 1s — a=FAIL; b=skip');
  assert.equal(summaryLine('fast', [], 0.2, 'nothing changed vs abc'), 'dev-check: fast PASS in 0s — nothing changed vs abc');
});

test('shellQuote leaves plain paths alone and quotes the rest', () => {
  assert.equal(shellQuote('src/a-b_c.test.ts'), 'src/a-b_c.test.ts');
  assert.equal(shellQuote('src/a b.ts'), "'src/a b.ts'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test('findChromium: an explicit HOLODECK_CHROMIUM must exist', () => {
  assert.equal(findChromium({ HOLODECK_CHROMIUM: '/no/such/chrome' }), null);
  assert.equal(findChromium({ HOLODECK_CHROMIUM: process.execPath }), process.execPath);
});

// --- one source of truth with the workflows ----------------------------------------

test('every gated package directory is a target; packages/cli (not built anywhere) is the only exception', () => {
  const dirs = readdirSync(join(REPO_ROOT, 'packages')).filter((d) => !d.startsWith('.'));
  const packages = Object.entries(TARGETS).filter(([, t]) => t.kind === 'package').map(([p]) => p);
  assert.deepEqual(dirs.filter((d) => !packages.includes(d)), ['cli']);
});

test('targets follow ci.yml: the small-packages list and the matrix legs', () => {
  const ci = workflow('ci.yml');
  const small = ci.match(/PACKAGES: (.+)/)[1].trim().split(/\s+/);
  const inSmall = Object.entries(TARGETS).filter(([, t]) => t.job === 'small-packages' && t.kind === 'package').map(([p]) => p);
  assert.deepEqual(inSmall.sort(), small.sort());
  const legs = [...ci.matchAll(/^\s+- package: (\S+)$/gm)].map((m) => m[1]);
  for (const leg of legs) assert.equal(TARGETS[leg].job, leg);
});

test('the scripts suites and the Blender checks are the commands the workflows run', () => {
  assert.ok(workflow('ci.yml').includes(`run: ${SCRIPTS_TEST}`));
  const drift = workflow('blender-drift.yml');
  for (const [pkg, command] of BLENDER_CHECKS) {
    assert.ok(drift.includes(`working-directory: holodeck/packages/${pkg}`), pkg);
    assert.ok(drift.includes(command), command);
  }
});

test('ci.yml runs every ci-studio.sh phase once, and nothing else in the studio job builds or tests', () => {
  const ci = workflow('ci.yml');
  const job = ci.slice(ci.indexOf('\n  studio:'));
  const used = [...job.matchAll(/scripts\/ci-studio\.sh --only (\S+)/g)].flatMap((m) => m[1].split(','));
  assert.deepEqual([...used].sort(), [...STUDIO.phases].sort());
  assert.ok(!job.includes('working-directory: holodeck/apps/studio'), 'inline studio commands: use scripts/ci-studio.sh');
  assert.ok(!job.includes('ci-package.sh'), 'the studio job reaches packages only through scripts/ci-studio.sh');
});

// --- git plumbing -------------------------------------------------------------------

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

test('changedFiles: committed, staged, unstaged and untracked changes vs the merge-base; ignored files are not', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev-check-test-')));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(root, 'a.txt'), 'a');
  writeFileSync(join(root, 'b.txt'), 'b');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('branch', 'base');
  writeFileSync(join(root, 'c.txt'), 'c');
  git('add', 'c.txt');
  git('commit', '-qm', 'committed');
  writeFileSync(join(root, 'a.txt'), 'a2'); // unstaged
  writeFileSync(join(root, 'café.txt'), 'x'); // untracked, non-ASCII
  writeFileSync(join(root, 'ignored.txt'), 'x');
  git('rm', '-q', 'b.txt'); // staged deletion
  const { changed, base } = changedFiles('base', root);
  assert.equal(base, git('rev-parse', 'base'));
  assert.deepEqual(changed, ['a.txt', 'b.txt', 'c.txt', 'café.txt']);
  assert.deepEqual(changedFiles('no-such-ref', root), { base: 'no-such-ref', changed: null });
});

test('CLI: --list prints a plan and runs nothing; bad arguments exit 2', () => {
  const list = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/dev-check.mjs'), 'full', '--list'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /^dev-check full/);
  assert.match(list.stdout, /editor-2\.5d-react:build +scripts\/ci-package\.sh editor-2\.5d-react --only install,typecheck,build/);
  const bad = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/dev-check.mjs'), '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
});
