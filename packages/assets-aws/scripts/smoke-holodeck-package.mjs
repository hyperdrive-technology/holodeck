#!/usr/bin/env node
/** Plain-Node consumer check: built exports, manifest installation, asset URLs and npm contents. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HolodeckHost, validateHolodeckPackageManifest } from '@holodeck/sdk';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'holodeck.package.json'), 'utf8'));
assert.deepEqual(validateHolodeckPackageManifest(manifest), []);
const main = await import(pkg.name);
const entryPath = join(root, manifest.entry);
const byPath = await import(pathToFileURL(entryPath).href);
const byName = await import(`${pkg.name}/holodeck-package`);
const byRequire = createRequire(import.meta.url)(entryPath);
assert.equal(byPath.default, byName.default);
assert.equal(byPath.default, byRequire.default);
assert.equal(main.awsPackage, byPath.default);

const manifestUrl = 'https://assets.example.test/aws/holodeck.package.json';
const assetBase = new URL(manifest.assets + '/', manifestUrl).href;
// Real engine validators are exercised by Vitest; this consumer needs only the SDK.
const host = new HolodeckHost({ name: 'aws-smoke' });
// holodeck.cloud is a required package. Its own smoke covers its contents; here a stub with the
// real manifest stands in so `requires` is exercised without installing library-cloud.
const cloudManifest = JSON.parse(readFileSync(join(root, '../library-cloud/holodeck.package.json'), 'utf8'));
await host.installPackage(cloudManifest, { manifest: cloudManifest, createExtension: () => ({ id: cloudManifest.id, version: cloudManifest.version, contributions: {} }) }, { manifestUrl: 'https://assets.example.test/cloud/holodeck.package.json' });
const report = await host.installPackage(manifest, byPath.default, { manifestUrl });
assert.deepEqual(report.unresolvedEngines, ['holodeck.iso']);
for (const kind of manifest.contributes) host.registry.registerKind({ kind, validate: (value) => typeof value?.id === 'string' });
const parts = host.registry.list('holodeck.iso.part');
const services = JSON.parse(readFileSync(join(root, 'src/services.json'), 'utf8'));
assert.deepEqual(parts.map((part) => part.id), services.map((s) => `aws:${s.slug}`));
assert.ok(parts.every((part) => part.logo.url.endsWith('.svg') && part.model.endsWith('.glb')));
const required = new Set(['holodeck.package.json', manifest.entry, 'dist/holodeck-package.d.ts', 'README.md', 'LICENSE', `${manifest.assets}/aws-icons/NOTICE.txt`]);
for (const part of parts) {
  for (const url of [part.model, part.logo.url]) {
    assert.ok(url.startsWith(assetBase), `${part.id}: unresolved asset ${url}`);
    const path = `${manifest.assets}/${url.slice(assetBase.length)}`;
    const bytes = readFileSync(join(root, path));
    assert.ok(bytes.length > 0, `${path} is empty`);
    if (path.endsWith('.glb')) assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    required.add(path);
  }
}
const pack = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--loglevel=error'], { cwd: root, encoding: 'utf8' }));
const packed = new Set(pack[0].files.map((file) => file.path));
for (const path of required) assert.ok(packed.has(path), `npm pack omits ${path}`);
for (const path of packed) assert.doesNotMatch(path, /\.test\.|test-support\//);
host.uninstallPackage(manifest.id);
assert.equal(host.registry.list('holodeck.iso.part').length, 0);
console.log(`aws package smoke OK: ${parts.length} parts, ${required.size} required files published`);
