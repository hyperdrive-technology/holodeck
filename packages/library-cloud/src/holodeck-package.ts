import { defineHolodeckPackage, parseHolodeckPackageManifest, type HolodeckExtension, type HolodeckPackageContext } from '@holodeck/sdk';
import manifestJson from '../holodeck.package.json';
import { createCloudParts } from './parts';
import { CLOUD_THEMES } from './themes';

export const CLOUD_PACKAGE_MANIFEST = parseHolodeckPackageManifest(manifestJson);

export function createCloudExtension(context: HolodeckPackageContext): HolodeckExtension {
  return {
    id: CLOUD_PACKAGE_MANIFEST.id,
    version: CLOUD_PACKAGE_MANIFEST.version,
    label: CLOUD_PACKAGE_MANIFEST.name,
    contributions: {
      'holodeck.iso.part': createCloudParts(context.assetUrl),
      'holodeck.iso.theme': structuredClone(CLOUD_THEMES),
    },
  };
}

export const cloudPackage = defineHolodeckPackage({
  manifest: CLOUD_PACKAGE_MANIFEST,
  createExtension: createCloudExtension,
});

export default cloudPackage;
