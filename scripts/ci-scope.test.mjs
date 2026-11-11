/**
 * Tests for ci-scope.mjs: the pure decision and the CLI against a throwaway git
 * repo (no network: `origin` is a local path).
 *
 *   node --test "scripts/**\/*.test.mjs"
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decide, INERT_PATHS, JOBS, OWNED_PATHS, parseArgs, SHARED_PATHS } from './ci-scope.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'ci-scope.mjs');
const FLOW = ['^packages/flow-runtime/'];

test('non-PR events always run', () => {
  for (const event of ['push', 'schedule', 'workflow_dispatch', '']) {
    assert.equal(decide({ event, changed: [], paths: FLOW }).run, true, event);
  }
});

test('a PR touching the package runs', () => {
  const d = decide({ event: 'pull_request', changed: ['README.md', 'packages/flow-runtime/src/a.ts'], paths: FLOW });
  assert.deepEqual(d, { run: true, reason: 'packages/flow-runtime/src/a.ts changed' });
});

test('a PR touching only other packages or docs skips', () => {
  const d = decide({ event: 'pull_request', changed: ['README.md', 'packages/provider-aws/src/a.ts', 'TODO.md'], paths: FLOW });
  assert.equal(d.run, false);
  assert.match(d.reason, /3 changed file/);
});

test('a prefix of another package name does not match (anchored, trailing slash)', () => {
  assert.equal(decide({ event: 'pull_request', changed: ['packages/flow-runtime-extra/a.ts'], paths: FLOW }).run, false);
});

test('shared inputs run every job', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/holodeck-sdk-ref', '.node-version', 'scripts/smoke-dist.mjs']) {
    assert.equal(decide({ event: 'pull_request', changed: [file], paths: FLOW }).run, true, file);
  }
  assert.equal(SHARED_PATHS.length, 4);
});

test('--no-shared ignores shared inputs but still matches --paths', () => {
  const blender = ['^blender/'];
  assert.equal(decide({ event: 'pull_request', changed: ['.github/workflows/ci.yml', 'scripts/x.mjs'], paths: blender, shared: false }).run, false);
  assert.equal(decide({ event: 'pull_request', changed: ['blender/parts/valve.py'], paths: blender, shared: false }).run, true);
});

test('unowned root files fail closed: they run every job', () => {
  for (const file of ['package.json', 'tsconfig.json', 'examples/brewery/scene.json', 'pnpm-workspace.yaml', 'newdir/x.ts', '.github/actions/x/action.yml']) {
    const d = decide({ event: 'pull_request', changed: ['packages/provider-aws/src/a.ts', file], paths: FLOW });
    assert.equal(d.run, true, file);
    assert.match(d.reason, /fail closed/, file);
  }
});

test('docs, root Markdown, LICENSE and repo metadata are inert', () => {
  const changed = ['docs/a/b.md', 'docs/img.png', 'README.md', 'TODO.md', 'LICENSE', '.github/CODEOWNERS', '.github/dependabot.yml', '.github/actionlint.yaml'];
  assert.equal(decide({ event: 'pull_request', changed, paths: FLOW }).run, false);
  // Markdown inside a package is that package's file, not inert-everywhere.
  assert.equal(decide({ event: 'pull_request', changed: ['packages/flow-runtime/README.md'], paths: FLOW }).run, true);
  assert.equal(OWNED_PATHS.length + INERT_PATHS.length, 7);
});

test('--no-shared also ignores unowned root files (Blender does not read them)', () => {
  assert.equal(decide({ event: 'pull_request', changed: ['package.json'], paths: ['^blender/'], shared: false }).run, false);
});

test('a paired SDK branch runs everything', () => {
  assert.equal(decide({ event: 'pull_request', sdkRef: 'feat/x', changed: ['README.md'], paths: FLOW }).run, true);
  assert.equal(decide({ event: 'pull_request', sdkRef: 'main', changed: ['README.md'], paths: FLOW }).run, false);
});

test('an unreadable diff fails closed', () => {
  assert.equal(decide({ event: 'pull_request', changed: null, paths: FLOW }).run, true);
});

test('no paths means run', () => {
  assert.equal(decide({ event: 'pull_request', changed: ['README.md'], paths: [] }).run, true);
});

test('parseArgs collects repeated --paths and rejects unknown or valueless flags', () => {
  assert.deepEqual(parseArgs(['--event', 'pull_request', '--base', 'abc', '--paths', 'a', '--paths', 'b']), {
    event: 'pull_request', base: 'abc', sdkRef: 'main', paths: ['a', 'b'], cwd: '.', shared: true,
  });
  assert.equal(parseArgs(['--paths', 'a', '--no-shared', '--event', 'push']).shared, false);
  assert.deepEqual(parseArgs(['--no-shared', '--paths', 'a']).paths, ['a']);
  assert.throws(() => parseArgs(['--nope', 'x']), /unknown flag/);
  assert.throws(() => parseArgs(['--event']), /needs a value/);
});

test('parseArgs --job takes paths and --no-shared from JOBS', () => {
  assert.deepEqual(parseArgs(['--job', 'viewer-3d-react']).paths, JOBS['viewer-3d-react'].paths);
  assert.equal(parseArgs(['--job', 'viewer-3d-react']).shared, true);
  assert.equal(parseArgs(['--event', 'pull_request', '--job', 'blender-drift']).shared, false);
  assert.throws(() => parseArgs(['--job', 'nope']), /unknown job nope/);
  assert.throws(() => parseArgs(['--job', 'studio', '--paths', 'x']), /exclusive/);
});

// --- CLI against a real git repo -------------------------------------------

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ci-scope-test-')));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  const write = (rel) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), `${rel}\n${Math.random()}\n`);
  };
  write('README.md');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', root); // fetch of `base` resolves locally
  return { root, git, write, base };
}

function cli(root, args) {
  const out = join(root, '.gh-output');
  writeFileSync(out, '');
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
  return { ...r, output: readFileSync(out, 'utf8') };
}

test('CLI: PR diff decides and writes run= to GITHUB_OUTPUT', () => {
  const { root, git, write, base } = repo();
  write('packages/provider-aws/src/a.ts');
  git('add', '-A');
  git('commit', '-qm', 'change');
  const skip = cli(root, ['--event', 'pull_request', '--base', base, '--paths', FLOW[0]]);
  assert.equal(skip.status, 0, skip.stderr);
  assert.equal(skip.output, 'run=false\n');
  assert.match(skip.stdout, /run=false/);
  const run = cli(root, ['--event', 'pull_request', '--base', base, '--paths', '^packages/provider-aws/']);
  assert.equal(run.output, 'run=true\n');
});

test('CLI: an unknown base fails closed', () => {
  const { root } = repo();
  const r = cli(root, ['--event', 'pull_request', '--base', 'deadbeef'.repeat(5), '--paths', FLOW[0]]);
  assert.equal(r.status, 0);
  assert.equal(r.output, 'run=true\n');
});

test('CLI: non-ASCII and special-character file names still match (git diff -z)', () => {
  const { root, git, write, base } = repo();
  write('packages/flow-runtime/src/café "q".ts');
  git('add', '-A');
  git('commit', '-qm', 'change');
  const run = cli(root, ['--event', 'pull_request', '--base', base, '--paths', FLOW[0]]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.output, 'run=true\n');
  assert.match(run.stdout, /café "q"\.ts changed/);
  const other = cli(root, ['--event', 'pull_request', '--base', base, '--paths', '^packages/provider-aws/']);
  assert.equal(other.output, 'run=false\n');
});

test('CLI: the small-packages all-or-none pattern selects on a coupled package', () => {
  const { root, git, write, base } = repo();
  write('packages/editor-2.5d-react/src/contract.ts');
  git('add', '-A');
  git('commit', '-qm', 'change');
  const packages = 'flow-runtime provider-http library-cloud provider-aws assets-aws';
  const pattern = `^packages/(${packages.split(' ').join('|')}|editor-2\\.5d-react)/`;
  assert.equal(cli(root, ['--event', 'pull_request', '--base', base, '--paths', pattern]).output, 'run=true\n');
});

// --- The real job scopes (JOBS) and the workflows that use them -------------

const WORKFLOWS = join(dirname(SCRIPT), '../.github/workflows');
const workflow = (name) => readFileSync(join(WORKFLOWS, name), 'utf8');
const runs = (job, file) => decide({ event: 'pull_request', changed: [file], paths: JOBS[job].paths, shared: JOBS[job].shared !== false }).run;

test('every scope step in the workflows names a JOBS entry, and every entry is used once', () => {
  const ci = workflow('ci.yml');
  const drift = workflow('blender-drift.yml');
  for (const [name, yml] of [['ci.yml', ci], ['blender-drift.yml', drift]]) assert.ok(!yml.includes('--paths'), `${name} passes inline --paths`);
  // The matrix passes its package name as the job; the other jobs name theirs.
  assert.ok(ci.includes("--job '${{ matrix.package }}'"));
  const legs = [...ci.matchAll(/^\s+- package: (\S+)$/gm)].map((m) => m[1]);
  const named = [...`${ci}\n${drift}`.matchAll(/--job ([\w.-]+)$/gm)].map((m) => m[1]);
  assert.deepEqual([...legs, ...named].sort(), Object.keys(JOBS).sort());
});

test('package legs cover every directory each reads', () => {
  for (const pkg of ['editor-2.5d-react', 'editor-2d-react', 'viewer-3d-react']) assert.equal(runs(pkg, `packages/${pkg}/src/a.ts`), true, pkg);
  // editor-2.5d-react cross-reads: models-contract (blender/parts) and logo/objects (library-cloud GLBs).
  assert.equal(runs('editor-2.5d-react', 'blender/parts/valve.py'), true);
  assert.equal(runs('editor-2.5d-react', 'packages/library-cloud/assets/models/billboard.glb'), true);
  // No accidental widening.
  assert.equal(runs('editor-2.5d-react', 'packages/provider-aws/src/a.ts'), false);
  assert.equal(runs('editor-2d-react', 'packages/editor-2.5d-react/src/a.ts'), false);
  assert.equal(runs('viewer-3d-react', 'blender/parts/valve.py'), false);
});

test('small-packages runs all five on a change to any of them or to editor-2.5d-react', () => {
  const ci = workflow('ci.yml');
  const packages = ci.match(/PACKAGES: (.+)/)[1].trim().split(/\s+/);
  assert.deepEqual(packages.sort(), ['assets-aws', 'flow-runtime', 'library-cloud', 'provider-aws', 'provider-http']);
  for (const p of [...packages, 'editor-2.5d-react']) assert.equal(runs('small-packages', `packages/${p}/src/a.ts`), true, p);
  assert.equal(runs('small-packages', 'packages/viewer-3d-react/src/a.ts'), false);
  assert.equal(runs('small-packages', 'apps/studio/src/a.ts'), false);
});

test('studio job (studio + MCP server) runs for the studio, the MCP server and what they consume', () => {
  const ci = workflow('ci.yml');
  const job = ci.slice(ci.indexOf('\n  studio:'));
  assert.ok(job.includes('scripts/ci-studio.sh --only mcp'), 'the studio job runs the MCP package gate');
  for (const file of [
    'apps/studio/src/host/document-checks.ts',
    'packages/mcp/src/server.ts',
    'packages/editor-2.5d-react/src/index.ts',
    'packages/provider-http/src/a.ts',
    'packages/provider-aws/src/a.ts',
    'packages/library-cloud/src/a.ts',
  ]) assert.equal(runs('studio', file), true, file);
  assert.equal(runs('studio', 'packages/flow-runtime/src/a.ts'), false);
  assert.equal(runs('studio', 'packages/mcp-extra/src/a.ts'), false);
});

test('blender-drift runs for Blender inputs only, not shared CI plumbing', () => {
  for (const file of [
    'blender/parts/valve.py',
    'packages/library-cloud/assets/models/billboard.glb',
    'packages/editor-2.5d-react/assets/models/valve.glb',
    'packages/editor-2.5d-react/scripts/build-parts.mjs',
    'packages/editor-2.5d-react/src/models/valve-glb.test.ts',
    '.github/workflows/blender-drift.yml',
    'scripts/ci-scope.mjs',
  ]) assert.equal(runs('blender-drift', file), true, file);
  for (const file of ['.github/workflows/ci.yml', 'scripts/smoke-dist.mjs', 'package.json', 'packages/editor-2.5d-react/src/index.ts']) {
    assert.equal(runs('blender-drift', file), false, file);
  }
});
