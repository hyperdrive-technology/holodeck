/**
 * Types for the editor's dependency-light `./contracts` entry, as the tests
 * here use it. Vitest aliases the module to the real source
 * (vitest.config.ts), but `tsc` must not follow that alias: the editor's
 * source types reach React and R3F, which this package does not install. So
 * the subset the tests touch is declared here; the editor's
 * `contracts.test.ts` pins the entry's export names, and a signature drift
 * shows up as a failing test run here rather than a type error.
 *
 * Test-only: not under `dist/`, not published.
 */
declare module '@holodeck/editor-2.5d-react/contracts' {
  import type { ContributionKind } from '@holodeck/sdk';
  import type { Object3D } from 'three';

  export interface IsoPartParamSpec {
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

  export interface IsoAnimatorContext {
    node: Object3D;
    value: unknown;
    dt: number;
    elapsed: number;
    settings: Record<string, unknown>;
    params?: Readonly<Record<string, unknown>>;
  }

  export interface IsoAnimator {
    id: string;
    label: string;
    param: string;
    apply(ctx: IsoAnimatorContext): void;
    settings?: Record<string, IsoPartParamSpec>;
  }

  export interface AnimationBinding {
    param: string;
    nodeName: string;
    animator: IsoAnimator;
    settings: Record<string, unknown>;
  }

  export type IsoPartOrigin = 'floor' | 'pipe-axis';

  export const ISO_KINDS: readonly ContributionKind[];
  export const ISO_PART_ORIGINS: readonly IsoPartOrigin[];
  export const BUILTIN_ISO_ANIMATORS: readonly IsoAnimator[];
  export function isIsoPartDefinition(item: unknown): boolean;
  export function isParamSpec(item: unknown): item is IsoPartParamSpec;
  export function fractionOf(value: unknown, scale: unknown): number;
  export function planAnimations(
    def: { animNodes?: Record<string, { node: string; animator: string; settings?: Record<string, unknown> }> },
    animation: Record<string, { animator: string; settings?: Record<string, unknown> }> | undefined,
    getAnimator: (id: string) => IsoAnimator | undefined,
  ): AnimationBinding[];
  export function applyAnimations(
    bindings: readonly AnimationBinding[],
    nodes: Record<string, Object3D>,
    params: Record<string, unknown>,
    dt: number,
    elapsed: number,
  ): void;
}
