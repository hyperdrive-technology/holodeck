/** Vite emits the installed cloud package assets with hashed URLs in dev and production. */
import { cloudPackage, CLOUD_PACKAGE_MANIFEST } from '@holodeck/library-cloud/holodeck-package';
import type { StudioPackage } from './studio-host';
import asset0 from '@holodeck/library-cloud/assets/logos/cloud.svg?url';
import asset1 from '@holodeck/library-cloud/assets/models/billboard.glb?url';
import asset2 from '@holodeck/library-cloud/assets/models/broker.glb?url';
import asset3 from '@holodeck/library-cloud/assets/models/bucket.glb?url';
import asset4 from '@holodeck/library-cloud/assets/models/cache.glb?url';
import asset5 from '@holodeck/library-cloud/assets/models/cdn.glb?url';
import asset6 from '@holodeck/library-cloud/assets/models/container.glb?url';
import asset7 from '@holodeck/library-cloud/assets/models/database.glb?url';
import asset8 from '@holodeck/library-cloud/assets/models/disk.glb?url';
import asset9 from '@holodeck/library-cloud/assets/models/firewall.glb?url';
import asset10 from '@holodeck/library-cloud/assets/models/function.glb?url';
import asset11 from '@holodeck/library-cloud/assets/models/gateway.glb?url';
import asset12 from '@holodeck/library-cloud/assets/models/generic-block.glb?url';
import asset13 from '@holodeck/library-cloud/assets/models/generic-cube.glb?url';
import asset14 from '@holodeck/library-cloud/assets/models/generic-flat.glb?url';
import asset15 from '@holodeck/library-cloud/assets/models/identity.glb?url';
import asset16 from '@holodeck/library-cloud/assets/models/load-balancer.glb?url';
import asset17 from '@holodeck/library-cloud/assets/models/mobile.glb?url';
import asset18 from '@holodeck/library-cloud/assets/models/monitoring.glb?url';
import asset19 from '@holodeck/library-cloud/assets/models/pc.glb?url';
import asset20 from '@holodeck/library-cloud/assets/models/queue.glb?url';
import asset21 from '@holodeck/library-cloud/assets/models/registry.glb?url';
import asset22 from '@holodeck/library-cloud/assets/models/server.glb?url';
import asset23 from '@holodeck/library-cloud/assets/models/stream.glb?url';
import asset24 from '@holodeck/library-cloud/assets/models/user.glb?url';
import asset25 from '@holodeck/library-cloud/assets/models/vault.glb?url';
import asset26 from '@holodeck/library-cloud/assets/models/warehouse.glb?url';

const assets: Record<string, string> = {
  'logos/cloud.svg': asset0,
  'models/billboard.glb': asset1,
  'models/broker.glb': asset2,
  'models/bucket.glb': asset3,
  'models/cache.glb': asset4,
  'models/cdn.glb': asset5,
  'models/container.glb': asset6,
  'models/database.glb': asset7,
  'models/disk.glb': asset8,
  'models/firewall.glb': asset9,
  'models/function.glb': asset10,
  'models/gateway.glb': asset11,
  'models/generic-block.glb': asset12,
  'models/generic-cube.glb': asset13,
  'models/generic-flat.glb': asset14,
  'models/identity.glb': asset15,
  'models/load-balancer.glb': asset16,
  'models/mobile.glb': asset17,
  'models/monitoring.glb': asset18,
  'models/pc.glb': asset19,
  'models/queue.glb': asset20,
  'models/registry.glb': asset21,
  'models/server.glb': asset22,
  'models/stream.glb': asset23,
  'models/user.glb': asset24,
  'models/vault.glb': asset25,
  'models/warehouse.glb': asset26,
};

/** Keep package installation through the manifest; only asset resolution is bundler-specific. */
export const CLOUD_PACKAGE: StudioPackage = {
  manifest: CLOUD_PACKAGE_MANIFEST,
  module: {
    ...cloudPackage,
    createExtension: (context) => cloudPackage.createExtension({
      ...context,
      assetUrl: (path) => {
        const url = assets[path];
        if (!url) throw new Error(`Unknown cloud asset: ${path}`);
        return url;
      },
    }),
  },
};
