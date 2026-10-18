import type { HolodeckPackageContext } from '@holodeck/sdk';
import categoriesJson from './categories.json';
import servicesJson from './services.json';

/** One row of `services.json`: the single source of truth for the catalogue. */
export interface AwsServiceEntry {
  /** Part id is `aws:<slug>`; also the icon file name. */
  slug: string;
  label: string;
  /** Official icon name: `Arch_<icon>_64.svg` in the AWS Architecture Icons package. */
  icon: string;
  /** Key into `categories.json`. */
  category: string;
  /** `holodeck.cloud` archetype whose model this service reuses (`models/<archetype>.glb`). */
  archetype: string;
  /** CloudWatch namespace for the service's metrics, or null when it publishes none worth binding. */
  cloudwatchNamespace: string | null;
  hint: string;
}

export const AWS_SERVICES: readonly AwsServiceEntry[] = servicesJson as AwsServiceEntry[];
export const AWS_CATEGORIES: Readonly<Record<string, { label: string; color: string }>> = categoriesJson;

/** The data-only subset of the E2 `IsoPartDefinition`, identical in shape to library-cloud's. */
export interface AwsPartDefinition {
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

export const awsPartId = (slug: string): string => `aws:${slug}`;

/** Definitions with package-relative paths, until installation. */
export const AWS_PART_DEFINITIONS: readonly AwsPartDefinition[] = AWS_SERVICES.map((service) => ({
  id: awsPartId(service.slug),
  label: service.label,
  category: AWS_CATEGORIES[service.category]!.label,
  hint: service.hint,
  footprint: { w: 2, h: 2 },
  params: {},
  model: `models/${service.archetype}.glb`,
  logo: { url: `aws-icons/${service.slug}.svg` },
  // AWS category colour on the accent; body/edge stay theme-controlled.
  colors: { accent: AWS_CATEGORIES[service.category]!.color },
  floor: false,
  instanced: false as const,
}));

/** Resolve every asset through the host and isolate mutable data per installation. */
export function createAwsParts(assetUrl: HolodeckPackageContext['assetUrl']): AwsPartDefinition[] {
  return AWS_PART_DEFINITIONS.map((definition) => {
    const part = structuredClone(definition);
    part.model = assetUrl(part.model);
    part.logo.url = assetUrl(part.logo.url);
    return part;
  });
}

/**
 * CloudWatch namespace → part id, for discovery and the metric picker (P1).
 * Services with no namespace are omitted. When two services share a namespace
 * (ECS/Fargate, RDS/Aurora) the first row in `services.json` wins.
 */
export const CLOUDWATCH_NAMESPACE_PARTS: Readonly<Record<string, string>> = (() => {
  const map: Record<string, string> = {};
  for (const service of AWS_SERVICES) {
    if (service.cloudwatchNamespace !== null && !(service.cloudwatchNamespace in map)) {
      map[service.cloudwatchNamespace] = awsPartId(service.slug);
    }
  }
  return Object.freeze(map);
})();
