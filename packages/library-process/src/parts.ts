import type { HolodeckPackageContext } from '@holodeck/sdk';
import definitions from './parts.json';

/** A param spec, as `IsoPartParamSpec` in the 2.5D editor. */
export interface ProcessParamSpec {
  type: 'number' | 'boolean' | 'string' | 'enum' | 'color';
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  reading?: boolean;
}

/**
 * The data-only subset of E2's `IsoPartDefinition` these parts use (no React
 * component: E2 renders them with `DataPart`, which loads the GLB, applies the
 * theme and runs the animators). Kept structural so this package depends on
 * the SDK only; the tests check every definition with the editor's
 * `isIsoPartDefinition`.
 */
export interface ProcessPartDefinition {
  id: string;
  label: string;
  category: string;
  hint: string;
  footprint: { w: number; h: number };
  params: Record<string, ProcessParamSpec>;
  /** Asset-relative until installation, then a resolved URL. */
  model: string;
  /** `'pipe-axis'` for inline parts: the model's origin is on the pipe axis. */
  origin?: 'floor' | 'pipe-axis';
  /** Along-pipe body length of inline parts (routing clearance). */
  inlineLength?: number;
  /** Grid ports a pipe can snap to: offsets from the part centre (cells) + outward direction. */
  ports?: Record<string, { x: number; y: number; dir: 'n' | 'e' | 's' | 'w' }>;
  /** param -> `anim.*` node + animator + part-level animator settings. */
  animNodes?: Record<string, { node: string; animator: string; settings?: Record<string, unknown> }>;
  /** Boolean param that tints `hd.accent` with the theme's alarm colour. */
  alarmParam?: string;
  /** Never a routing obstacle (small mounted instruments). */
  floor?: boolean;
  instanced: false;
}

/** Paths are relative to the manifest's assets directory, until installation. */
export const PROCESS_PART_DEFINITIONS: readonly ProcessPartDefinition[] = definitions as unknown as ProcessPartDefinition[]; // shape checked by parts.test.ts

/** Resolve every asset through the host and isolate mutable data per installation. */
export function createProcessParts(assetUrl: HolodeckPackageContext['assetUrl']): ProcessPartDefinition[] {
  return PROCESS_PART_DEFINITIONS.map((definition) => {
    const part = structuredClone(definition);
    part.model = assetUrl(part.model);
    return part;
  });
}
