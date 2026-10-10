/**
 * Contribution kinds the 2.5D editor registers (contract:
 * core/docs/EXTENSIONS_AND_LIBRARIES.md section 4). Pure types: no runtime
 * imports, so any module can depend on them without a cycle.
 */

import type { ComponentType, ReactNode } from 'react';
import type { Object3D } from 'three';
import type { Contribution } from '@holodeck/sdk';
import type { HolodeckStyle } from '../../assets/process/style';
import type { FittingParams } from '../../assets/process/fitting-params';
import type { TankParams } from '../../assets/process/tank-params';
import type { IsoPlacement } from '../iso/scene';

export interface IsoPartParamSpec {
  type: 'number' | 'boolean' | 'string' | 'enum';
  label: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** `type: 'enum'` choices. */
  options?: string[];
  /** Real param (scene files and hosts may set it) but no inspector control, e.g. object-valued params. */
  hidden?: boolean;
}

/** Editor-wide tuning knobs the tuner page passes through; absent in normal use. */
export interface IsoPartTuning {
  tankParams?: Partial<TankParams>;
  fittings?: Partial<FittingParams>;
  /** Grid cells that have a 90 degree elbow, so unique-mesh pipes trim like the pooled ones. */
  bendKeys?: ReadonlySet<string>;
}

export interface IsoPartProps {
  placement: IsoPlacement;
  /** `resolveParams(def, placement, metrics)`: metrics over placement.params over spec defaults. */
  params: Record<string, unknown>;
  style: HolodeckStyle;
  selected: boolean;
  /** The definition being rendered (GlbPart reads `model` / `animNodes` from it). */
  def: IsoPartDefinition;
  tuning?: IsoPartTuning;
}

/** Props the pooled (`instanced`) renderer receives for all placements of one part. */
export interface IsoInstancedRendererProps {
  items: IsoPlacement[];
  /** Every placement in the scene (pipes read neighbouring elbows to trim). */
  all: readonly IsoPlacement[];
  onObjectPointerDown?: (id: string, event: import('@react-three/fiber').ThreeEvent<PointerEvent>) => void;
}

export interface IsoPartDefinition extends Contribution {
  /** Unique part id, e.g. `tank` or `brewery:fermenter`. Stored in `placement.object`. */
  id: string;
  label: string;
  hint?: string;
  /** Palette group heading. */
  category?: string;
  /** Placeable from a scene file but not offered in the palette. */
  hideInPalette?: boolean;
  /** Grid cells; rotation is handled by the editor. */
  footprint: { w: number; h: number };
  /** Grid-relative pipe attach points. */
  ports?: Record<string, { x: number; y: number; dir: 'n' | 'e' | 's' | 'w' }>;
  /** The animatable / inspectable surface (level, rpm, open, running, temp...). */
  params: Record<string, IsoPartParamSpec>;
  /** What the palette stamps onto a new placement (height, band, width...). */
  defaults?: Partial<IsoPlacement>;
  /**
   * Pooled InstancedMesh part. Placements go to `instancedRenderer` as one
   * batch instead of getting a React subtree each.
   */
  instanced?: boolean;
  /** Pool renderer for `instanced` parts. Looked up by part id, not by a hard-coded switch. */
  instancedRenderer?: ComponentType<IsoInstancedRendererProps>;
  /** Per-placement escape hatch: false keeps that placement as a unique mesh. */
  instancedWhen?: (placement: IsoPlacement) => boolean;
  /** `'run'`: palette click-click draws a manhattan run of `pipe` + `elbow` (see routing.ts). */
  draw?: 'run';
  component: ComponentType<IsoPartProps>;
  /** Optional GLB url (`HolodeckModel` path); `GlbPart` renders it. */
  model?: string;
  /**
   * Uniform scale applied to the GLB about its base origin (default 1). Keep
   * `footprint` consistent with the scaled size: routing uses the footprint.
   */
  scale?: number;
  /** param -> `anim.*` node in the GLB + the animator that drives it. `placement.animation` overrides. */
  animNodes?: Record<string, { node: string; animator: string }>;
}

export interface IsoTheme extends Contribution {
  id: string;
  label: string;
  style: HolodeckStyle;
}

export interface IsoAnimatorContext {
  node: Object3D;
  value: unknown;
  /** Seconds since the previous frame. */
  dt: number;
  /** Seconds since the animator hook mounted. */
  elapsed: number;
  /** Animator `settings` defaults merged with `placement.animation[param].settings`. */
  settings: Record<string, unknown>;
}

export interface IsoAnimator extends Contribution {
  /** `spin`, `fill`, `pulse`, ... */
  id: string;
  label: string;
  /**
   * Default param this animator is driven by. A part's `animNodes` entry (or
   * `placement.animation`) may bind it to a different param.
   */
  param: string;
  /** Called every frame for each matching anim node. */
  apply(ctx: IsoAnimatorContext): void;
  /** Tunable settings; each spec's `default` is the default setting value. */
  settings?: Record<string, IsoPartParamSpec>;
}

export interface IsoInspectorPanelProps {
  placement: IsoPlacement;
  onChange(patch: Partial<IsoPlacement>): void;
}

export interface IsoInspectorPanel extends Contribution {
  id: string;
  label: string;
  component: ComponentType<IsoInspectorPanelProps>;
}

/** Inspector slot on `ProcessEditor`: fixed node or a function of the selected placement. */
export type IsoInspectorSlot = ReactNode | ((placement: IsoPlacement) => ReactNode);

/** placementId -> param -> live value. Overrides `placement.params`. */
export type IsoMetrics = Record<string, Record<string, unknown>>;
