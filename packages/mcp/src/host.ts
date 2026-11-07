/**
 * The server's `HolodeckHost`: the same engine and packages as the studio
 * (`apps/studio/src/host/studio-host.ts`), installed through their manifests.
 *
 * Only asset resolution differs. The studio hands the cloud package Vite
 * asset URLs. This server never loads a model or logo (it validates and edits
 * documents; rendering happens in a browser that has its own URLs), so an
 * asset is its package-relative path (`assets/models/server.glb`). Not a
 * `file:` URL: part validation (`assetUrlProblem`) only accepts http(s),
 * blob:, data:image or relative URLs, and refuses the whole package otherwise.
 */

import type { HolodeckEngine, HolodeckHost } from '@holodeck/sdk';
import { ISO_PACKAGE_MANIFEST, isoEngine, isoPackage } from '@holodeck/editor-2.5d-react';
import { cloudPackage, CLOUD_PACKAGE_MANIFEST } from '@holodeck/library-cloud/holodeck-package';
import { createHost, PROVIDER_PACKAGES, type StudioPackage } from './studio';

export const MCP_HOST_NAME = 'holodeck-mcp';

/** `@holodeck/library-cloud` with package-relative asset paths. */
export function nodeCloudPackage(): StudioPackage {
  return {
    manifest: CLOUD_PACKAGE_MANIFEST,
    module: {
      ...cloudPackage,
      createExtension: (context) =>
        cloudPackage.createExtension({
          ...context,
          assetUrl: (path) => {
            // Manifest-relative, like the SDK's resolvePackageAsset: no absolute paths or `..`.
            if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Unsafe cloud asset path: ${path}`);
            return `assets/${path}`;
          },
        }),
    },
  };
}

export const MCP_ENGINES: readonly HolodeckEngine[] = [isoEngine as HolodeckEngine];

export function mcpPackages(): StudioPackage[] {
  return [{ manifest: ISO_PACKAGE_MANIFEST, module: isoPackage }, nodeCloudPackage(), ...PROVIDER_PACKAGES];
}

/** A host with every package the studio installs. */
export function createMcpHost(): Promise<HolodeckHost> {
  return createHost(MCP_HOST_NAME, MCP_ENGINES, mcpPackages());
}
