/**
 * Provider packages the studio installs: the SDK's simulated signals
 * (`holodeck.sim`, demo data and the reference provider), the generic
 * HTTP / JSON provider (`holodeck.http`) and AWS CloudWatch
 * (`aws.cloudwatch`). All go through `HolodeckHost.installPackage`, like any
 * other package.
 */

import { createSimProvider, defineHolodeckPackage, HOLODECK_KINDS, parseHolodeckPackageManifest, SIM_PROVIDER_ID } from '@holodeck/sdk';
import { HTTP_PACKAGE_MANIFEST, httpProviderPackage } from '@holodeck/provider-http';
import { AWS_PACKAGE_MANIFEST, awsProviderPackage } from '@holodeck/provider-aws';
import type { StudioPackage } from './studio-host';

/**
 * The SDK ships `createSimProvider` but no package for it; the studio wraps
 * it in one so it installs (and can be listed / removed) like the others.
 * `entry` is nominal: the module is passed in directly.
 */
export const SIM_PACKAGE_MANIFEST = parseHolodeckPackageManifest({
  schemaVersion: 'holodeck.package.v1',
  id: SIM_PROVIDER_ID,
  name: 'Simulated signals',
  description: 'Deterministic simulated signals (sine, ramp, square, noise, const, writable mem) for demos and tests.',
  version: '1.0.0',
  license: 'MIT',
  contributes: [HOLODECK_KINDS.provider],
  providers: [SIM_PROVIDER_ID],
  entry: 'sim-package.js',
});

export const simPackage = defineHolodeckPackage({
  manifest: SIM_PACKAGE_MANIFEST,
  createExtension: () => ({
    id: SIM_PACKAGE_MANIFEST.id,
    version: SIM_PACKAGE_MANIFEST.version,
    label: SIM_PACKAGE_MANIFEST.name,
    contributions: { [HOLODECK_KINDS.provider]: [createSimProvider()] },
  }),
});

export const PROVIDER_PACKAGES: readonly StudioPackage[] = [
  { manifest: SIM_PACKAGE_MANIFEST, module: simPackage },
  { manifest: HTTP_PACKAGE_MANIFEST, module: httpProviderPackage },
  { manifest: AWS_PACKAGE_MANIFEST, module: awsProviderPackage },
];
