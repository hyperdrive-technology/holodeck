/**
 * The studio's `HolodeckHost` (contract: @holodeck/sdk docs/PACKAGING.md §4).
 *
 * Engines are registered, then packages are installed through their
 * manifests, exactly as a third-party host would: the studio has no private
 * path into the iso engine. Adding a library later is one more entry in
 * `STUDIO_PACKAGES`.
 *
 * The document checks live in `document-checks.ts` (pure, shared with the
 * Node MCP server) and are re-exported here.
 */

import type { HolodeckEngine, HolodeckHost } from '@holodeck/sdk';
import { ISO_ENGINE_ID, ISO_PACKAGE_MANIFEST, isoEngine, isoPackage } from '@holodeck/editor-2.5d-react';
import { createHost, type StudioPackage } from './document-checks';
import { PROVIDER_PACKAGES } from './provider-packages';
import { CLOUD_PACKAGE } from './cloud-package';
import { PROCESS_PACKAGE } from './process-package';

export * from './document-checks';

export const STUDIO_HOST_NAME = 'holodeck-studio';

export const STUDIO_ENGINES: readonly HolodeckEngine[] = [isoEngine as HolodeckEngine];
export const STUDIO_PACKAGES: readonly StudioPackage[] = [
  { manifest: ISO_PACKAGE_MANIFEST, module: isoPackage },
  CLOUD_PACKAGE,
  PROCESS_PACKAGE,
  ...PROVIDER_PACKAGES,
];

/** The engine new documents use. */
export const DEFAULT_ENGINE_ID = ISO_ENGINE_ID;

export async function createStudioHost(
  engines: readonly HolodeckEngine[] = STUDIO_ENGINES,
  packages: readonly StudioPackage[] = STUDIO_PACKAGES,
): Promise<HolodeckHost> {
  return createHost(STUDIO_HOST_NAME, engines, packages);
}
