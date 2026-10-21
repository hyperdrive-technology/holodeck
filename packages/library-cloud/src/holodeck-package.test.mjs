import { describe, expect, it } from 'vitest';
import { HolodeckHost, checkExtensionMatchesManifest, packageRoles, validateHolodeckPackageManifest } from '@holodeck/sdk';
import manifest from '../holodeck.package.json';
import npmPackage from '../package.json';
import entry, { CLOUD_PACKAGE_MANIFEST, cloudPackage, createCloudExtension } from './holodeck-package';
import { CLOUD_PART_DEFINITIONS, createCloudParts } from './parts';
import { ARCENTRY_LIGHT, ARCENTRY_DARK, CLOUD_THEMES } from './themes';
// Pure engine contracts only: no React, renderer or editor installation required in this CI job.
// (the editor's ./contracts entry; vitest.config.ts maps it to source, holodeck#137).
import { HOLODECK_STYLE, ISO_KINDS, isIsoPartDefinition, isIsoTheme } from '@holodeck/editor-2.5d-react/contracts';

const manifestUrl = 'https://assets.example.test/packs/cloud/holodeck.package.json';
const assetBase = 'https://assets.example.test/packs/cloud/assets/';
const context = { host: 'test', assetUrl: (path) => new URL(path, assetBase).href };
const engine = { id: 'holodeck.iso', label: 'Iso contract', apiVersion: '1.0.0', documentFormat: 'holodeck.iso.scene.v1', kinds: ISO_KINDS };
const expectedIds = [
  'server', 'database', 'cache', 'queue', 'load-balancer', 'gateway', 'function',
  'container', 'bucket', 'user', 'generic-block', 'generic-cube', 'generic-flat',
  'broker', 'cdn', 'registry', 'disk', 'warehouse', 'stream', 'firewall', 'vault',
  'identity', 'monitoring', 'mobile', 'pc', 'billboard',
].map((name) => `cloud:${name}`);

describe('cloud package contract', () => {
  it('validates with the SDK and matches the published entry and version', () => {
    expect(validateHolodeckPackageManifest(manifest)).toEqual([]);
    expect(manifest.id).toBe('holodeck.cloud');
    expect(manifest.version).toBe(npmPackage.version);
    expect(packageRoles(CLOUD_PACKAGE_MANIFEST)).toEqual(['theme', 'library']);
    expect(npmPackage.type).toBe('module');
    expect(npmPackage.engines.node).toBe('>=26');
    expect(npmPackage.exports['./holodeck-package'].import).toBe(`./${manifest.entry}`);
    expect(entry).toBe(cloudPackage);
    expect(entry.manifest).toEqual(manifest);
    expect(checkExtensionMatchesManifest(CLOUD_PACKAGE_MANIFEST, createCloudExtension(context))).toEqual([]);
  });

  it('provides all twenty-six data-only parts accepted by E2', () => {
    expect(CLOUD_PART_DEFINITIONS.map((part) => part.id)).toEqual(expectedIds);
    expect(new Set(expectedIds).size).toBe(26);
    // Library pickers show label + hint: both must tell the archetypes apart.
    expect(new Set(CLOUD_PART_DEFINITIONS.map((part) => part.label)).size).toBe(26);
    expect(new Set(CLOUD_PART_DEFINITIONS.map((part) => part.hint)).size).toBe(26);
    const categories = ['Compute', 'Data', 'Storage', 'Networking', 'Security', 'Operations', 'Devices', 'People', 'Generic'];
    for (const part of CLOUD_PART_DEFINITIONS) {
      expect(categories, part.id).toContain(part.category);
      expect(part.hint.length, part.id).toBeGreaterThan(8);
    }
    for (const part of createCloudParts(context.assetUrl)) {
      expect(isIsoPartDefinition(part), part.id).toBe(true);
      expect(part).not.toHaveProperty('component');
      expect(part.instanced).toBe(false);
      // An upright sign is still an annotation: it never blocks routing.
      expect(part.floor).toBe(part.id === 'cloud:billboard');
      expect(part.footprint).toEqual({ w: 2, h: 2 });
      expect(part.params).toEqual({});
      expect(part.model).toBe(`${assetBase}models/${part.id.slice(6)}.glb`);
      expect(part.logo.url).toBe(`${assetBase}logos/cloud.svg`);
      expect(part.logo.size).toBeUndefined(); // use the model's authored slot
      expect(part.colors.accent).toMatch(/^#[\da-f]{6}$/i);
      expect(JSON.parse(JSON.stringify(part))).toEqual(part);
    }
  });

  it('supplies both complete themes including every E2 annotation token', () => {
    expect(CLOUD_THEMES.map((theme) => theme.id)).toEqual(['arcentry-light', 'arcentry-dark']);
    for (const theme of CLOUD_THEMES) {
      expect(isIsoTheme(theme)).toBe(true);
      for (const group of ['colors', 'finishes', 'edges', 'annotation']) {
        expect(Object.keys(theme.style[group]).sort()).toEqual(Object.keys(HOLODECK_STYLE[group]).sort());
      }
      expect(Object.keys(theme.style.edges.thresholds).sort()).toEqual(Object.keys(HOLODECK_STYLE.edges.thresholds).sort());
      expect(theme.style.finishes.white.color).toBe(theme.style.colors.body);
      expect(theme.style.finishes.accent.color).toBe(theme.style.colors.accent);
    }
    expect(ARCENTRY_LIGHT.style.colors.body).not.toBe(ARCENTRY_DARK.style.colors.body);
    expect(ARCENTRY_LIGHT.style.annotation.text).not.toBe(ARCENTRY_DARK.style.annotation.text);
    // Body and edge stay theme-controlled unless a consumer explicitly overrides them.
    expect(CLOUD_PART_DEFINITIONS.every((part) => part.colors.body === undefined && part.colors.edge === undefined)).toBe(true);
  });

  it.each([false, true])('installs with engine registered first = %s, and uninstalls cleanly', async (engineFirst) => {
    const host = new HolodeckHost({ name: 'test' });
    if (engineFirst) host.registerEngine(engine);
    const report = await host.installPackage(manifest, entry, { manifestUrl });
    expect(report.unresolvedEngines).toEqual(engineFirst ? [] : ['holodeck.iso']);
    if (!engineFirst) {
      expect(host.registry.list('holodeck.iso.part')).toHaveLength(0);
      host.registerEngine(engine);
    }
    const parts = host.registry.list('holodeck.iso.part');
    expect(parts.map((part) => part.id)).toEqual(expectedIds);
    expect(parts[0].model).toBe(`${assetBase}models/server.glb`);
    expect(host.registry.list('holodeck.iso.theme').map((theme) => theme.id)).toEqual(['arcentry-light', 'arcentry-dark']);
    expect(host.uninstallPackage(manifest.id).removed).toEqual([manifest.id]);
    expect(host.registry.list('holodeck.iso.part')).toEqual([]);
    expect(host.registry.list('holodeck.iso.theme')).toEqual([]);
  });

  it('isolates nested part and theme data between installations', () => {
    const a = createCloudExtension(context);
    const b = createCloudExtension(context);
    a.contributions['holodeck.iso.part'][0].colors.accent = '#ff0000';
    a.contributions['holodeck.iso.part'][0].footprint.w = 9;
    a.contributions['holodeck.iso.part'][0].logo.url = 'changed.svg';
    a.contributions['holodeck.iso.theme'][0].style.annotation.text = '#ff0000';
    expect(b).toEqual(createCloudExtension(context));
    expect(CLOUD_PART_DEFINITIONS[0].logo.url).toBe('logos/cloud.svg');
  });
});
