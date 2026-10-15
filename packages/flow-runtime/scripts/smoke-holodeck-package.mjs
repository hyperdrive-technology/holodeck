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
 * 3. `@holodeck/flow-runtime/holodeck-package` resolves by name, and each
 *    default export installs into a HolodeckHost that has a `holodeck.flow`
 *    engine built from the main entry's helpers (lane F2 ships the real one).
 *    The four structural blocks and the provider register, and the provider
 *    deploys and runs a small flow through a ProviderHub.
 * 4. The package is ESM only (no CJS build, holodeck#60). Node's `require(esm)`
 *    of the entry works (so there is no top-level await) and returns the very
 *    same module instance as `import`: one copy of the built-ins per realm.
 * 5. `npm pack --dry-run` publishes the manifest and the entry.
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

const BLOCKS = ['flow.const', 'flow.delay', 'signal.in', 'signal.out'];
const DOC = {
  format: 'holodeck.document.v1',
  id: 'smoke',
  name: 'Smoke flow',
  engine: 'holodeck.flow',
  engineVersion: '1.0.0',
  connections: [{ id: 'flow', provider: 'holodeck.flow.local' }],
  body: {
    nodes: [
      { id: 'k', block: 'flow.const', params: { type: 'number', value: 42 }, position: { x: 0, y: 0 } },
      { id: 'd', block: 'flow.delay', position: { x: 100, y: 0 } },
    ],
    wires: [{ id: 'w', from: { node: 'k', port: 'value' }, to: { node: 'd', port: 'in' } }],
  },
};

/** The engine descriptor F2 will register, minus its React kinds. */
const engineFrom = (main) => ({
  id: main.FLOW_ENGINE_ID,
  label: 'Holodeck flow (smoke)',
  apiVersion: main.FLOW_ENGINE_API_VERSION,
  documentFormat: main.flowGraphFormat,
  kinds: [main.FLOW_BLOCK_KIND],
  validateBody: (body) => main.validateFlowBody(body),
  collectBindings: (body) => main.collectFlowBindings(body),
});

async function checkInstall(label, sdk, main, mod) {
  const entry = mod?.default ?? mod;
  if (typeof entry?.createExtension !== 'function') {
    fail(`${label}: default export has no createExtension()`);
    return;
  }
  try {
    const host = new sdk.HolodeckHost({ name: 'smoke' });
    host.registerEngine(engineFrom(main));
    const report = await host.installPackage(manifest, entry);
    if (report.unresolvedEngines.length) fail(`${label}: unresolved engines ${report.unresolvedEngines}`);
    const blocks = host.registry.list('holodeck.flow.block').map((b) => b.id);
    if (JSON.stringify(blocks) !== JSON.stringify(BLOCKS)) fail(`${label}: blocks ${JSON.stringify(blocks)}`);
    if (!host.registry.get('holodeck.provider', 'holodeck.flow.local')) fail(`${label}: provider not registered`);
    const hub = host.createProviderHub();
    hub.setConnections(DOC.connections);
    await hub.settled();
    const session = hub.session('flow');
    const result = await session.deploy(DOC);
    if (!result.ok) fail(`${label}: deploy failed ${JSON.stringify(result.diagnostics)}`);
    const [sample] = await session.read(['flow:d.out']);
    if (sample?.value !== 42) fail(`${label}: flow:d.out = ${JSON.stringify(sample)}`);
    // Stops the run's real setInterval so this process can exit.
    await hub.dispose();
    console.log(`${label}: installed ${manifest.id}@${manifest.version}, ${blocks.length} blocks, deployed ${result.sources.length} sources`);
  } catch (err) {
    fail(`${label}: install/deploy threw: ${err.stack ?? err}`);
  }
}

const sdk = await import('@holodeck/sdk');
const manifestErrors = sdk.validateHolodeckPackageManifest(manifest);
if (manifestErrors.length) fail(`holodeck.package.json is invalid:\n  ${manifestErrors.join('\n  ')}`);

// Self-reference by package name works from files inside the package.
const mainEsm = await import(pkg.name);

try {
  await checkInstall(`entry ${manifest.entry}`, sdk, mainEsm, await import(pathToFileURL(join(PKG_DIR, manifest.entry)).href));
} catch (err) {
  fail(`importing ${manifest.entry} threw: ${err.stack ?? err}`);
}
try {
  await checkInstall('esm ./holodeck-package', sdk, mainEsm, await import(`${pkg.name}/holodeck-package`));
} catch (err) {
  fail(`import ${pkg.name}/holodeck-package threw: ${err.stack ?? err}`);
}
try {
  // require(esm): one synchronous call, by path (the exports map is import-only).
  const entryPath = join(PKG_DIR, manifest.entry);
  const required = require(entryPath);
  const imported = await import(pathToFileURL(entryPath).href);
  if (required.default !== imported.default) fail('require(esm) returned a different module instance than import');
  if (require(join(PKG_DIR, pkg.exports['.'].import)).createLocalFlowProvider !== mainEsm.createLocalFlowProvider) {
    fail('require(esm) of the main entry returned a different module instance than import');
  }
  await checkInstall('require(esm) entry', sdk, mainEsm, required);
} catch (err) {
  fail(`require(esm) of ${manifest.entry} failed: ${err.stack ?? err}`);
}

const pack = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], { cwd: PKG_DIR, encoding: 'utf8' }),
);
const packed = new Set(pack[0].files.map((f) => f.path));
for (const file of ['holodeck.package.json', manifest.entry, 'dist/holodeck-package.d.ts', 'README.md']) {
  if (!packed.has(file)) fail(`npm pack would not publish ${file}`);
}

if (failures.length) {
  console.error(`\nsmoke-holodeck-package FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`smoke-holodeck-package OK: ${manifest.id}@${manifest.version} (${manifest.entry})`);
