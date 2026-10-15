#!/usr/bin/env node
/**
 * Smoke test for a *built* package (run after `pnpm build`):
 *
 *   node scripts/smoke-dist.mjs packages/editor-2.5d-react
 *
 * 1. Imports dist/ through the package's own `exports` map by name, once as
 *    ESM (`import`) and once as CJS (`require`), each in a fresh Node process
 *    whose cwd is the package (Node self-references a package by name from
 *    inside it, so a wrong condition order or path fails here, not in a
 *    consumer). The holodeck#7 crash happened at exactly this point.
 *    ESM-only packages (root export without a `require` condition) cannot be
 *    required by name; for them the CJS leg is Node's `require(esm)` of the
 *    `import` target by path, which proves the build has no top-level await.
 * 2. Both formats must expose the same, non-empty set of exports.
 * 3. If the package exports `BUILTIN_MODEL_URLS` (editor-2.5d-react), every
 *    entry must be a `file:` URL to an existing GLB under dist/ that is
 *    byte-identical to `assets/models/<name>.glb`, and the map must cover
 *    every GLB in assets/models.
 * 4. `npm pack --dry-run` must include every entry point (and the GLBs).
 *
 * Bundler-only side-effect imports (editor-2d-react pulls in
 * `@xyflow/react/dist/style.css`) are stubbed by smoke-dist-hooks.mjs; Node
 * cannot load CSS and every real consumer is a bundler that can.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkgArg = process.argv[2];
if (!pkgArg) {
  console.error('usage: node scripts/smoke-dist.mjs <package-dir>');
  process.exit(2);
}
const PKG_DIR = resolve(pkgArg);
const DIST = join(PKG_DIR, 'dist');
const HOOKS = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'smoke-dist-hooks.mjs')).href;
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));

const failures = [];
const fail = (msg) => failures.push(msg);
const MARK = '__SMOKE__';

const rootExport = pkg.exports?.['.'] ?? {};
/** No `require` condition: the package ships ESM only (holodeck#60). */
const ESM_ONLY = typeof rootExport === 'object' && rootExport.require === undefined && typeof rootExport.import === 'string';

/** Loads the package in a child Node and returns {keys, models}. */
function load(format) {
  const report = `console.log(${JSON.stringify(MARK)} + JSON.stringify({ keys: Object.keys(m).sort(), models: m.BUILTIN_MODEL_URLS ?? null }))`;
  // require(esm) by path: an import-only exports map refuses require by name.
  const requireTarget = ESM_ONLY ? join(PKG_DIR, rootExport.import) : pkg.name;
  const code =
    format === 'esm'
      ? `const m = await import(${JSON.stringify(pkg.name)}); ${report}`
      : `const m = require(${JSON.stringify(requireTarget)}); ${report}`;
  const out = execFileSync(
    process.execPath,
    ['--no-deprecation', '--import', HOOKS, `--input-type=${format === 'esm' ? 'module' : 'commonjs'}`, '-e', code],
    { cwd: PKG_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const line = out.split('\n').find((l) => l.startsWith(MARK));
  if (!line) throw new Error(`no report line in output:\n${out}`);
  return JSON.parse(line.slice(MARK.length));
}

function checkModels(label, urls) {
  const srcModels = join(PKG_DIR, 'assets/models');
  const expected = readdirSync(srcModels)
    .filter((f) => f.endsWith('.glb'))
    .map((f) => f.replace(/\.glb$/, ''))
    .sort();
  const names = Object.keys(urls).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail(`${label}: BUILTIN_MODEL_URLS keys ${JSON.stringify(names)} != assets/models ${JSON.stringify(expected)}`);
  }
  for (const name of names) {
    const url = urls[name];
    if (!url.startsWith('file:')) {
      fail(`${label}: ${name} -> ${url} is not a file: URL`);
      continue;
    }
    const file = fileURLToPath(url);
    if (!file.startsWith(DIST + sep)) fail(`${label}: ${name} -> ${file} is outside dist/`);
    if (!existsSync(file)) {
      fail(`${label}: ${name} -> ${file} does not exist`);
      continue;
    }
    if (!readFileSync(file).equals(readFileSync(join(srcModels, `${name}.glb`)))) {
      fail(`${label}: ${name} -> ${file} differs from assets/models/${name}.glb (stale build?)`);
    }
  }
  console.log(`${label}: ${names.length} model URLs resolve to real files`);
  return names.map((n) => fileURLToPath(urls[n]));
}

const loaded = {};
for (const format of ['esm', 'cjs']) {
  try {
    loaded[format] = load(format);
    const how = format === 'cjs' && ESM_ONLY ? ' (require(esm) of the import target)' : '';
    console.log(`${format}: ${pkg.name} loaded${how}, ${loaded[format].keys.length} exports`);
    if (loaded[format].keys.length === 0) fail(`${format}: no exports`);
  } catch (err) {
    fail(`${format}: loading ${pkg.name} threw:\n${err.stderr || err.message}`);
  }
}
if (loaded.esm && loaded.cjs && JSON.stringify(loaded.esm.keys) !== JSON.stringify(loaded.cjs.keys)) {
  const only = (a, b) => a.keys.filter((k) => !b.keys.includes(k));
  fail(`ESM/CJS export sets differ: esm-only ${only(loaded.esm, loaded.cjs)}; cjs-only ${only(loaded.cjs, loaded.esm)}`);
}

const mustPublish = new Set();
for (const format of ['esm', 'cjs']) {
  if (loaded[format]?.models) {
    for (const file of checkModels(format, loaded[format].models)) mustPublish.add(file.slice(PKG_DIR.length + 1));
  }
}
for (const p of [pkg.main, pkg.module, pkg.types, rootExport.types, rootExport.import, rootExport.require]) {
  if (typeof p === 'string') mustPublish.add(p.replace(/^\.\//, ''));
}
const pack = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], {
    cwd: PKG_DIR,
    encoding: 'utf8',
  }),
);
const packed = new Set(pack[0].files.map((f) => f.path));
for (const file of mustPublish) if (!packed.has(file)) fail(`npm pack would not publish ${file}`);
console.log(`npm pack: ${packed.size} files, ${mustPublish.size} required present-checked`);

if (failures.length) {
  console.error(`\nsmoke-dist FAILED for ${pkg.name} (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`smoke-dist OK: ${pkg.name}`);
