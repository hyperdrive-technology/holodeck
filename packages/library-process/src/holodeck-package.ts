import { defineHolodeckPackage, parseHolodeckPackageManifest, type HolodeckExtension, type HolodeckPackageContext } from '@holodeck/sdk';
import manifestJson from '../holodeck.package.json';
import { createProcessParts } from './parts';

export const PROCESS_PACKAGE_MANIFEST = parseHolodeckPackageManifest(manifestJson);

export function createProcessExtension(context: HolodeckPackageContext): HolodeckExtension {
  return {
    id: PROCESS_PACKAGE_MANIFEST.id,
    version: PROCESS_PACKAGE_MANIFEST.version,
    label: PROCESS_PACKAGE_MANIFEST.name,
    contributions: {
      'holodeck.iso.part': createProcessParts(context.assetUrl),
    },
  };
}

export const processPackage = defineHolodeckPackage({
  manifest: PROCESS_PACKAGE_MANIFEST,
  createExtension: createProcessExtension,
});

export default processPackage;
