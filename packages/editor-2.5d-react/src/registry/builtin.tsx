/**
 * The parts that used to be hard-coded (tank, mixer, shaft, valve, pipe,
 * elbow, area, label, end-cap) as an ordinary extension. Nothing in the
 * editor knows these ids; they are looked up in the registry like any pack.
 */

import { HOLODECK_KINDS, type HolodeckExtension } from '@holodeck/sdk';
import { Area, Elbow, EndCap, Label, Mixer, Pipe, Shaft, Tank, Valve } from '../../assets/process';
import { LABEL_PLANE_Y } from '../../assets/process/Label';
import { formatLabelText } from './label-text';
import { mergeFittingParams } from '../../assets/process/fitting-params';
import { pipeWorldY, trimRun } from '../../assets/process/pipe-math';
import {
  tunedVesselHeight,
  MIXER_INNER_RATIO,
  MIXER_WINDOW_DEG,
  MIXER_WINDOW_YAW,
  MIXER_SHOULDER_RATIO,
  MIXER_SHOULDER_TOP,
  MIXER_OUTER_BOWL,
  MIXER_IMPELLER_RADIUS,
  MIXER_IMPELLER_SPAN,
  MIXER_SHAFT_RADIUS,
  MIXER_SHAFT_LENGTH,
  MIXER_CAP_HEIGHT_RATIO,
  MIXER_CAP_LID_THICKNESS,
  MIXER_BODY_RINGS,
  MIXER_CAP_RADIUS_RATIO,
  MIXER_RADIAL_SEGMENTS,
  MIXER_LIQUID_OPACITY,
  MIXER_LINER_RATIO,
  MIXER_LINER_COLOR,
  MIXER_WALL_THRESHOLD,
  type TankParams,
} from '../../assets/process/tank-params';
import type { HolodeckStyle } from '../../assets/process/style';
import { BUILTIN_ISO_ANIMATORS } from '../anim/animators';
import { gridToWorld } from '../iso/grid';
import { InstancedCaps, InstancedElbows, InstancedPipes, InstancedValves } from '../iso/InstancedLibrary';
import { BUILTIN_ISO_THEMES } from './themes';
import type { IsoInstancedRendererProps, IsoPartDefinition, IsoPartProps } from './types';

export const BUILTIN_ISO_EXTENSION_ID = 'holodeck.iso.builtin';

/** Mixer-only shape defaults; tuner `tankParams` overwrite these. Shade follows the active theme. */
function mixerDefaults(style: HolodeckStyle): Partial<TankParams> {
  const flask = style.finishes.flask;
  return {
    capHeightRatio: MIXER_CAP_HEIGHT_RATIO,
    capRadiusRatio: MIXER_CAP_RADIUS_RATIO,
    capLidThickness: MIXER_CAP_LID_THICKNESS,
    shaftLength: MIXER_SHAFT_LENGTH,
    shaftRadius: MIXER_SHAFT_RADIUS,
    impellerSpan: MIXER_IMPELLER_SPAN,
    impellerRadius: MIXER_IMPELLER_RADIUS,
    radialSegments: MIXER_RADIAL_SEGMENTS,
    bodyRings: MIXER_BODY_RINGS,
    innerRatio: MIXER_INNER_RATIO,
    windowDeg: MIXER_WINDOW_DEG,
    windowYawDeg: MIXER_WINDOW_YAW,
    shoulderRatio: MIXER_SHOULDER_RATIO,
    shoulderTopRatio: MIXER_SHOULDER_TOP,
    outerBowlHeight: MIXER_OUTER_BOWL,
    shadeMin: flask.shadeMin,
    liquidOpacity: MIXER_LIQUID_OPACITY,
    hubWhite: flask.hubWhite,
    shadeMax: flask.shadeMax,
    linerRatio: MIXER_LINER_RATIO,
    linerColor: MIXER_LINER_COLOR,
    wallThreshold: MIXER_WALL_THRESHOLD,
  };
}

const levelOf = (params: Record<string, unknown>): number =>
  typeof params.level === 'number' ? params.level : 0;

function TankPart({ placement, params, style, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const height = tunedVesselHeight(placement.height ?? 3.05, tuning?.tankParams);
  return (
    <Tank
      position={[wx, height / 2, wz]}
      fill={levelOf(params)}
      fillColor={params.alarm ? style.colors.alarm : placement.fillColor}
      height={height}
      alarm={Boolean(params.alarm)}
      params={tuning?.tankParams}
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
      params={{ ...mixerDefaults(style), ...tuning?.tankParams }}
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
  if (placement.toX === undefined || placement.toY === undefined) return null;
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const [tx, , tz] = gridToWorld(placement.toX, placement.toY);
  const bends = tuning?.bendKeys;
  const trimmed = trimRun(
    [wx, wz],
    [tx, tz],
    Boolean(bends?.has(`${placement.x},${placement.y}`)),
    Boolean(bends?.has(`${placement.toX},${placement.toY}`)),
  );
  return <Pipe from={trimmed.from} to={trimmed.to} band={placement.band} params={tuning?.fittings} />;
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

function AreaPart({ placement }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  return <Area position={[wx, 0, wz]} size={[placement.width ?? 1, placement.height ?? 1]} />;
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
    >
      {formatLabelText(params)}
    </Label>
  );
}

function EndCapPart({ placement, tuning }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const pipeY = pipeWorldY(mergeFittingParams(tuning?.fittings).pipeRadius);
  return <EndCap position={[wx, pipeY, wz]} rotationY={placement.rotation ?? 0} />;
}

// Pool renderers: thin adapters from the generic (items, all) contract to the
// InstancedLibrary components, which keep their own props.
const PipePool = ({ items, all, onObjectPointerDown }: IsoInstancedRendererProps) => (
  <InstancedPipes items={items} elbows={all.filter((o) => o.object === 'elbow')} onObjectPointerDown={onObjectPointerDown} />
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

export const BUILTIN_ISO_PARTS: readonly IsoPartDefinition[] = [
  {
    id: 'tank',
    label: 'Tank',
    hint: '2×2 vessel',
    category: VESSELS,
    footprint: { w: 2, h: 2 },
    params: {
      // 0..1 fraction. The host maps REAL percent (0..100) to this range.
      level: LEVEL,
      temp: { type: 'number', label: 'Temperature', default: 20, min: 0, max: 150, step: 0.5, unit: '°C' },
      alarm: { type: 'boolean', label: 'Alarm', default: false },
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
    params: {},
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
      value: { type: 'number', label: 'Value', default: undefined },
      unit: { type: 'string', label: 'Unit', default: '' },
      format: { type: 'enum', label: 'Format', default: 'auto', options: ['auto', 'int', 'onoff'] },
      // `{"0":"HeatHLT"}` or "0=HeatHLT,1=FillMash"; object-valued in scene files, so no inspector control.
      labels: { type: 'string', label: 'Value labels', default: '', hidden: true },
      alarm: { type: 'boolean', label: 'Alarm colour', default: false },
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
    params: {},
    defaults: { width: 8, height: 6 },
    component: AreaPart,
  },
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
