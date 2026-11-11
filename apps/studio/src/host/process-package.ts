/**
 * `@holodeck/library-process` for the studio. As with the cloud package, Vite
 * emits each GLB with a hashed URL (`?url`), and the package is installed
 * through its manifest; only asset resolution is bundler-specific.
 *
 * One import per model, listed explicitly so every toolchain sees the assets
 * (no `import.meta.glob` on a package path). `process-package.test.ts` fails
 * when this map and the package's models disagree, so a new part from the
 * next Blender batch must be added here too.
 */
import { processPackage, PROCESS_PACKAGE_MANIFEST } from '@holodeck/library-process/holodeck-package';
import type { StudioPackage } from './document-checks';
import cabinet from '@holodeck/library-process/assets/models/cabinet.glb?url';
import heatExchangerShellTube from '@holodeck/library-process/assets/models/heat-exchanger-shell-tube.glb?url';
import motor from '@holodeck/library-process/assets/models/motor.glb?url';
import transmitter from '@holodeck/library-process/assets/models/transmitter.glb?url';
import valveBall from '@holodeck/library-process/assets/models/valve-ball.glb?url';
import valveControl from '@holodeck/library-process/assets/models/valve-control.glb?url';

/** Asset-relative path (as in the package's parts.json) -> bundled URL. */
export const PROCESS_ASSET_URLS: Readonly<Record<string, string>> = Object.freeze({
  'models/cabinet.glb': cabinet,
  'models/heat-exchanger-shell-tube.glb': heatExchangerShellTube,
  'models/motor.glb': motor,
  'models/transmitter.glb': transmitter,
  'models/valve-ball.glb': valveBall,
  'models/valve-control.glb': valveControl,
});

/** The bundled URL of a package asset; throws for anything not bundled (a typo, `toString`). */
export function processAssetUrl(path: string): string {
  const url = Object.prototype.hasOwnProperty.call(PROCESS_ASSET_URLS, path) ? PROCESS_ASSET_URLS[path] : undefined;
  if (!url) throw new Error(`Unknown process asset: ${path}`);
  return url;
}

/** Keep package installation through the manifest; only asset resolution is bundler-specific. */
export const PROCESS_PACKAGE: StudioPackage = {
  manifest: PROCESS_PACKAGE_MANIFEST,
  module: {
    ...processPackage,
    createExtension: (context) => processPackage.createExtension({ ...context, assetUrl: processAssetUrl }),
  },
};
