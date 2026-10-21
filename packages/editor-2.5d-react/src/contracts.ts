/**
 * Stable, dependency-light entry: `@holodeck/editor-2.5d-react/contracts`.
 *
 * The pure `holodeck.iso` contribution contracts (kind descriptors and their
 * validators) plus the default style tokens, for code that checks parts or
 * themes without rendering anything: library packages' tests (library-cloud,
 * assets-aws), CLIs, marketplace indexers.
 *
 * Rules for this file (enforced by contracts.test.ts):
 * - Runtime imports reach `@holodeck/sdk` only: no React, three or R3F, so a
 *   consumer needs neither installed nor a DOM. (The exported TYPES mention
 *   React/three types, e.g. a part's optional `component`; TypeScript
 *   consumers without @types/react see those fields as `any` under
 *   skipLibCheck. Nothing is loaded at runtime.)
 * - The names below are a public contract. Move the implementation freely,
 *   but keep re-exporting it from here; sibling packages import this entry by
 *   name (their vitest configs alias it to this file) instead of reaching into
 *   `src/registry/` or `assets/process/` by relative path (holodeck#137).
 */

export {
  ISO_ANIMATOR_KIND,
  ISO_INSPECTOR_KIND,
  ISO_KINDS,
  ISO_PART_KIND,
  ISO_THEME_KIND,
  isIsoAnimator,
  isIsoInspectorPanel,
  isIsoPartDefinition,
  isIsoTheme,
  isParamSpec,
} from './registry/kinds';
export type { IsoAnimator, IsoInspectorPanel, IsoPartDefinition, IsoPartParamSpec, IsoTheme } from './registry/types';
export { HOLODECK_STYLE, type HolodeckStyle } from '../assets/process/style';
