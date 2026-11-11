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

import { decide, INERT_PATHS, OWNED_PATHS, parseArgs, SHARED_PATHS } from './ci-scope.mjs';

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

// --- The workflow's real scope patterns --------------------------------------

/** `package:` → `scope:` from the ci.yml matrix include list (plain regex parse; no YAML dep). */
function matrixScopes() {
  const yml = readFileSync(join(dirname(SCRIPT), '../.github/workflows/ci.yml'), 'utf8');
  const scopes = {};
  for (const m of yml.matchAll(/- package: (\S+)\n\s+scope: '([^']+)'/g)) scopes[m[1]] = m[2];
  return scopes;
}

test('ci.yml matrix scopes cover every directory each leg reads', () => {
  const scopes = matrixScopes();
  assert.deepEqual(Object.keys(scopes).sort(), ['editor-2.5d-react', 'editor-2d-react', 'viewer-3d-react']);
  const runs = (pkg, file) => decide({ event: 'pull_request', changed: [file], paths: [scopes[pkg]] }).run;
  // Own package.
  for (const pkg of Object.keys(scopes)) assert.equal(runs(pkg, `packages/${pkg}/src/a.ts`), true, pkg);
  // editor-2.5d-react cross-reads: models-contract (blender/parts) and logo/objects (library-cloud GLBs).
  assert.equal(runs('editor-2.5d-react', 'blender/parts/valve.py'), true);
  assert.equal(runs('editor-2.5d-react', 'packages/library-cloud/assets/models/billboard.glb'), true);
  // No accidental widening.
  assert.equal(runs('editor-2.5d-react', 'packages/provider-aws/src/a.ts'), false);
  assert.equal(runs('editor-2d-react', 'packages/editor-2.5d-react/src/a.ts'), false);
  assert.equal(runs('viewer-3d-react', 'blender/parts/valve.py'), false);
});

test('ci.yml studio job (studio + MCP server) runs for the studio, the MCP server and what they consume', () => {
  const yml = readFileSync(join(dirname(SCRIPT), '../.github/workflows/ci.yml'), 'utf8');
  const job = yml.slice(yml.indexOf('\n  studio:'));
  const paths = [...job.slice(0, job.indexOf('Checkout holodeck-sdk')).matchAll(/--paths '([^']+)'/g)].map((m) => m[1]);
  assert.ok(job.includes('scripts/ci-package.sh mcp'), 'the studio job runs the MCP package gate');
  const runs = (file) => decide({ event: 'pull_request', changed: [file], paths }).run;
  for (const file of [
    'apps/studio/src/host/document-checks.ts',
    'packages/mcp/src/server.ts',
    'packages/editor-2.5d-react/src/index.ts',
    'packages/provider-http/src/a.ts',
    'packages/provider-aws/src/a.ts',
    'packages/library-cloud/src/a.ts',
    'packages/library-process/src/parts.json',
  ]) assert.equal(runs(file), true, file);
  assert.equal(runs('packages/flow-runtime/src/a.ts'), false);
  assert.equal(runs('packages/mcp-extra/src/a.ts'), false);
});

/** The `--paths` of one job's scope step (`name:` of the step), from the raw workflow text. */
function scopePaths(file, job, step) {
  const yml = readFileSync(join(dirname(SCRIPT), `../.github/workflows/${file}`), 'utf8');
  const body = yml.slice(yml.indexOf(`\n  ${job}:`));
  const from = body.indexOf(step);
  const scope = body.slice(from, body.indexOf('\n      - ', from + 1));
  return { scope, paths: [...scope.matchAll(/--paths ['"]([^'"]+)['"]/g)].map((m) => m[1]) };
}

test('ci.yml small-packages job runs library-process for everything its tests read', () => {
  const { scope, paths } = scopePaths('ci.yml', 'small-packages', 'Does this change touch the small packages?');
  const yml = readFileSync(join(dirname(SCRIPT), '../.github/workflows/ci.yml'), 'utf8');
  const packages = /PACKAGES: ([^\n]+)/.exec(yml)[1].trim();
  assert.ok(packages.split(' ').includes('library-process'), packages);
  assert.ok(scope.includes('${PACKAGES// /|}'), 'the package pattern is built from PACKAGES');
  // Expand the shell pattern the way the step does.
  const expanded = paths.map((p) => p.replace('${PACKAGES// /|}', packages.split(' ').join('|')).replace(/\\\\/g, '\\'));
  const runs = (file) => decide({ event: 'pull_request', changed: [file], paths: expanded }).run;
  for (const file of [
    'packages/library-process/src/parts.json',
    'packages/library-process/assets/models/motor.glb',
    'blender/parts/process/motor.py',
    'blender/parts/process/_common.py',
    'docs/assets/process-catalog.md',
    'packages/editor-2.5d-react/src/anim/animators.ts',
    'packages/library-cloud/src/parts.json',
  ]) assert.equal(runs(file), true, file);
  assert.equal(runs('blender/parts/cloud/server.py'), false);
  assert.equal(runs('docs/ROADMAP.md'), false);
  assert.equal(runs('apps/studio/src/a.ts'), false);
});

test('blender-drift.yml rebuilds library-process when its scripts, GLBs or package change', () => {
  const { paths } = scopePaths('blender-drift.yml', 'rebuild', 'Does this change touch Blender inputs?');
  const runs = (file) => decide({ event: 'pull_request', changed: [file], paths, shared: false }).run;
  for (const file of ['blender/parts/process/motor.py', 'blender/parts/process/_common.py', 'packages/library-process/assets/models/motor.glb', 'packages/library-process/src/models.json']) {
    assert.equal(runs(file), true, file);
  }
  const yml = readFileSync(join(dirname(SCRIPT), '../.github/workflows/blender-drift.yml'), 'utf8');
  assert.match(yml, /working-directory: holodeck\/packages\/library-process\n\s+run: \|\n\s+pnpm install --frozen-lockfile\n\s+pnpm exec vitest run src\/process-glb\.test\.ts/);
});
