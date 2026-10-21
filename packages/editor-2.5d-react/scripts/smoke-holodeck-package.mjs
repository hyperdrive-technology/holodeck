#!/usr/bin/env node
/**
 * Smoke test for the built Holodeck package entry (run after `pnpm build`;
 * part of `pnpm smoke`):
 *
 *   node scripts/smoke-holodeck-package.mjs
 *
 * 1. holodeck.package.json passes the SDK's validateHolodeckPackageManifest.
 * 2. The manifest `entry` (dist/holodeck-package.mjs) loads as an ES module
 *    from its path, the way a host that only has the package directory loads it.
 * 3. `@holodeck/editor-2.5d-react/holodeck-package` resolves by name as ESM
 *    and CJS, and both default exports install into a HolodeckHost that has
 *    the built `isoEngine` registered.
 * 4. `npm pack --dry-run` publishes the manifest and the entry.
 *
 * The repo-wide scripts/smoke-dist.mjs checks the main entry only; this file
 * covers the second entry without changing that shared script.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'holodeck.package.json'), 'utf8'));
const require = createRequire(join(PKG_DIR, 'package.json'));

const failures = [];
const fail = (msg) => failures.push(msg);

const sdk = await import('@holodeck/sdk');
const manifestErrors = sdk.validateHolodeckPackageManifest(manifest);
if (manifestErrors.length) fail(`holodeck.package.json is invalid:\n  ${manifestErrors.join('\n  ')}`);

// Self-reference by package name works from files inside the package.
const mainEsm = await import(pkg.name);

async function checkInstall(label, mod) {
  const entry = mod?.default ?? mod;
  if (typeof entry?.createExtension !== 'function') {
    fail(`${label}: default export has no createExtension()`);
    return;
  }
  try {
    const host = new sdk.HolodeckHost({ name: 'smoke' });
    host.registerEngine(mainEsm.isoEngine);
    const report = await host.installPackage(manifest, entry);
    const parts = host.registry.list('holodeck.iso.part').length;
    if (report.unresolvedEngines.length) fail(`${label}: unresolved engines ${report.unresolvedEngines}`);
    if (parts === 0) fail(`${label}: no holodeck.iso.part items installed`);
    console.log(`${label}: installed ${manifest.id}@${manifest.version}, ${parts} parts`);
  } catch (err) {
    fail(`${label}: install threw: ${err.stack ?? err}`);
  }
}

try {
  await checkInstall(`entry ${manifest.entry}`, await import(pathToFileURL(join(PKG_DIR, manifest.entry)).href));
} catch (err) {
  fail(`importing ${manifest.entry} threw: ${err.stack ?? err}`);
}
try {
  await checkInstall('esm ./holodeck-package', await import(`${pkg.name}/holodeck-package`));
} catch (err) {
  fail(`import ${pkg.name}/holodeck-package threw: ${err.stack ?? err}`);
}
/**
 * holodeck#60: an entry that inlines its own copy of the built-ins hands a
 * host part objects that are not the ones the main entry exports (class
 * identity, registry collisions when both are mixed). Both entries of one
 * format must share them: ESM through a shared chunk, CJS likewise
 * (tsup.config.ts `splitting: true`).
 */
function checkSharedParts(label, main, entry) {
  const ours = new Set(main.BUILTIN_ISO_PARTS ?? []);
  const theirs = entry?.default?.createExtension?.().contributions?.['holodeck.iso.part'] ?? [];
  if (ours.size === 0 || theirs.length === 0) {
    fail(`${label}: no built-in parts to compare (main ${ours.size}, entry ${theirs.length})`);
    return;
  }
  const copies = theirs.filter((part) => !ours.has(part)).map((part) => part.id);
  if (copies.length) fail(`${label}: ./holodeck-package carries its own copy of ${copies.length} built-in part(s), e.g. ${copies.slice(0, 3)} (holodeck#60)`);
  else console.log(`${label}: ./holodeck-package shares all ${theirs.length} part objects with the main entry`);
}

try {
  checkSharedParts('esm', mainEsm, await import(`${pkg.name}/holodeck-package`));
} catch (err) {
  fail(`esm shared-parts check threw: ${err.stack ?? err}`);
}

try {
  const cjsSdk = require('@holodeck/sdk');
  const cjsMain = require(pkg.name);
  const cjsEntry = require(`${pkg.name}/holodeck-package`);
  checkSharedParts('cjs', cjsMain, cjsEntry);
  const host = new cjsSdk.HolodeckHost({ name: 'smoke-cjs' });
  host.registerEngine(cjsMain.isoEngine);
  const report = await host.installPackage(manifest, cjsEntry.default);
  console.log(`cjs ./holodeck-package: installed ${report.packageId}, ${host.registry.list('holodeck.iso.part').length} parts`);
} catch (err) {
  fail(`require ${pkg.name}/holodeck-package failed: ${err.stack ?? err}`);
}

// ./contracts (holodeck#137): loads by name in both formats without React or
// three, and hands out the main entry's own objects.
for (const [label, load] of [
  ['esm', async () => [await import(`${pkg.name}/contracts`), mainEsm]],
  ['cjs', async () => [require(`${pkg.name}/contracts`), require(pkg.name)]],
]) {
  try {
    const [contracts, main] = await load();
    const names = ['ISO_KINDS', 'isIsoPartDefinition', 'isIsoTheme', 'HOLODECK_STYLE'];
    const missing = names.filter((n) => contracts[n] === undefined);
    const copies = names.filter((n) => contracts[n] !== undefined && contracts[n] !== main[n]);
    if (missing.length) fail(`${label} ./contracts: missing ${missing}`);
    if (copies.length) fail(`${label} ./contracts: ${copies} are copies, not the main entry's objects`);
    if (!missing.length && !copies.length) console.log(`${label} ./contracts: ${Object.keys(contracts).length} exports, shared with the main entry`);
  } catch (err) {
    fail(`${label} ./contracts failed to load: ${err.stack ?? err}`);
  }
}
// Every package the built ESM contracts entry reaches, through its chunks.
{
  const seen = new Set();
  const packages = new Set();
  const queue = ['contracts.mjs'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(join(PKG_DIR, 'dist', file), 'utf8');
    // esbuild emits static imports at line start; dynamic import() would show up as `import(`.
    const specs = [
      ...code.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm),
      ...code.matchAll(/^import\s*["']([^"']+)["']/gm),
      ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ];
    for (const [, spec] of specs) {
      if (spec.startsWith('./')) queue.push(spec.slice(2));
      else packages.add(spec);
    }
  }
  const heavy = [...packages].filter((p) => p !== '@holodeck/sdk');
  if (heavy.length) fail(`dist/contracts.mjs reaches ${heavy} through ${[...seen]} (must stay @holodeck/sdk-only)`);
  else console.log(`dist/contracts.mjs reaches only ${[...packages]} through ${seen.size} file(s)`);
}

const pack = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], { cwd: PKG_DIR, encoding: 'utf8' }),
);
const packed = new Set(pack[0].files.map((f) => f.path));
for (const file of ['holodeck.package.json', manifest.entry, 'dist/holodeck-package.js', 'dist/holodeck-package.d.ts', 'dist/contracts.mjs', 'dist/contracts.js', 'dist/contracts.d.ts']) {
  if (!packed.has(file)) fail(`npm pack would not publish ${file}`);
}
// The manifest's `assets` dir must be published too: a host resolving
// assetUrl() against it would otherwise 404 (holodeck#27 moved it to the
// built dist/models when assets/ left the tarball).
if (manifest.assets !== undefined && ![...packed].some((f) => f.startsWith(`${manifest.assets}/`))) {
  fail(`npm pack publishes nothing under the manifest's assets dir "${manifest.assets}"`);
}

if (failures.length) {
  console.error(`\nsmoke-holodeck-package FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`smoke-holodeck-package OK: ${manifest.id}@${manifest.version} (${manifest.entry})`);
