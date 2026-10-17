import type { HolodeckPackageContext } from '@holodeck/sdk';
import definitions from './parts.json';

/** The data-only subset of E2's IsoPartDefinition; no React dependency. */
export interface CloudPartDefinition {
  id: string;
  label: string;
  category: string;
  hint: string;
  footprint: { w: number; h: number };
  params: Record<string, never>;
  model: string;
  logo: { url: string; size?: number };
  colors: { body?: string; accent?: string; edge?: string };
  floor: boolean;
  instanced: false;
}

/** Paths are relative to the manifest's assets directory, until installation. */
export const CLOUD_PART_DEFINITIONS: readonly CloudPartDefinition[] = definitions as CloudPartDefinition[];

/** Resolve every asset through the host and isolate mutable data per installation. */
export function createCloudParts(assetUrl: HolodeckPackageContext['assetUrl']): CloudPartDefinition[] {
  return CLOUD_PART_DEFINITIONS.map((definition) => {
    const part = structuredClone(definition);
    part.model = assetUrl(part.model);
    part.logo.url = assetUrl(part.logo.url);
    return part;
  });
}
