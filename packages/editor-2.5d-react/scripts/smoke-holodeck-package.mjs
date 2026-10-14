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
try {
  // The CJS build bundles its own copy of the parts, so it installs into a host
  // with the CJS SDK; mixing it with the ESM engine is not a supported setup.
  const cjsSdk = require('@holodeck/sdk');
  const cjsMain = require(pkg.name);
  const cjsEntry = require(`${pkg.name}/holodeck-package`);
  const host = new cjsSdk.HolodeckHost({ name: 'smoke-cjs' });
  host.registerEngine(cjsMain.isoEngine);
  const report = await host.installPackage(manifest, cjsEntry.default);
  console.log(`cjs ./holodeck-package: installed ${report.packageId}, ${host.registry.list('holodeck.iso.part').length} parts`);
} catch (err) {
  fail(`require ${pkg.name}/holodeck-package failed: ${err.stack ?? err}`);
}

const pack = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], { cwd: PKG_DIR, encoding: 'utf8' }),
);
const packed = new Set(pack[0].files.map((f) => f.path));
for (const file of ['holodeck.package.json', manifest.entry, 'dist/holodeck-package.js', 'dist/holodeck-package.d.ts']) {
  if (!packed.has(file)) fail(`npm pack would not publish ${file}`);
}

if (failures.length) {
  console.error(`\nsmoke-holodeck-package FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`smoke-holodeck-package OK: ${manifest.id}@${manifest.version} (${manifest.entry})`);
