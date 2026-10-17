/**
 * Entry module of the `holodeck.provider-aws` Holodeck package
 * (`holodeck.package.json` at the package root; contract: @holodeck/sdk
 * docs/PACKAGING.md §3).
 *
 *   await host.installPackage(AWS_PACKAGE_MANIFEST, awsProviderPackage);
 *
 * The manifest's `permissions.network` lists every AWS origin the provider
 * contacts (CloudWatch, Tagging, STS, Cognito Identity); the provider declares
 * the same `origins` and refuses any other origin at request time.
 *
 * Hosts that supply credentials themselves (`credentials.type: "host"`) or
 * A2's part map build their own module:
 *
 *   const pkg = createAwsProviderPackage({ credentials: async () => broker.awsCredentials(), partHints: AWS_PART_HINTS });
 *   await host.installPackage(pkg.manifest, pkg);
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
import { createAwsProvider, type AwsProviderOptions } from './provider';

/** `holodeck.package.json`, validated (a malformed manifest fails at import, and in tests). */
export const AWS_PACKAGE_MANIFEST: HolodeckPackageManifest = parseHolodeckPackageManifest(manifestJson);

/** The package's extension: a fresh provider per call. */
export function createAwsProviderExtension(options: AwsProviderOptions = {}): HolodeckExtension {
  return {
    id: AWS_PACKAGE_MANIFEST.id,
    version: AWS_PACKAGE_MANIFEST.version,
    label: AWS_PACKAGE_MANIFEST.name,
    description: AWS_PACKAGE_MANIFEST.description,
    contributions: {
      [HOLODECK_KINDS.provider]: [createAwsProvider(options)],
    },
  };
}

export type AwsProviderPackage = HolodeckPackageModule & { manifest: HolodeckPackageManifest };

/** A package module whose provider uses `options` (copied now). Install with `pkg.manifest`. */
export function createAwsProviderPackage(options: AwsProviderOptions = {}): AwsProviderPackage {
  const snapshot: AwsProviderOptions = Object.freeze({ ...options });
  return defineHolodeckPackage({
    manifest: AWS_PACKAGE_MANIFEST,
    createExtension: () => createAwsProviderExtension(snapshot),
  }) as AwsProviderPackage;
}

export const awsProviderPackage = createAwsProviderPackage();

export default awsProviderPackage;
