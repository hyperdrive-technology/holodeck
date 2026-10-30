/**
 * Entry module of the `holodeck.iso` Holodeck package (`holodeck.package.json`
 * at the package root; contract: @holodeck/sdk docs/PACKAGING.md §3).
 *
 *   host.registerEngine(isoEngine);
 *   await host.installPackage(ISO_PACKAGE_MANIFEST, isoPackage);
 *
 * Built to `dist/holodeck-package.mjs` (the manifest's `entry`) and also
 * re-exported from the main entry, so bundled apps need no second import.
 *
 * Why a second extension id: the SDK requires the extension id to equal the
 * manifest id (`checkExtensionMatchesManifest`), and the package id is the
 * engine id, `holodeck.iso` (PACKAGING.md §2: an engine's built-ins ship as a
 * package with the engine's id). `BUILTIN_ISO_EXTENSION` keeps its own id,
 * `holodeck.iso.builtin`, because hosts install it directly into registries
 * today (`createIsoRegistryWithBuiltins`, `getDefaultIsoRegistry`, host
 * products' own extension hosts) and track or remove it by that id. The
 * package extension carries the same contribution objects under the package
 * id. A registry holds one or the other: both together collide on part ids.
 */

import { HOLODECK_KINDS, defineHolodeckPackage, parseHolodeckPackageManifest, type HolodeckExtension } from '@holodeck/sdk';
import manifestJson from '../holodeck.package.json';
import { ISO_PARTS_INSTALLED_CHECK } from './engine/document-check';
import { BUILTIN_ISO_EXTENSION } from './registry/builtin';

/** `holodeck.package.json`, validated (a malformed manifest fails at import, and in tests). */
export const ISO_PACKAGE_MANIFEST = parseHolodeckPackageManifest(manifestJson);

/** The built-in parts, themes and animators as the `holodeck.iso` package's extension. */
export function createIsoPackageExtension(): HolodeckExtension {
  // Fresh arrays per call: a host mutating one install's lists cannot reach another's.
  const contributions: HolodeckExtension['contributions'] = {};
  for (const [kind, items] of Object.entries(BUILTIN_ISO_EXTENSION.contributions)) contributions[kind] = [...items];
  // Package-only (holodeck#61): BUILTIN_ISO_EXTENSION goes into plain iso
  // registries, which have no document-check kind; a HolodeckHost does.
  contributions[HOLODECK_KINDS.documentCheck] = [ISO_PARTS_INSTALLED_CHECK];
  return {
    id: ISO_PACKAGE_MANIFEST.id,
    version: ISO_PACKAGE_MANIFEST.version,
    label: ISO_PACKAGE_MANIFEST.name,
    description: BUILTIN_ISO_EXTENSION.description,
    contributions,
  };
}

export const isoPackage = defineHolodeckPackage({
  manifest: ISO_PACKAGE_MANIFEST,
  createExtension: () => createIsoPackageExtension(),
});

export default isoPackage;
