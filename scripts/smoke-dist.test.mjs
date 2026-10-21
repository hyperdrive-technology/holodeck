/**
 * Tests for smoke-dist.mjs against throwaway fixture packages (no build, no
 * network: `npm pack --dry-run` only reads the fixture directory).
 *
 *   node --test "scripts/**\/*.test.mjs"
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'smoke-dist.mjs');
const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A dual-format package exporting `a` (plus `extra` files), named `name`. */
function fixture({ name = '@fixture/pkg', files = ['dist'], extra = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'smoke-dist-test-')));
  roots.push(root);
  const write = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  write(
    'package.json',
    JSON.stringify({
      name,
      version: '0.0.0',
      main: './dist/index.js',
      module: './dist/index.mjs',
      exports: { '.': { import: './dist/index.mjs', require: './dist/index.js' } },
      files,
    }),
  );
  write('dist/index.mjs', 'export const a = 1;\n');
  write('dist/index.js', 'exports.a = 1;\n');
  for (const [rel, body] of Object.entries(extra)) write(rel, body);
  return root;
}

function smoke(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('a plain dual-format package passes', () => {
  const r = smoke(fixture());
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /smoke-dist OK: @fixture\/pkg/);
});

test('editor-2.5d-react without BUILTIN_MODEL_URLS fails instead of skipping the model checks (holodeck#26)', () => {
  const r = smoke(fixture({ name: '@holodeck/editor-2.5d-react' }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /esm: required export\(s\) missing: BUILTIN_MODEL_URLS/);
  assert.match(r.out, /cjs: required export\(s\) missing: BUILTIN_MODEL_URLS/);
});

test('--require-export adds a requirement for any package', () => {
  const dir = fixture();
  assert.equal(smoke(dir, '--require-export', 'a').status, 0);
  const r = smoke(dir, '--require-export', 'b');
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /required export\(s\) missing: b/);
});

test('bad arguments print usage and exit 2', () => {
  assert.equal(smoke().status, 2);
  assert.equal(smoke(fixture(), '--require-export').status, 2);
  assert.equal(smoke(fixture(), '--bogus').status, 2);
});

test('a GLB published under two paths fails the pack check (holodeck#27)', () => {
  const glb = 'glTF fake model bytes';
  const r = smoke(fixture({ files: ['dist', 'assets'], extra: { 'dist/models/x.glb': glb, 'assets/models/x.glb': glb } }));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /npm pack would publish one GLB 2 times: assets\/models\/x\.glb, dist\/models\/x\.glb/);
});

test('the same GLB published once passes; different files of one name are not duplicates', () => {
  assert.equal(smoke(fixture({ extra: { 'dist/models/x.glb': 'glTF one' } })).status, 0);
  const r = smoke(fixture({ files: ['dist', 'assets'], extra: { 'dist/models/x.glb': 'glTF one', 'assets/other/x.glb': 'glTF longer two' } }));
  assert.equal(r.status, 0, r.out);
});
