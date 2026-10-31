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
import type { PipeRunSpec } from '../iso/pipe-runs';
import type { ConnectorPath } from '../objects/connector';

export interface IsoPartParamSpec {
  /**
   * `color`: a `#rgb` / `#rrggbb` / `#rrggbbaa` hex string, or `''` for "the
   * theme's colour". Validated by `paramValueProblem` (src/objects/validate.ts).
   */
  type: 'number' | 'boolean' | 'string' | 'enum' | 'color';
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
  /** `type: 'string'`: longest accepted value (default `MAX_PARAM_STRING`, 4096). */
  maxLength?: number;
  /**
   * A live reading (label `value`): besides a number of this spec, scene files
   * and hosts may store a boolean (ON/OFF readings, `format: 'onoff'`) or a
   * string (enum names, text states). Numbers are still checked against
   * min/max; strings against `maxLength`.
   */
  reading?: boolean;
  /** `type: 'string'`: `url` = an asset URL (http(s), blob:, data:image or relative; see `assetUrlProblem`). */
  format?: 'url';
}

/**
 * Brand logo drawn on a data-only part (`IsoPartDefinition.logo`).
 *
 * Placement contract (shared with the Blender archetypes, lane A1): when the
 * GLB has a node named `logo` (an empty), the logo plane sits on that node,
 * facing up (+Y), sized by the empty's X/Z scale unless `size` is set. Without
 * one, the plane sits on the model's top face (bounding-box top + a hair),
 * centred, `size` world units across (default 60% of the footprint's short side).
 */
export interface IsoPartLogo {
  /** Image URL (SVG, PNG, data: URL). Loaded with the browser's image decoder. */
  url: string;
  /** Edge length in world units (the plane is square; the image is letterboxed). */
  size?: number;
}

/**
 * Per-part colours for data-only parts. Each beats the active theme for this
 * part only; absent = the theme (`HolodeckStyle`) value. Hex strings.
 */
export interface IsoPartColors {
  /** `hd.white` finish (unlit body). */
  body?: string;
  /** `hd.accent` finish (brand stripe / handwheel). A placement's `color` beats it. */
  accent?: string;
  /** Outline colour. */
  edge?: string;
}

/** Editor-wide tuning knobs the tuner page passes through; absent in normal use. */
export interface IsoPartTuning {
  tankParams?: Partial<TankParams>;
  fittings?: Partial<FittingParams>;
  /** Grid cells that have a 90 degree elbow, so unique-mesh pipes trim like the pooled ones. */
  bendKeys?: ReadonlySet<string>;
  /**
   * Resolved pipe runs (bend + vessel-window clipping, src/iso/pipe-runs.ts),
   * computed once in SceneGraph so unique-mesh pipes match the pooled ones.
   */
  pipeRuns?: ReadonlyMap<string, PipeRunSpec>;
  /** Resolved connector polylines by placement id (objects/connector.ts), computed once in SceneGraph. */
  connectorPaths?: ReadonlyMap<string, ConnectorPath>;
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
  /** Resolved pipe runs by id (SceneGraph); absent = the renderer trims from `all` itself. */
  pipeRuns?: ReadonlyMap<string, PipeRunSpec>;
  onObjectPointerDown?: (id: string, event: import('@react-three/fiber').ThreeEvent<PointerEvent>) => void;
}

/** A pipe attach point: part-local offset from the centre (cells) and outward direction. */
export interface IsoPartPort {
  x: number;
  y: number;
  dir: 'n' | 'e' | 's' | 'w';
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
  /**
   * Per-placement footprint for parts whose size is a param (a vessel's
   * `radius`). The editor's halo / resize handles read it through
   * `placementFootprint()`; `footprint` stays the default-size fallback.
   * TODO(routing): src/routing/occupancy.ts still reads `def.footprint`
   * only, so a resized vessel blocks its default footprint until routing
   * adopts `placementFootprint` (owned by the routing work stream).
   */
  footprintOf?: (placement: IsoPlacement) => { w: number; h: number };
  /**
   * On-canvas resize handles (edit mode). Names the number params the
   * handles drag: `radius` (side handle, world units from the centre) and
   * `height` (top handle, world units from the floor). Both must be declared
   * in `params` with min/max/step so the drag can clamp and snap.
   */
  resize?: {
    radius?: string;
    height?: string;
    /** World Y of the top handle for a placement (default: the height param + 0.4). */
    topY?: (placement: IsoPlacement) => number;
  };
  /**
   * Grid-relative pipe attach points. Ports inside the vessel's cutout are
   * valid: a pipe there is drawn clipped at the wall with a cut-section end
   * (see `cutout` and routing/vessel-ports.ts).
   */
  ports?: Record<string, IsoPartPort>;
  /**
   * Per-placement ports for parts whose size is a param (the built-in `tank`'s
   * radius / preset): read through `placementPorts()` everywhere, so the
   * ports sit on the same silhouette as `footprintOf`. Absent = `ports`.
   */
  portsOf?: (placement: IsoPlacement) => Record<string, IsoPartPort>;
  /**
   * Along-pipe body length (grid cells) when the part sits inline on a pipe,
   * measured along its local x axis. Reroute keeps carried parts this far
   * apart (plus a margin) and clear of bends and retained endpoint parts
   * (routing/inline.ts `inlineBodyLength`). Absent = the footprint's longer side.
   */
  inlineLength?: number;
  /**
   * Fixed cut-away window (degrees, Tank's wall-angle frame: windowYaw 0 = +y,
   * 90 = +x), for parts whose window is not a `windowYaw` / `windowDeg` param.
   * Pipes that run into it are clipped at the wall (routing/vessel-ports.ts).
   */
  cutout?: { windowYawDeg: number; windowDeg: number };
  /**
   * Per-placement window for parts whose window follows a param that is not
   * `windowYaw` / `windowDeg` (the built-in `tank`'s `preset`). Returning
   * undefined falls back to `cutout`.
   */
  cutoutOf?: (placement: Pick<IsoPlacement, 'params'>) => { windowYawDeg: number; windowDeg: number } | undefined;
  /**
   * Wall radius of a placement when it is not simply its `radius` param (the
   * built-in `tank`'s `preset` carries its own radius). Pipes clip at it
   * (routing/vessel-ports.ts `vesselRadius`). Undefined = the usual rule.
   */
  radiusOf?: (placement: Pick<IsoPlacement, 'params' | 'height'>) => number | undefined;
  /**
   * World Y range of the straight (windowed) wall, for vessels raised on
   * legs or a skirt: a floor-level pipe below `bottomY` passes under the
   * window rather than through it. Absent = the wall stands on the floor up
   * to the placement height (routing/vessel-ports.ts `vesselWallSpan`).
   */
  wallSpan?: (placement: IsoPlacement) => { bottomY: number; topY: number };
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
  /**
   * React renderer. Optional: a **data-only** part (`model` and/or `logo` +
   * `colors`, no code) renders through `DataPart` (src/registry/DataPart.tsx):
   * the GLB styled by the theme, or a plain block of `blockHeight` when there
   * is no model, plus the logo plane on top. Packs can ship such parts as JSON.
   */
  component?: ComponentType<IsoPartProps>;
  /** Data-only parts: brand logo on the top face. */
  logo?: IsoPartLogo;
  /** Data-only parts: colour overrides for this part. */
  colors?: IsoPartColors;
  /** Data-only parts without a `model`: block height in world units (default 1). */
  blockHeight?: number;
  /**
   * Floor annotation (area, label, connector, icon, image): never an obstacle
   * for pipe / connector routing. The built-ins are also listed in
   * `NON_OBSTACLE_PARTS` (routing/occupancy.ts); this flag is how a pack opts in.
   */
  floor?: boolean;
  /**
   * The part is a connector: SceneGraph resolves its line (`placement.link`,
   * objects/connector.ts) once per scene change and hands it over in
   * `tuning.connectorPaths`.
   */
  connector?: boolean;
  /**
   * Grid-space extent of one placement, for parts that reach beyond their
   * footprint (a connector's far end, an image's size). `sceneBounds` and
   * fit-to-view add it to the footprint box.
   */
  extent?: (placement: IsoPlacement) => { minX: number; minY: number; maxX: number; maxY: number } | null;
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
