/**
 * The parts that used to be hard-coded (tank, mixer, shaft, valve, pipe,
 * elbow, area, label, end-cap) as an ordinary extension. Nothing in the
 * editor knows these ids; they are looked up in the registry like any pack.
 */

import { HOLODECK_KINDS, type HolodeckExtension } from '@holodeck/sdk';
import { Area, Elbow, EndCap, Label, Mixer, Pipe, Shaft, Tank, Valve } from '../../assets/process';
import { LABEL_PLANE_Y, type FloorTextStyle } from '../../assets/process/Label';
import { AREA_MAX_SHADOW } from '../../assets/process/Area';
import { ANNOTATION_PARTS } from './annotation-parts';
import { formatLabelText } from './label-text';
import { mergeFittingParams } from '../../assets/process/fitting-params';
import { pipeWorldY } from '../../assets/process/pipe-math';
import { pipeRunSpec } from '../iso/pipe-runs';
import {
  DEFAULT_TANK_PARAMS,
  mergeTankParams,
  tankLayout,
  tankWallSpan,
  tunedVesselHeight,
  vesselFootprint,
  MIXER_WINDOW_DEG,
  MIXER_WINDOW_YAW,
  type TankParams,
} from '../../assets/process/tank-params';
import {
  AGITATOR_PRESET,
  MIXER_BODY_PRESET,
  TANK_PRESETS,
  type TankPreset,
  type TankPresetId,
} from '../../assets/process/tank-presets';
import { ELBOW_BEND_MODES, ELBOW_BEND_PARAM } from '../routing/elbows';
import { DEFAULT_TANK_CUTOUT } from '../routing/vessel-ports';
import { INLINE_PART_LENGTH } from '../routing/inline';
import type { HolodeckStyle } from '../../assets/process/style';
import { BUILTIN_ISO_ANIMATORS } from '../anim/animators';
import { gridToWorld } from '../iso/grid';
import { InstancedCaps, InstancedElbows, InstancedPipes, InstancedValves } from '../iso/InstancedLibrary';
import { BUILTIN_ISO_THEMES } from './themes';
import type { IsoInstancedRendererProps, IsoPartDefinition, IsoPartProps } from './types';
import type { IsoPlacement } from '../iso/scene';

export const BUILTIN_ISO_EXTENSION_ID = 'holodeck.iso.builtin';

/** Mixer-only shape defaults; tuner `tankParams` overwrite these. Shade follows the active theme. */
function mixerDefaults(style: HolodeckStyle): Partial<TankParams> {
  const flask = style.finishes.flask;
  return {
    // Same bottle body and agitator as the mash tun preset (one code path; tank-presets.ts).
    ...MIXER_BODY_PRESET,
    ...AGITATOR_PRESET,
    shadeMin: flask.shadeMin,
    hubWhite: flask.hubWhite,
    shadeMax: flask.shadeMax,
  };
}

const levelOf = (params: Record<string, unknown>): number =>
  typeof params.level === 'number' ? params.level : 0;

/**
 * The tuner's `tankParams` minus what it must not change: `mixerModel` is a
 * part / preset choice (Mixer, mash tun), and the TankTuner passes a FULL
 * TankParams whose default `mixerModel: false` would switch mixer.glb off
 * whenever the tuner is open (holodeck#233).
 */
function tunable(tankParams: Partial<TankParams> | undefined): Partial<TankParams> {
  if (!tankParams) return {};
  const { mixerModel: _choice, ...rest } = tankParams;
  return rest;
}

/** `tank` shape param: `plain` (the original built-in tank) or one of the vessel presets (tank-presets.ts). */
export const TANK_SHAPE_PLAIN = 'plain';
export const TANK_SHAPES = [TANK_SHAPE_PLAIN, ...(Object.keys(TANK_PRESETS) as TankPresetId[])] as const;

const presetOf = (params: Record<string, unknown> | undefined): TankPreset | undefined =>
  typeof params?.preset === 'string' && Object.prototype.hasOwnProperty.call(TANK_PRESETS, params.preset)
    ? TANK_PRESETS[params.preset as TankPresetId]
    : undefined;

/**
 * A `tank` placement's effective size and shape: its `preset` (HLT, mash tun,
 * whirlpool...) under the tuner's `tankParams`; `radius` param over the
 * preset's radius; the placement height over the preset's. A preset tank is
 * the same base `Tank` core's brewery parts draw, so a holodeck-only scene can
 * show a flat-lid whirlpool or the agitated mash tun (mixer.glb) without the
 * brewery pack. Round 5 (2026-10-30): the brewhouse render mapped every
 * brewery vessel to a plain domed tank because `tank` had no way to carry
 * one.
 */
export function tankPlacementShape(
  placement: Pick<IsoPlacement, 'height' | 'params'>,
  tankParams?: Partial<TankParams>,
): { radius: number; height: number; params: Partial<TankParams>; layout: ReturnType<typeof tankLayout> } {
  const preset = presetOf(placement.params);
  const params: Partial<TankParams> = { ...preset?.params, ...tunable(tankParams) };
  const height = tunedVesselHeight(placement.height ?? preset?.height ?? 3.05, tankParams);
  // Placement param (scene file / inspector), then the TankTuner's Radius slider, then the preset.
  // Review of #228: the tuner's radius was skipped, and TankPart's explicit `radius` prop then beat it.
  const radius =
    num(placement.params?.radius) ?? num(tankParams?.radius) ?? preset?.radius ?? DEFAULT_TANK_PARAMS.radius;
  return { radius, height, params, layout: tankLayout(height, radius, mergeTankParams(params)) };
}

function TankPart({ placement, params, style, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const shape = tankPlacementShape({ height: placement.height, params }, tuning?.tankParams);
  return (
    <Tank
      // Floor point on the ground (a plain tank: its wall bottom, as before; a preset on legs / a skirt: its stand).
      position={[wx, -shape.layout.floorY, wz]}
      fill={levelOf(params)}
      fillColor={params.alarm ? style.colors.alarm : placement.fillColor}
      height={shape.height}
      radius={shape.radius}
      alarm={Boolean(params.alarm)}
      params={shape.params}
    />
  );
}

function MixerPart({ placement, params, style, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const height = tunedVesselHeight(placement.height ?? 2.7, tuning?.tankParams);
  const alarm = Boolean(params.alarm);
  return (
    <Mixer
      position={[wx, height / 2, wz]}
      fill={levelOf(params)}
      fillColor={alarm ? style.colors.alarm : placement.fillColor}
      height={height}
      alarm={alarm}
      params={{ ...mixerDefaults(style), ...tunable(tuning?.tankParams) }}
    />
  );
}

function ShaftPart({ placement }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  return <Shaft position={[wx, (placement.height ?? 3) / 2, wz]} height={placement.height} />;
}

function ValvePart({ placement, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const pipeY = pipeWorldY(mergeFittingParams(tuning?.fittings).pipeRadius);
  return (
    <Valve
      position={[wx, pipeY, wz]}
      rotationY={placement.rotation ?? 0}
      handwheel={placement.handwheel}
      params={tuning?.fittings}
    />
  );
}

function PipePart({ placement, tuning }: IsoPartProps) {
  // SceneGraph resolves every run once (bends + vessel windows); a bare
  // SceneObjectView (no SceneGraph) falls back to bend trimming only.
  const run = tuning?.pipeRuns?.get(placement.id) ?? pipeRunSpec(placement, tuning?.bendKeys);
  if (!run || run.hidden) return null;
  return <Pipe from={run.from} to={run.to} ends={run.ends} band={placement.band} params={tuning?.fittings} />;
}

function ElbowPart({ placement, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const pipeY = pipeWorldY(mergeFittingParams(tuning?.fittings).pipeRadius);
  return (
    <Elbow
      position={[wx, pipeY, wz]}
      rotationY={placement.rotation ?? 0}
      knuckle={placement.rotation == null}
      params={tuning?.fittings}
    />
  );
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function AreaPart({ placement, params }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const outlineStyle = params.outlineStyle;
  return (
    <Area
      position={[wx, 0, wz]}
      size={[placement.width ?? 1, placement.height ?? 1]}
      fill={str(params.fill)}
      outline={str(params.outline)}
      outlineStyle={outlineStyle === 'dashed' || outlineStyle === 'dotted' || outlineStyle === 'none' ? outlineStyle : 'solid'}
      shadow={num(params.shadow)}
      walled={params.walled === true}
      wallHeight={num(params.wallHeight)}
    />
  );
}

function LabelPart({ placement, params, style, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const fit = mergeFittingParams(tuning?.fittings);
  return (
    <Label
      position={[wx, LABEL_PLANE_Y, wz]}
      color={params.alarm ? style.colors.alarm : placement.color}
      size={placement.size}
      rotationY={placement.rotation ?? Math.PI / 4}
      angleDeg={fit.labelAngleDeg}
      nudgeX={placement.nudgeX}
      nudgeY={placement.nudgeY}
      screenX={placement.screenX}
      screenY={placement.screenY}
      labelId={placement.id}
      textStyle={labelTextStyle(params)}
      align={params.align === 'left' || params.align === 'center' || params.align === 'right' ? params.align : 'auto'}
      orient={params.orient === 'upright' ? 'upright' : 'flat'}
    >
      {formatLabelText(params)}
    </Label>
  );
}

/** Bold / italic / outline params -> FloorText style; undefined when all are off (the original look). */
function labelTextStyle(params: Record<string, unknown>): FloorTextStyle | undefined {
  const bold = params.bold === true;
  const italic = params.italic === true;
  const outline = str(params.outline);
  if (!bold && !italic && !outline) return undefined;
  return { weight: bold ? 800 : undefined, italic, outlineColor: outline };
}

function EndCapPart({ placement, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const pipeY = pipeWorldY(mergeFittingParams(tuning?.fittings).pipeRadius);
  return <EndCap position={[wx, pipeY, wz]} rotationY={placement.rotation ?? 0} />;
}

// Pool renderers: thin adapters from the generic (items, all) contract to the
// InstancedLibrary components, which keep their own props.
const PipePool = ({ items, all, pipeRuns, onObjectPointerDown }: IsoInstancedRendererProps) => (
  <InstancedPipes
    items={items}
    elbows={all.filter((o) => o.object === 'elbow')}
    runs={pipeRuns}
    onObjectPointerDown={onObjectPointerDown}
  />
);
const ElbowPool = ({ items, onObjectPointerDown }: IsoInstancedRendererProps) => (
  <InstancedElbows items={items} onObjectPointerDown={onObjectPointerDown} />
);
const ValvePool = ({ items, onObjectPointerDown }: IsoInstancedRendererProps) => (
  <InstancedValves items={items} onObjectPointerDown={onObjectPointerDown} />
);
const CapPool = ({ items, onObjectPointerDown }: IsoInstancedRendererProps) => (
  <InstancedCaps items={items} onObjectPointerDown={onObjectPointerDown} />
);

const VESSELS = 'Vessels';
const PIPING = 'Piping';
const ANNOTATION = 'Annotation';

const LEVEL = { type: 'number', label: 'Level', default: 0.35, min: 0, max: 1, step: 0.01 } as const;

const VESSEL_SIDE_PORTS: NonNullable<IsoPartDefinition['ports']> = {
  east: { x: 1, y: 0, dir: 'e' },
  west: { x: -1, y: 0, dir: 'w' },
};

export const BUILTIN_ISO_PARTS: readonly IsoPartDefinition[] = [
  {
    id: 'tank',
    label: 'Tank',
    hint: '2×2 vessel',
    category: VESSELS,
    footprint: { w: 2, h: 2 },
    // Side nozzles at floor level on the vessel edge (+-1 cell from the centre of the 2x2).
    // `dir` is outward; routing/ports.ts rotates both offset and dir with placement.rotation.
    ports: VESSEL_SIDE_PORTS,
    // Cut-away window (TankPart renders the default Tank window). The east port
    // sits inside this arc: pipes there are clipped at the wall (routing/vessel-ports.ts).
    cutout: DEFAULT_TANK_CUTOUT,
    // A preset's window / stand (mash tun = mixer.glb's wider window; whirlpool on a skirt) for pipe clipping.
    cutoutOf: (placement) => {
      const preset = presetOf(placement.params);
      if (!preset) return undefined;
      const p = mergeTankParams(preset.params);
      return { windowYawDeg: p.windowYawDeg, windowDeg: p.windowDeg };
    },
    wallSpan: (placement) => tankWallSpan(tankPlacementShape(placement).layout),
    // The radius it is drawn with (a preset's own radius when the placement sets none), so pipes clip at the wall.
    radiusOf: (placement) => tankPlacementShape(placement).radius,
    // Same radius for the halo / occupancy box (a plain tank stays 2x2; a whirlpool preset, R 1.1, is 3x3).
    footprintOf: (placement) => vesselFootprint(tankPlacementShape(placement).radius),
    params: {
      // 0..1 fraction. The host maps REAL percent (0..100) to this range.
      level: LEVEL,
      temp: { type: 'number', label: 'Temperature', default: 20, min: 0, max: 150, step: 0.5, unit: '°C' },
      alarm: { type: 'boolean', label: 'Alarm', default: false },
      preset: { type: 'enum', label: 'Shape', default: TANK_SHAPE_PLAIN, options: [...TANK_SHAPES] },
      // Scene-file only (the footprint stays 2x2): absent = the preset's radius, 1 for a plain tank.
      radius: { type: 'number', label: 'Radius', default: undefined, min: 0.3, max: 3, step: 0.05, unit: 'm', hidden: true },
    },
    defaults: { height: 3.05 },
    component: TankPart,
  },
  {
    id: 'mixer',
    label: 'Mixer',
    hint: '2×2 agitated vessel',
    category: VESSELS,
    footprint: { w: 2, h: 2 },
    // Side nozzles at floor level on the vessel edge (+-1 cell from the centre of the 2x2).
    // `dir` is outward; routing/ports.ts rotates both offset and dir with placement.rotation.
    ports: VESSEL_SIDE_PORTS,
    cutout: { windowYawDeg: MIXER_WINDOW_YAW, windowDeg: MIXER_WINDOW_DEG },
    params: {
      level: LEVEL,
      rpm: { type: 'number', label: 'Agitator speed', default: 0, min: 0, max: 300, step: 1, unit: 'rpm' },
      alarm: { type: 'boolean', label: 'Alarm', default: false },
    },
    defaults: { height: 2.7, params: { level: 0.38 } },
    component: MixerPart,
  },
  {
    id: 'shaft',
    label: 'Shaft',
    hint: 'vertical shaft',
    category: VESSELS,
    hideInPalette: true,
    footprint: { w: 1, h: 1 },
    params: {},
    defaults: { height: 3 },
    component: ShaftPart,
  },
  {
    id: 'valve',
    label: 'Valve',
    hint: 'handwheel',
    category: PIPING,
    footprint: { w: 1, h: 1 },
    // Along-pipe body for reroute clearance (routing/inline.ts); the 1x1 footprint is the halo.
    inlineLength: INLINE_PART_LENGTH,
    // Declared so hosts can bind it and GLB valves can animate on it; the
    // code-built valve has no moving parts.
    params: { open: { type: 'boolean', label: 'Open', default: true } },
    instanced: true,
    instancedRenderer: ValvePool,
    component: ValvePart,
  },
  {
    id: 'pipe',
    label: 'Pipe',
    hint: 'click–click, manhattan',
    category: PIPING,
    footprint: { w: 1, h: 1 },
    params: {},
    defaults: { band: '#e74c3c' },
    instanced: true,
    instancedRenderer: PipePool,
    // A pipe without a far end is a stub the editor is still drawing.
    instancedWhen: (p) => p.toX !== undefined && p.toY !== undefined,
    draw: 'run',
    component: PipePart,
  },
  {
    id: 'elbow',
    label: 'Elbow',
    hint: 'corner fitting',
    category: PIPING,
    footprint: { w: 1, h: 1 },
    params: {
      // "manual": `rotation` sets the bend (absent = knuckle collar).
      // "auto": the rotation comes from the two pipe ends on this cell (routing/elbows.ts).
      [ELBOW_BEND_PARAM]: { type: 'enum', label: 'Bend', default: 'manual', options: [...ELBOW_BEND_MODES] },
    },
    instanced: true,
    instancedRenderer: ElbowPool,
    component: ElbowPart,
  },
  {
    id: 'end-cap',
    label: 'End cap',
    hint: 'pipe terminator',
    category: PIPING,
    footprint: { w: 1, h: 1 },
    // Along-pipe body for reroute clearance (routing/inline.ts); the 1x1 footprint is the halo.
    inlineLength: INLINE_PART_LENGTH,
    params: {},
    instanced: true,
    instancedRenderer: CapPool,
    // The steam coupling is a bespoke hex nut that the pooled cap cannot draw.
    instancedWhen: (p) => !p.id.includes('steam'),
    component: EndCapPart,
  },
  {
    id: 'label',
    label: 'Label',
    hint: 'floor text',
    category: ANNOTATION,
    footprint: { w: 1, h: 1 },
    params: {
      text: { type: 'string', label: 'Text', default: '' },
      // Live reading (bind a tag here). Absent = static label. See label-text.ts.
      // A number, an ON/OFF boolean (`format: 'onoff'`) or a text state: see label-text.ts.
      value: { type: 'number', label: 'Value', default: undefined, reading: true },
      unit: { type: 'string', label: 'Unit', default: '' },
      format: { type: 'enum', label: 'Format', default: 'auto', options: ['auto', 'int', 'onoff'] },
      // `{"0":"HeatHLT"}` or "0=HeatHLT,1=FillMash"; object-valued in scene files, so no inspector control.
      labels: { type: 'string', label: 'Value labels', default: '', hidden: true },
      alarm: { type: 'boolean', label: 'Alarm colour', default: false },
      bold: { type: 'boolean', label: 'Bold', default: false },
      italic: { type: 'boolean', label: 'Italic', default: false },
      align: { type: 'enum', label: 'Align', default: 'auto', options: ['auto', 'left', 'center', 'right'] },
      // Halo colour behind the glyphs; '' = none.
      outline: { type: 'color', label: 'Outline', default: '' },
      orient: { type: 'enum', label: 'Orientation', default: 'flat', options: ['flat', 'upright'] },
    },
    defaults: { params: { text: 'Label' } },
    component: LabelPart,
  },
  {
    id: 'area',
    label: 'Area',
    hint: 'pad / room',
    category: ANNOTATION,
    footprint: { w: 8, h: 6 },
    params: {
      // '' = the theme's areaFill / areaEdge.
      fill: { type: 'color', label: 'Fill', default: '' },
      outline: { type: 'color', label: 'Outline', default: '' },
      outlineStyle: { type: 'enum', label: 'Outline style', default: 'solid', options: ['solid', 'dashed', 'dotted', 'none'] },
      shadow: { type: 'number', label: 'Shadow', default: 0, min: 0, max: AREA_MAX_SHADOW, step: 1 },
      walled: { type: 'boolean', label: 'Walled', default: false },
      wallHeight: { type: 'number', label: 'Wall height', default: 0.6, min: 0.1, max: 8, step: 0.1 },
    },
    defaults: { width: 8, height: 6 },
    component: AreaPart,
  },
  ...ANNOTATION_PARTS,
];

export const BUILTIN_ISO_EXTENSION: HolodeckExtension = {
  id: BUILTIN_ISO_EXTENSION_ID,
  version: '1.0.0',
  label: 'Holodeck iso built-ins',
  description: 'Process-plant parts, themes and animators that ship with the 2.5D editor.',
  contributions: {
    [HOLODECK_KINDS.isoPart]: [...BUILTIN_ISO_PARTS],
    [HOLODECK_KINDS.isoTheme]: [...BUILTIN_ISO_THEMES],
    [HOLODECK_KINDS.isoAnimator]: [...BUILTIN_ISO_ANIMATORS],
    [HOLODECK_KINDS.isoInspector]: [],
  },
};
