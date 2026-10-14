/**
 * Entry module of the `holodeck.flow-runtime` Holodeck package
 * (`holodeck.package.json` at the package root; contract: @holodeck/sdk
 * docs/PACKAGING.md §3).
 *
 *   await host.installPackage(FLOW_RUNTIME_PACKAGE_MANIFEST, flowRuntimePackage);
 *
 * Contributes the four structural blocks (`holodeck.flow.block`) and the
 * `holodeck.flow.local` provider. The block kind belongs to the
 * `holodeck.flow` engine; until a host registers that engine the blocks wait
 * as `pending` (the provider still installs and resolves the built-ins itself).
 *
 * The default module's provider has no `SignalBridge`, because the bridge
 * depends on a document's `ProviderHub`, which does not exist at install
 * time. A host that wants `signal.in` / `signal.out` installs a module made
 * by `createFlowRuntimePackage({ signals })` instead.
 *
 * Built to `dist/holodeck-package.mjs` (the manifest's `entry`) and also
 * re-exported from the main entry, so bundled apps need no second import.
 */

import {
  defineHolodeckPackage,
  HOLODECK_KINDS,
  parseHolodeckPackageManifest,
  type HolodeckExtension,
  type HolodeckPackageModule,
} from '@holodeck/sdk';
import manifestJson from '../holodeck.package.json';
import { BUILTIN_FLOW_BLOCKS } from './builtins';
import { createLocalFlowProvider, type LocalFlowProviderOptions } from './provider';

/** `holodeck.package.json`, validated (a malformed manifest fails at import, and in tests). */
export const FLOW_RUNTIME_PACKAGE_MANIFEST = parseHolodeckPackageManifest(manifestJson);

/** The package's extension: fresh lists and a fresh provider per call. */
export function createFlowRuntimeExtension(options: LocalFlowProviderOptions = {}): HolodeckExtension {
  return {
    id: FLOW_RUNTIME_PACKAGE_MANIFEST.id,
    version: FLOW_RUNTIME_PACKAGE_MANIFEST.version,
    label: FLOW_RUNTIME_PACKAGE_MANIFEST.name,
    description: FLOW_RUNTIME_PACKAGE_MANIFEST.description,
    contributions: {
      [HOLODECK_KINDS.flowBlock]: [...BUILTIN_FLOW_BLOCKS],
      [HOLODECK_KINDS.provider]: [createLocalFlowProvider(options)],
    },
  };
}

/** A package module whose provider uses `options` (e.g. a `signals` bridge). */
export function createFlowRuntimePackage(options: LocalFlowProviderOptions = {}): HolodeckPackageModule {
  return defineHolodeckPackage({
    manifest: FLOW_RUNTIME_PACKAGE_MANIFEST,
    createExtension: () => createFlowRuntimeExtension(options),
  });
}

export const flowRuntimePackage = createFlowRuntimePackage();

export default flowRuntimePackage;
