import { describe, expect, it } from 'vitest';
import { HolodeckHost, checkExtensionMatchesManifest, packageRoles, validateHolodeckPackageManifest } from '@holodeck/sdk';
// Pure engine contracts only: no React or renderer (the editor's ./contracts entry, aliased in vitest.config.ts).
import { ISO_KINDS } from '@holodeck/editor-2.5d-react/contracts';
import manifest from '../holodeck.package.json';
import npmPackage from '../package.json';
import entry, { createProcessExtension, PROCESS_PACKAGE_MANIFEST, processPackage } from './holodeck-package';
import * as main from './index';
import { PROCESS_MODELS, PROCESS_MODEL_SLUGS, processModelPath } from './models';
import { PROCESS_PART_DEFINITIONS, type ProcessPartDefinition } from './parts';

const manifestUrl = 'https://assets.example.test/packs/process/holodeck.package.json';
const assetBase = 'https://assets.example.test/packs/process/assets/';
const context = { host: 'test', assetUrl: (path: string) => new URL(path, assetBase).href };
const engine = { id: 'holodeck.iso', label: 'Iso contract', apiVersion: '1.0.0', documentFormat: 'holodeck.iso.scene.v1', kinds: ISO_KINDS };
const expectedIds = [
  'valve-ball', 'valve-butterfly', 'valve-control', 'valve-actuated', 'valve-solenoid', 'valve-three-way', 'valve-check', 'valve-relief',
  'motor', 'pump-lobe', 'pump-inline', 'pump-dosing', 'blower', 'compressor',
  'heat-exchanger-shell-tube', 'boiler', 'cooling-tower',
  'filter', 'strainer-y', 'cyclone',
  'transmitter', 'gauge-pressure', 'flowmeter-mag', 'level-radar', 'beacon',
  'cabinet', 'vfd', 'junction-box',
].map((s) => `process:${s}`);

describe('process package contract', () => {
  it('validates with the SDK and matches the published entry and version', () => {
    expect(validateHolodeckPackageManifest(manifest)).toEqual([]);
    expect(manifest.id).toBe('holodeck.process');
    expect(manifest.version).toBe(npmPackage.version);
    expect(manifest.contributes).toEqual(['holodeck.iso.part']);
    expect(packageRoles(PROCESS_PACKAGE_MANIFEST)).toEqual(['library']);
    expect(npmPackage.name).toBe('@holodeck/library-process');
    expect(npmPackage.type).toBe('module');
    expect(npmPackage.engines.node).toBe('>=26.13.0');
    expect(npmPackage.exports['./holodeck-package'].import).toBe(`./${manifest.entry}`);
    expect(Object.keys(npmPackage.dependencies)).toEqual(['@holodeck/sdk']);
    expect(entry).toBe(processPackage);
    expect(entry.manifest).toEqual(manifest);
    expect(checkExtensionMatchesManifest(PROCESS_PACKAGE_MANIFEST, createProcessExtension(context))).toEqual([]);
  });

  it('re-exports the package surface from the main entry', () => {
    expect(main.processPackage).toBe(processPackage);
    expect(main.PROCESS_PART_DEFINITIONS).toBe(PROCESS_PART_DEFINITIONS);
    expect(main.PROCESS_MODELS).toBe(PROCESS_MODELS);
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
    const parts = host.registry.list<ProcessPartDefinition>('holodeck.iso.part');
    expect(parts.map((part) => part.id)).toEqual(expectedIds);
    for (const part of parts) {
      expect(part.model).toBe(`${assetBase}models/${part.id.slice('process:'.length)}.glb`);
      expect(host.registry.ownerOf('holodeck.iso.part', part.id)).toBe('holodeck.process');
    }
    expect(host.uninstallPackage(manifest.id).removed).toEqual([manifest.id]);
    expect(host.registry.list('holodeck.iso.part')).toEqual([]);
  });

  it('isolates nested part data between installations', () => {
    const a = createProcessExtension(context);
    const b = createProcessExtension(context);
    const first = a.contributions['holodeck.iso.part']![0] as ProcessPartDefinition;
    first.footprint.w = 9;
    first.params.open!.default = false;
    first.animNodes!.open!.settings!.fromDeg = 7;
    first.ports!.in!.x = 3;
    expect(b).toEqual(createProcessExtension(context));
    expect(PROCESS_PART_DEFINITIONS[0]!.model).toBe('models/valve-ball.glb');
    expect(PROCESS_PART_DEFINITIONS[0]!.footprint.w).toBe(1);
  });
});

describe('model asset map', () => {
  it('maps each slug to its asset-relative GLB path and throws on unknown names', () => {
    for (const slug of PROCESS_MODEL_SLUGS) expect(processModelPath(slug)).toBe(`models/${slug}.glb`);
    expect(() => processModelPath('pump')).toThrow(/unknown process model "pump"/);
    expect(() => processModelPath('toString')).toThrow(/unknown process model "toString"/);
    expect(() => processModelPath('__proto__')).toThrow(/unknown process model/);
  });

  it('is deeply frozen so a consumer cannot repoint or reshape a model contract', () => {
    expect(Object.isFrozen(PROCESS_MODELS)).toBe(true);
    expect(Object.isFrozen(PROCESS_MODELS['valve-ball'])).toBe(true);
    expect(Object.isFrozen(PROCESS_MODELS['valve-ball']!.ports.in)).toBe(true);
    expect(Object.isFrozen(PROCESS_MODEL_SLUGS)).toBe(true);
  });
});
