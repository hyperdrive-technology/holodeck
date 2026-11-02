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

import { decide, parseArgs, SHARED_PATHS } from './ci-scope.mjs';

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
    event: 'pull_request', base: 'abc', sdkRef: 'main', paths: ['a', 'b'], cwd: '.',
  });
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
