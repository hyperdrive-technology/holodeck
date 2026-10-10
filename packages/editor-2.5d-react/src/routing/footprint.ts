import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPartDefinition } from '../registry/types';

/**
 * Grid footprint of a part, from its registry definition. Unknown parts get
 * 1x1 so a scene that names an uninstalled part can still be selected and deleted.
 */
export function footprint(registry: ContributionRegistry, partId: string): { w: number; h: number } {
  return registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId)?.footprint ?? { w: 1, h: 1 };
}
