import {
  checkExtensionMatchesManifest,
  createManualSchedule,
  HOLODECK_KINDS,
  HolodeckHost,
  packageRoles,
  validateHolodeckPackageManifest,
  type HolodeckProvider,
} from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import manifestJson from '../holodeck.package.json';
import { BUILTIN_FLOW_BLOCKS } from './builtins';
import flowRuntimePackageDefault, {
  createFlowRuntimeExtension,
  createFlowRuntimePackage,
  FLOW_RUNTIME_PACKAGE_MANIFEST,
  flowRuntimePackage,
} from './holodeck-package';
import { createMemorySignalBridge } from './bridge';
import { flowDoc, graph, node, standInFlowEngine, wire } from './test-helpers';

describe('holodeck.package.json', () => {
  it('is a valid manifest for a flow library + provider package', () => {
    expect(validateHolodeckPackageManifest(manifestJson)).toEqual([]);
    expect(FLOW_RUNTIME_PACKAGE_MANIFEST).toMatchObject({
      id: 'holodeck.flow-runtime',
      contributes: ['holodeck.flow.block', 'holodeck.provider'],
      engines: { 'holodeck.flow': '^1.0' },
      providers: ['holodeck.flow.local'],
      entry: 'dist/holodeck-package.mjs',
    });
    expect(packageRoles(FLOW_RUNTIME_PACKAGE_MANIFEST)).toEqual(['library', 'provider']);
  });

  it('matches the extension the entry creates', () => {
    expect(checkExtensionMatchesManifest(FLOW_RUNTIME_PACKAGE_MANIFEST, createFlowRuntimeExtension())).toEqual([]);
  });
});

describe('entry module', () => {
  it('default-exports the package module', () => {
    expect(flowRuntimePackageDefault).toBe(flowRuntimePackage);
    expect(flowRuntimePackage.manifest).toBe(FLOW_RUNTIME_PACKAGE_MANIFEST);
  });

  it('creates fresh lists and a fresh provider per extension', () => {
    const a = createFlowRuntimeExtension();
    const b = createFlowRuntimeExtension();
    expect(a.contributions[HOLODECK_KINDS.flowBlock]).not.toBe(b.contributions[HOLODECK_KINDS.flowBlock]);
    expect(a.contributions[HOLODECK_KINDS.flowBlock]).toEqual([...BUILTIN_FLOW_BLOCKS]);
    expect(a.contributions[HOLODECK_KINDS.provider]![0]).not.toBe(b.contributions[HOLODECK_KINDS.provider]![0]);
  });

  it('installs into a host with the flow engine: blocks and provider registered', async () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(standInFlowEngine);
    const report = await host.installPackage(manifestJson, flowRuntimePackage);
    expect(report.unresolvedEngines).toEqual([]);
    expect(host.registry.list(HOLODECK_KINDS.flowBlock).map((b) => b.id)).toEqual(['flow.const', 'flow.delay', 'signal.in', 'signal.out']);
    expect(host.registry.get(HOLODECK_KINDS.provider, 'holodeck.flow.local')).toBeDefined();
  });

  it('installs before the engine: blocks wait as pending, the provider works already', async () => {
    const host = new HolodeckHost({ name: 'test' });
    const report = await host.installPackage(manifestJson, flowRuntimePackage);
    expect(report.unresolvedEngines).toEqual(['holodeck.flow']);
    expect(Object.keys(host.registry.pending())).toEqual([HOLODECK_KINDS.flowBlock]);
    const hub = host.createProviderHub();
    hub.setConnections([{ id: 'flow', provider: 'holodeck.flow.local' }]);
    await hub.settled();
    const result = await hub.session('flow')!.deploy!(flowDoc(graph([node('k', 'flow.const', { value: 2 }), node('d', 'flow.delay')], [wire('w', 'k.value', 'd.in')])));
    expect(result.ok).toBe(true);
    await hub.dispose();
    host.registerEngine(standInFlowEngine);
    expect(host.registry.list(HOLODECK_KINDS.flowBlock)).toHaveLength(4);
  });

  it('createFlowRuntimePackage passes options (a signal bridge) to the provider', async () => {
    const manual = createManualSchedule();
    const bridge = createMemorySignalBridge();
    bridge.set('plc', 'a', 7);
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(standInFlowEngine);
    await host.installPackage(manifestJson, createFlowRuntimePackage({ signals: bridge, schedule: manual.schedule }));
    const provider = host.registry.get<HolodeckProvider>(HOLODECK_KINDS.provider, 'holodeck.flow.local')!;
    const hub = host.createProviderHub();
    hub.setConnections([{ id: 'flow', provider: provider.id }]);
    await hub.settled();
    const doc = flowDoc(graph([node('in', 'signal.in', { connection: 'plc', source: 'a' })]), [{ id: 'plc', provider: 'acme.plc' }, { id: 'flow', provider: provider.id }]);
    expect((await hub.session('flow')!.deploy!(doc)).ok).toBe(true);
    expect((await hub.session('flow')!.read!(['flow:in.value']))[0]?.value).toBe(7);
    await hub.dispose();
    expect(manual.active).toBe(0);
  });
});
