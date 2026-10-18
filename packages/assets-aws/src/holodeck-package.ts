import { defineHolodeckPackage, parseHolodeckPackageManifest, type HolodeckExtension, type HolodeckPackageContext } from '@holodeck/sdk';
import manifestJson from '../holodeck.package.json';
import { createAwsParts } from './parts';

export const AWS_PACKAGE_MANIFEST = parseHolodeckPackageManifest(manifestJson);

export function createAwsExtension(context: HolodeckPackageContext): HolodeckExtension {
  return {
    id: AWS_PACKAGE_MANIFEST.id,
    version: AWS_PACKAGE_MANIFEST.version,
    label: AWS_PACKAGE_MANIFEST.name,
    contributions: { 'holodeck.iso.part': createAwsParts(context.assetUrl) },
  };
}

export const awsPackage = defineHolodeckPackage({
  manifest: AWS_PACKAGE_MANIFEST,
  createExtension: createAwsExtension,
});

export default awsPackage;
