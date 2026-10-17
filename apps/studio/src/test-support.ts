import type { DocumentChannel } from './documents/changes';

/** A document channel that drops everything (component tests do not need cross-tab notices). */
export const NO_CHANNEL: DocumentChannel = { post: () => undefined, subscribe: () => () => undefined };

import type { ContributionRegistry } from '@holodeck/sdk';
import { stampPlacement, type IsoSceneFile } from '@holodeck/editor-2.5d-react';

/** Test fixture: `scene` with part `partId` stamped at (x, y) the way the palette would. */
export function withPart(scene: IsoSceneFile, registry: ContributionRegistry, partId: string, x = 0, y = 0): { scene: IsoSceneFile; id: string } {
  const placement = stampPlacement(registry, partId, x, y, { objects: scene.objects });
  return { scene: { ...scene, objects: [...scene.objects, placement] }, id: placement.id };
}
