/**
 * Entry module of the `holodeck.http` Holodeck package (`holodeck.package.json`
 * at the package root; contract: @holodeck/sdk docs/PACKAGING.md §3).
 *
 *   await host.installPackage(HTTP_PACKAGE_MANIFEST, httpProviderPackage);
 *
 * Network permissions. The default package contacts whichever origin a
 * connection's `url` names, so its manifest cannot list origins up front and
 * declares no `permissions.network` (the SDK's pattern grammar has no "origin
 * chosen by the user" form). A host or deployment that wants a fixed allowlist
 * builds a restricted package instead:
 *
 *   const pkg = createHttpProviderPackage({ origins: ['https://*.example.com', 'wss://feed.example.com'] });
 *   await host.installPackage(pkg.manifest, pkg);
 *
 * Its manifest declares exactly those origins in `permissions.network` (so the
 * host can show them before install), and its provider refuses to connect
 * anywhere else. Installing the restricted module with the default manifest
 * fails with MANIFEST_MISMATCH, because its provider's `origins` are not
 * covered: the SDK keeps manifest and provider honest.
 */

import {
  defineHolodeckPackage,
  HOLODECK_KINDS,
  parseHolodeckPackageManifest,
  type HolodeckExtension,
  type HolodeckPackageManifest,
  type HolodeckPackageModule,
} from '@holodeck/sdk';
import manifestJson from '../holodeck.package.json';
import { createHttpProvider, type HttpProviderOptions } from './provider';

/** `holodeck.package.json`, validated (a malformed manifest fails at import, and in tests). */
export const HTTP_PACKAGE_MANIFEST: HolodeckPackageManifest = parseHolodeckPackageManifest(manifestJson);

/** The package's extension: a fresh provider per call. */
export function createHttpProviderExtension(options: HttpProviderOptions = {}): HolodeckExtension {
  return {
    id: HTTP_PACKAGE_MANIFEST.id,
    version: HTTP_PACKAGE_MANIFEST.version,
    label: HTTP_PACKAGE_MANIFEST.name,
    description: HTTP_PACKAGE_MANIFEST.description,
    contributions: {
      [HOLODECK_KINDS.provider]: [createHttpProvider(options)],
    },
  };
}

export type HttpProviderPackage = HolodeckPackageModule & { manifest: HolodeckPackageManifest };

/**
 * A package module whose provider uses `options`. With `origins`, the
 * returned `manifest` is a copy of the default one with
 * `permissions.network` set to those origins; install with that manifest.
 * Options are copied and checked now (bad origin patterns throw here).
 */
export function createHttpProviderPackage(options: HttpProviderOptions = {}): HttpProviderPackage {
  const snapshot: HttpProviderOptions = Object.freeze({ ...options, origins: options.origins ? [...options.origins] : undefined });
  createHttpProvider(snapshot); // throws now for bad options, not at install time
  const manifest: HolodeckPackageManifest = snapshot.origins
    ? parseHolodeckPackageManifest({ ...structuredClone(HTTP_PACKAGE_MANIFEST), permissions: { network: [...snapshot.origins] } })
    : HTTP_PACKAGE_MANIFEST;
  return defineHolodeckPackage({
    manifest,
    createExtension: () => createHttpProviderExtension(snapshot),
  }) as HttpProviderPackage;
}

export const httpProviderPackage = createHttpProviderPackage();

export default httpProviderPackage;
