import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HOLODECK_KINDS,
  HolodeckHost,
  USER_OWNER,
  checkExtensionMatchesManifest,
  packageRoles,
  satisfiesRange,
  validateHolodeckPackageManifest,
} from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import manifestJson from '../holodeck.package.json';
import sceneJson from '../tests/scene.json';
import { isoEngine } from './engine/iso-engine';
import { loadIsoDocument, toIsoDocument } from './engine/document';
import isoPackageDefault, { ISO_PACKAGE_MANIFEST, createIsoPackageExtension, isoPackage } from './holodeck-package';
import * as main from './index';
import { BUILTIN_ISO_EXTENSION, BUILTIN_ISO_EXTENSION_ID, BUILTIN_ISO_PARTS } from './registry/builtin';
import { createIsoRegistryWithBuiltins } from './registry/default';
import { ISO_KINDS } from './registry/kinds';

const PKG_DIR = join(__dirname, '..');
const readJson = (file: string) => JSON.parse(readFileSync(join(PKG_DIR, file), 'utf8'));

describe('holodeck.package.json', () => {
  it('is a valid holodeck.package.v1 manifest', () => {
    expect(validateHolodeckPackageManifest(manifestJson)).toEqual([]);
    expect(ISO_PACKAGE_MANIFEST).toEqual(manifestJson);
  });

  it('declares the engine exactly as the isoEngine descriptor does', () => {
    expect(ISO_PACKAGE_MANIFEST.id).toBe(isoEngine.id);
    expect(ISO_PACKAGE_MANIFEST.version).toBe('1.0.0');
    expect(ISO_PACKAGE_MANIFEST.engine).toEqual({
      id: isoEngine.id,
      apiVersion: isoEngine.apiVersion,
      documentFormat: isoEngine.documentFormat,
    });
    expect(ISO_PACKAGE_MANIFEST.contributes).toEqual(ISO_KINDS.map((k) => k.kind));
    expect(ISO_PACKAGE_MANIFEST.engines).toEqual({ 'holodeck.iso': '^1.0' });
    expect(satisfiesRange(isoEngine.apiVersion, ISO_PACKAGE_MANIFEST.engines!['holodeck.iso']!)).toBe(true);
  });

  it('is indexed as an engine, theme and library package', () => {
    expect(packageRoles(ISO_PACKAGE_MANIFEST)).toEqual(['engine', 'theme', 'library']);
  });

  it('names no host product (Holodeck stays host-agnostic)', () => {
    // homepage / repository name the GitHub org that hosts the repo; everything else describes content.
    const { homepage: _homepage, repository: _repository, ...content } = ISO_PACKAGE_MANIFEST;
    expect(JSON.stringify(content)).not.toMatch(/hyperdrive|plc/i);
  });
});

describe('build and publish wiring for the entry module', () => {
  const pkg = readJson('package.json');

  it('the manifest entry is what the package exports as ./holodeck-package', () => {
    expect(ISO_PACKAGE_MANIFEST.entry).toBe('dist/holodeck-package.mjs');
    expect(pkg.exports['./holodeck-package']).toEqual({
      types: './dist/holodeck-package.d.ts',
      import: `./${ISO_PACKAGE_MANIFEST.entry}`,
      require: './dist/holodeck-package.js',
    });
    expect(pkg.exports['./holodeck.package.json']).toBe('./holodeck.package.json');
  });

  it('tsup builds the entry and npm publishes the manifest', () => {
    const tsup = readFileSync(join(PKG_DIR, 'tsup.config.ts'), 'utf8');
    expect(tsup).toMatch(/entry:\s*\[[^\]]*'src\/holodeck-package\.ts'/);
    expect(pkg.files).toContain('holodeck.package.json');
    expect(pkg.files).toContain('dist/**/*');
  });
});

describe('entry module', () => {
  it('default-exports the package module with the embedded manifest', () => {
    expect(isoPackageDefault).toBe(isoPackage);
    expect(isoPackage.manifest).toBe(ISO_PACKAGE_MANIFEST);
    expect(main.isoPackage).toBe(isoPackage);
    expect(main.ISO_PACKAGE_MANIFEST).toBe(ISO_PACKAGE_MANIFEST);
  });

  it('creates the built-ins under the package id; BUILTIN_ISO_EXTENSION keeps its own id', () => {
    const ext = createIsoPackageExtension();
    expect(ext.id).toBe('holodeck.iso');
    expect(ext.version).toBe('1.0.0');
    expect(BUILTIN_ISO_EXTENSION.id).toBe(BUILTIN_ISO_EXTENSION_ID);
    expect(BUILTIN_ISO_EXTENSION_ID).toBe('holodeck.iso.builtin');
    for (const [kind, items] of Object.entries(BUILTIN_ISO_EXTENSION.contributions)) {
      expect(ext.contributions[kind]).toEqual(items);
      // Same item objects, fresh lists.
      ext.contributions[kind]!.forEach((item, i) => expect(item).toBe(items[i]));
      expect(ext.contributions[kind]).not.toBe(items);
    }
    expect(checkExtensionMatchesManifest(ISO_PACKAGE_MANIFEST, ext)).toEqual([]);
  });

  it('returns fresh lists on every call', () => {
    const a = createIsoPackageExtension();
    const b = createIsoPackageExtension();
    expect(a.contributions[HOLODECK_KINDS.isoPart]).not.toBe(b.contributions[HOLODECK_KINDS.isoPart]);
    a.contributions[HOLODECK_KINDS.isoPart]!.length = 0;
    expect(b.contributions[HOLODECK_KINDS.isoPart]).toHaveLength(BUILTIN_ISO_PARTS.length);
    expect(createIsoPackageExtension().contributions[HOLODECK_KINDS.isoPart]).toHaveLength(BUILTIN_ISO_PARTS.length);
  });
});

describe('installing holodeck.iso into a HolodeckHost', () => {
  it('installs after the engine registers: every item passes the kind validators', async () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(isoEngine);
    const report = await host.installPackage(manifestJson, isoPackage);
    expect(report).toMatchObject({ packageId: 'holodeck.iso', shared: false, unresolvedEngines: [] });
    expect(report.install?.pending).toEqual([]);
    expect(host.registry.list(HOLODECK_KINDS.isoPart).map((p) => p.id)).toEqual(BUILTIN_ISO_PARTS.map((p) => p.id));
    expect(host.registry.list(HOLODECK_KINDS.isoTheme).length).toBeGreaterThan(0);
    expect(host.registry.list(HOLODECK_KINDS.isoAnimator).length).toBeGreaterThan(0);
    expect(host.package('holodeck.iso')?.owners).toEqual([USER_OWNER]);
  });

  it('installs before the engine registers: kinds wait as pending and replay', async () => {
    const host = new HolodeckHost({ name: 'test' });
    const report = await host.installPackage(manifestJson, isoPackage);
    expect(report.unresolvedEngines).toEqual(['holodeck.iso']);
    expect(host.registry.list(HOLODECK_KINDS.isoPart)).toHaveLength(0);
    host.registerEngine(isoEngine);
    expect(host.registry.list(HOLODECK_KINDS.isoPart)).toHaveLength(BUILTIN_ISO_PARTS.length);
  });

  it('a second owner shares the installed package', async () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(isoEngine);
    await host.installPackage(manifestJson, isoPackage);
    const shared = await host.installPackage(manifestJson, isoPackage, { owner: 'some.extension', range: '^1.0' });
    expect(shared.shared).toBe(true);
    expect(host.package('holodeck.iso')?.owners).toEqual([USER_OWNER, 'some.extension']);
  });

  it('uninstalling removes the built-ins again', async () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(isoEngine);
    await host.installPackage(manifestJson, isoPackage);
    expect(host.uninstallPackage('holodeck.iso')).toEqual({ removed: ['holodeck.iso'], kept: [] });
    expect(host.registry.list(HOLODECK_KINDS.isoPart)).toHaveLength(0);
  });

  it('fails cleanly next to BUILTIN_ISO_EXTENSION (same parts), leaving the host unchanged', async () => {
    const registry = createIsoRegistryWithBuiltins();
    const host = new HolodeckHost({ name: 'test', registry });
    host.registerEngine(isoEngine);
    await expect(host.installPackage(manifestJson, isoPackage)).rejects.toThrow();
    expect(host.package('holodeck.iso')).toBeUndefined();
    expect(registry.installedExtensions().map((e) => e.id)).toEqual([BUILTIN_ISO_EXTENSION_ID]);
  });

  it('a host with the package installed loads and checks documents against it', async () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(isoEngine);
    await host.installPackage(manifestJson, isoPackage);
    const { document } = loadIsoDocument(toIsoDocument(loadIsoDocument(sceneJson).scene), host.registry);
    expect(await host.checkDocument(document)).toEqual([]);
  });
});
