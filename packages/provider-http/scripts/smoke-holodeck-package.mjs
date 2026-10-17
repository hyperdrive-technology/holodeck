#!/usr/bin/env node
/**
 * Smoke test for the built Holodeck package entry (run after `pnpm build`;
 * part of `pnpm smoke`):
 *
 *   node scripts/smoke-holodeck-package.mjs
 *
 * 1. holodeck.package.json passes the SDK's validateHolodeckPackageManifest.
 * 2. The manifest `entry` (dist/holodeck-package.js) loads as an ES module
 *    from its path, the way a host that only has the package directory loads it.
 * 3. `@holodeck/provider-http/holodeck-package` resolves by name; each default
 *    export installs into a HolodeckHost, registers `holodeck.http`, and reads a
 *    value through a ProviderHub session from a local 127.0.0.1 server (no
 *    external network).
 * 4. The package is ESM only. Node's `require(esm)` of the entry works (no
 *    top-level await) and returns the same module instance as `import`.
 * 5. `npm pack --dry-run` publishes the manifest and the entry, and no tests.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'holodeck.package.json'), 'utf8'));
const require = createRequire(join(PKG_DIR, 'package.json'));

const failures = [];
const fail = (msg) => failures.push(msg);

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pumps: [{ rpm: 1500 }] }));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/status`;

async function checkInstall(label, sdk, mod) {
  const entry = mod?.default ?? mod;
  if (typeof entry?.createExtension !== 'function') {
    fail(`${label}: default export has no createExtension()`);
    return;
  }
  try {
    const host = new sdk.HolodeckHost({ name: 'smoke' });
    await host.installPackage(manifest, entry);
    if (!host.registry.get('holodeck.provider', 'holodeck.http')) fail(`${label}: provider not registered`);
    const hub = host.createProviderHub();
    hub.setConnections([{ id: 'api', provider: 'holodeck.http', config: { url, intervalMs: 1000 } }]);
    await hub.settled();
    const [sample] = await hub.session('api').read(['$.pumps[0].rpm']);
    if (sample?.value !== 1500) fail(`${label}: read returned ${JSON.stringify(sample)}`);
    await hub.dispose();
    console.log(`${label}: installed ${manifest.id}@${manifest.version}, read ${sample?.value}`);
  } catch (err) {
    fail(`${label}: install/read threw: ${err.stack ?? err}`);
  }
}

const sdk = await import('@holodeck/sdk');
const manifestErrors = sdk.validateHolodeckPackageManifest(manifest);
if (manifestErrors.length) fail(`holodeck.package.json is invalid:\n  ${manifestErrors.join('\n  ')}`);

const mainEsm = await import(pkg.name);
const entryPath = join(PKG_DIR, manifest.entry);
try {
  await checkInstall(`entry ${manifest.entry}`, sdk, await import(pathToFileURL(entryPath).href));
} catch (err) {
  fail(`importing ${manifest.entry} threw: ${err.stack ?? err}`);
}
try {
  await checkInstall('esm ./holodeck-package', sdk, await import(`${pkg.name}/holodeck-package`));
} catch (err) {
  fail(`import ${pkg.name}/holodeck-package threw: ${err.stack ?? err}`);
}
try {
  const required = require(entryPath);
  const imported = await import(pathToFileURL(entryPath).href);
  if (required.default !== imported.default) fail('require(esm) returned a different module instance than import');
  if (require(join(PKG_DIR, pkg.exports['.'].import)).createHttpProvider !== mainEsm.createHttpProvider) {
    fail('require(esm) of the main entry returned a different module instance than import');
  }
  await checkInstall('require(esm) entry', sdk, required);
} catch (err) {
  fail(`require(esm) of ${manifest.entry} failed: ${err.stack ?? err}`);
}
server.close();

const pack = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], { cwd: PKG_DIR, encoding: 'utf8' }),
);
const packed = new Set(pack[0].files.map((f) => f.path));
for (const file of ['holodeck.package.json', manifest.entry, 'dist/holodeck-package.d.ts', 'README.md', 'LICENSE']) {
  if (!packed.has(file)) fail(`npm pack would not publish ${file}`);
}
for (const file of packed) {
  if (/\.test\.ts$|test-support\//.test(file)) fail(`npm pack would publish test file ${file}`);
}

if (failures.length) {
  console.error(`\nsmoke-holodeck-package FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`smoke-holodeck-package OK: ${manifest.id}@${manifest.version} (${manifest.entry})`);
