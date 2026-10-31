import { useEffect, useMemo, useState } from 'react';
import { SnapshotLabelLock } from '../../assets/process/Label';
import {
  DEFAULT_FITTING_PARAMS,
  mergeFittingParams,
  type FittingParams,
} from '../../assets/process/fitting-params';
import {
  DEFAULT_TANK_PARAMS,
  changedTankParams,
  mergeTankParams,
  type TankParams,
} from '../../assets/process/tank-params';
import { ProcessSceneView, REFERENCE_ZOOM } from '../editor/ProcessSceneView';
import { PROCESS_SCENE } from './load-process-scene';
import { PROCESS_SNAPSHOT_METRICS } from './ProcessLineSketch';
import { SceneGraph } from './SceneGraph';
import referenceCanvasPng from '../../tests/snapshots/reference-canvas.png?url';

const STORE = 'hyperdrive-tank-tuner-v8';

type TunerExtras = {
  zoom: number;
  overlay: number;
  overlayScale: number;
  overlayX: number;
  overlayY: number;
  showGrid: boolean;
  showTanks: boolean;
  showMixer: boolean;
  showPipes: boolean;
  showValves: boolean;
  showElbows: boolean;
  showLabels: boolean;
  showAreas: boolean;
  showCaps: boolean;
};

const DEFAULT_EXTRAS: TunerExtras = {
  zoom: REFERENCE_ZOOM,
  overlay: 0,
  overlayScale: 1,
  overlayX: 0,
  overlayY: 0,
  showGrid: true,
  showTanks: true,
  showMixer: true,
  showPipes: true,
  showValves: true,
  showElbows: true,
  showLabels: true,
  showAreas: true,
  showCaps: true,
};

type TankSlider = {
  key: keyof TankParams;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
};

type FittingSlider = {
  key: keyof FittingParams;
  label: string;
  min: number;
  max: number;
  step: number;
  group: string;
};

const SLIDERS: TankSlider[] = [
  { group: 'Shape', key: 'height', label: 'Height', min: 1.4, max: 7, step: 0.05 },
  { group: 'Shape', key: 'radius', label: 'Radius', min: 0.4, max: 2.4, step: 0.02 },
  { group: 'Cutout', key: 'windowDeg', label: 'Window width (°)', min: 20, max: 180, step: 1 },
  { group: 'Cutout', key: 'windowYawDeg', label: 'Window yaw (°)', min: 0, max: 360, step: 1 },
  { group: 'Cage', key: 'radialSegments', label: 'Meridians (every 2nd on back/bowl)', min: 4, max: 32, step: 1 },
  { group: 'Cage', key: 'bodyHeightSegments', label: 'Body height segs', min: 1, max: 16, step: 1 },
  { group: 'Cage', key: 'cageThreshold', label: 'Cage edge threshold', min: 1, max: 45, step: 1 },
  { group: 'Cage', key: 'wallThreshold', label: 'Window-wall edge threshold', min: 1, max: 45, step: 1 },
  { group: 'Cage', key: 'lineWidth', label: 'Line width (WebGL often 1)', min: 1, max: 6, step: 0.5 },
  { group: 'Dome', key: 'domeHeightSegments', label: 'Dome stacks (horiz)', min: 1, max: 16, step: 1 },
  { group: 'Dome', key: 'domePhiDeg', label: 'Dome phi (°)', min: 20, max: 180, step: 1 },
  { group: 'Dome', key: 'domeRadiusScale', label: 'Dome radius scale', min: 0.5, max: 1.4, step: 0.02 },
  { group: 'Dome', key: 'domeHeight', label: 'Dome height', min: 0.1, max: 3, step: 0.02 },
  { group: 'Dome', key: 'domeYOffset', label: 'Dome Y offset', min: -2, max: 2, step: 0.02 },
  { group: 'Dome', key: 'domeThreshold', label: 'Dome edge threshold', min: 0.2, max: 30, step: 0.2 },
  { group: 'Mixer cap', key: 'capHeightRatio', label: 'Cap height / tank', min: 0.04, max: 0.45, step: 0.01 },
  { group: 'Mixer cap', key: 'capRadiusRatio', label: 'Cap radius / tank', min: 0.4, max: 1, step: 0.01 },
  { group: 'Mixer cap', key: 'capLidThickness', label: 'Cap lid thickness', min: 0.005, max: 0.12, step: 0.005 },
  { group: 'Mixer cap', key: 'capLineWidth', label: 'Cap line thickness (px)', min: 0.5, max: 8, step: 0.25 },
  { group: 'Mixer cap', key: 'shaftRadius', label: 'Shaft radius', min: 0.01, max: 0.12, step: 0.005 },
  { group: 'Mixer cap', key: 'shaftLength', label: 'Shaft length / height', min: 0.4, max: 1.2, step: 0.02 },
  { group: 'Mixer cap', key: 'impellerSpan', label: 'Impeller span', min: 0.2, max: 1.6, step: 0.02 },
  { group: 'Mixer cap', key: 'impellerRadius', label: 'Impeller bar r', min: 0.008, max: 0.08, step: 0.002 },
  { group: 'Liquid', key: 'fill', label: 'Fill', min: 0.05, max: 0.95, step: 0.01 },
  { group: 'Liquid', key: 'liquidOpacity', label: 'Liquid opacity', min: 0.15, max: 1, step: 0.01 },
  { group: 'Liquid', key: 'innerRatio', label: 'Inner radius / tank', min: 0.6, max: 0.98, step: 0.01 },
  { group: 'Liquid', key: 'linerRatio', label: 'Liner radius / tank', min: 0.85, max: 1, step: 0.005 },
  { group: 'Liquid', key: 'bowlHeightSegments', label: 'Bowl stacks', min: 2, max: 24, step: 1 },
  { group: 'Liquid', key: 'bowlHeight', label: 'Bowl height', min: 0.1, max: 3, step: 0.02 },
  { group: 'Liquid', key: 'bowlYOffset', label: 'Bowl Y offset', min: -2, max: 2, step: 0.02 },
  { group: 'Liquid', key: 'bowlThreshold', label: 'Bowl edge threshold', min: 1, max: 45, step: 1 },
  { group: 'Shading', key: 'shadeMin', label: 'Shade left (dark)', min: 0.2, max: 0.9, step: 0.01 },
  { group: 'Shading', key: 'shadeMax', label: 'Shade right (light)', min: 0.5, max: 1, step: 0.01 },
  { group: 'Shading', key: 'hubWhite', label: 'Cap hub white', min: 0.6, max: 1, step: 0.01 },
];

const FITTING_SLIDERS: FittingSlider[] = [
  { group: 'Pipe', key: 'pipeRadius', label: 'Radius', min: 0.04, max: 0.4, step: 0.005 },
  { group: 'Pipe', key: 'pipeSides', label: 'Sides (try 8–10)', min: 4, max: 24, step: 1 },
  { group: 'Pipe', key: 'pipeWireWidth', label: 'Mesh line width (px)', min: 1, max: 6, step: 0.25 },
  { group: 'Pipe', key: 'flangeScale', label: 'Flange radius × pipe', min: 1, max: 3.2, step: 0.05 },
  { group: 'Pipe', key: 'flangeLen', label: 'Flange length', min: 0.02, max: 0.35, step: 0.005 },
  { group: 'Pipe', key: 'bandScale', label: 'Band radius × pipe', min: 1, max: 2.4, step: 0.02 },
  { group: 'Pipe', key: 'bandLen', label: 'Band length', min: 0.02, max: 0.3, step: 0.005 },
  { group: 'Pipe', key: 'bandAlong', label: 'Band along run (0–1)', min: 0, max: 0.5, step: 0.01 },
  { group: 'Elbow', key: 'elbowMajor', label: 'Torus major radius', min: 0.08, max: 0.7, step: 0.01 },
  { group: 'Elbow', key: 'elbowRadial', label: 'Torus radial segs', min: 3, max: 16, step: 1 },
  { group: 'Elbow', key: 'elbowTubular', label: 'Torus tubular segs', min: 4, max: 32, step: 1 },
  { group: 'Elbow', key: 'elbowEdgeThreshold', label: 'Elbow edge threshold', min: 1, max: 45, step: 1 },
  { group: 'Elbow', key: 'elbowCapDeg', label: 'Elbow cap angle (°)', min: -180, max: 180, step: 1 },
  { group: 'Elbow', key: 'elbowOffset', label: 'Elbow offset (along bisector)', min: -1, max: 0.5, step: 0.01 },
  { group: 'Elbow', key: 'knuckleRadius', label: 'Knuckle radius', min: 0.06, max: 0.4, step: 0.01 },
  { group: 'Elbow', key: 'knuckleLen', label: 'Knuckle length', min: 0.04, max: 0.4, step: 0.01 },
  { group: 'Elbow', key: 'knuckleSides', label: 'Knuckle sides', min: 4, max: 24, step: 1 },
  { group: 'Valve', key: 'valveGlobe', label: 'Globe radius', min: 0.06, max: 0.5, step: 0.01 },
  { group: 'Valve', key: 'valveGlobeW', label: 'Globe width segs', min: 6, max: 32, step: 1 },
  { group: 'Valve', key: 'valveGlobeH', label: 'Globe height segs', min: 4, max: 24, step: 1 },
  { group: 'Valve', key: 'valveBarrelR', label: 'Barrel radius', min: 0.03, max: 0.22, step: 0.005 },
  { group: 'Valve', key: 'valveBarrelLen', label: 'Barrel length', min: 0.12, max: 0.9, step: 0.01 },
  { group: 'Valve', key: 'valveBarrelSides', label: 'Barrel sides', min: 4, max: 24, step: 1 },
  { group: 'Valve', key: 'valveStemR', label: 'Stem radius', min: 0.008, max: 0.06, step: 0.002 },
  { group: 'Valve', key: 'valveStemH', label: 'Stem height', min: 0.04, max: 0.4, step: 0.01 },
  { group: 'Valve', key: 'valveStemY', label: 'Stem Y', min: 0.08, max: 0.55, step: 0.01 },
  { group: 'Valve', key: 'valveWheelR', label: 'Wheel radius', min: 0.1, max: 0.7, step: 0.01 },
  { group: 'Valve', key: 'valveDiscH', label: 'Wheel disc height', min: 0.01, max: 0.16, step: 0.005 },
  { group: 'Valve', key: 'valveSpokeY', label: 'Wheel Y', min: 0.12, max: 0.7, step: 0.01 },
  { group: 'Valve', key: 'valveTorusTube', label: 'Wheel rim tube', min: 0.02, max: 0.14, step: 0.002 },
  { group: 'Valve', key: 'valveTorusRadial', label: 'Rim radial segs', min: 3, max: 16, step: 1 },
  { group: 'Valve', key: 'valveTorusTubular', label: 'Rim tubular segs', min: 6, max: 48, step: 1 },
  { group: 'Valve', key: 'valveSpokeR', label: 'Spoke radius', min: 0.004, max: 0.04, step: 0.002 },
  { group: 'Valve', key: 'valveSpokeCount', label: 'Spoke count', min: 2, max: 12, step: 1 },
  { group: 'Valve', key: 'valveWheelSegs', label: 'Disc segments', min: 8, max: 48, step: 1 },
  { group: 'Label', key: 'labelAngleDeg', label: 'Label angle (° clockwise on floor)', min: -180, max: 180, step: 1 },
];

const CHECKS: { key: keyof TankParams; label: string }[] = [
  { key: 'showCage', label: 'Contour cage (back wall)' },
  { key: 'showWall', label: 'Shaded window wall' },
  { key: 'showLiner', label: 'Interior liner' },
  { key: 'showDome', label: 'Dome' },
  { key: 'showBowl', label: 'Inner bowl' },
  { key: 'showLiquid', label: 'Liquid cylinder' },
];

const FITTING_CHECKS: { key: keyof FittingParams; label: string }[] = [
  { key: 'pipeShowFill', label: 'Pipe shaded fill' },
  { key: 'pipeShowWire', label: 'Pipe mesh outline' },
  { key: 'pipeShowFlanges', label: 'Pipe end flanges' },
  { key: 'pipeShowBand', label: 'Pipe colour band' },
  { key: 'elbowShowWire', label: 'Elbow edges' },
  { key: 'valveShowGlobe', label: 'Valve globe' },
  { key: 'valveShowBarrel', label: 'Valve barrel' },
  { key: 'valveShowStem', label: 'Valve stem' },
  { key: 'valveShowDisc', label: 'Valve wheel disc' },
  { key: 'valveShowTorus', label: 'Valve wheel rim' },
  { key: 'valveShowSpokes', label: 'Valve spokes' },
  { key: 'valveShowWire', label: 'Valve mesh outline' },
];

function loadStored(): { params: TankParams; fittings: FittingParams; extras: TunerExtras } {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) {
      return { params: DEFAULT_TANK_PARAMS, fittings: DEFAULT_FITTING_PARAMS, extras: DEFAULT_EXTRAS };
    }
    const parsed = JSON.parse(raw) as {
      params?: Partial<TankParams>;
      fittings?: Partial<FittingParams>;
      extras?: Partial<TunerExtras>;
    };
    return {
      params: mergeTankParams(parsed.params),
      fittings: mergeFittingParams(parsed.fittings),
      extras: { ...DEFAULT_EXTRAS, ...parsed.extras },
    };
  } catch {
    return { params: DEFAULT_TANK_PARAMS, fittings: DEFAULT_FITTING_PARAMS, extras: DEFAULT_EXTRAS };
  }
}

function RangeRow({
  testId,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  testId?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <label style={{ display: 'block', margin: '8px 0' }}>
      {label}{' '}
      <span style={{ color: '#666' }}>{Number.isInteger(step) ? value : value.toFixed(3)}</span>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </label>
  );
}

export function TankTuner() {
  const initial = useMemo(() => loadStored(), []);
  const [params, setParams] = useState<TankParams>(initial.params);
  const [fittings, setFittings] = useState<FittingParams>(initial.fittings);
  const [extras, setExtras] = useState<TunerExtras>(initial.extras);
  const [copied, setCopied] = useState(false);
  const tunedParams = useMemo(() => changedTankParams(params), [params]);

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify({ params, fittings, extras }));
  }, [params, fittings, extras]);

  const groups = [...new Set(SLIDERS.map((s) => s.group))];
  const fittingGroups = [...new Set(FITTING_SLIDERS.map((s) => s.group))];
  const json = JSON.stringify({ ...params, ...fittings, ...extras }, null, 2);
  const objects = PROCESS_SCENE.objects.filter((object) => {
    switch (object.object) {
      case 'tank':
        return extras.showTanks;
      case 'mixer':
        return extras.showMixer;
      case 'pipe':
        return extras.showPipes;
      case 'valve':
        return extras.showValves;
      case 'elbow':
        return extras.showElbows;
      case 'label':
        return extras.showLabels;
      case 'area':
        return extras.showAreas;
      case 'end-cap':
        return extras.showCaps;
      default:
        return true;
    }
  });

  return (
    <div
      data-testid="tank-tuner"
      data-scene-id={PROCESS_SCENE.id}
      style={{ display: 'flex', width: '100%', height: '100%', font: '12px/1.35 ui-sans-serif, system-ui', color: '#222' }}
    >
      <aside
        style={{
          width: 360,
          flex: 'none',
          overflow: 'auto',
          padding: 12,
          borderRight: '1px solid #ddd',
          background: '#fafafa',
          position: 'relative',
          zIndex: 2,
        }}
      >
        <strong style={{ fontSize: 14 }}>Process tuner</strong>
        <p style={{ margin: '6px 0 12px', color: '#555' }}>
          tests/scene.json (holding, mixer, A/B, pipes, valves, labels). Overlay is the
          cropped process pane (no chrome). Copy JSON when a combo looks right.
        </p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(json);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? 'Copied' : 'Copy JSON'}
          </button>
          <button
            type="button"
            onClick={() => {
              setParams(DEFAULT_TANK_PARAMS);
              setFittings(DEFAULT_FITTING_PARAMS);
              setExtras(DEFAULT_EXTRAS);
            }}
          >
            Reset
          </button>
        </div>
        <RangeRow
          label="Zoom"
          value={extras.zoom}
          min={12}
          max={80}
          step={1}
          onChange={(zoom) => setExtras((x) => ({ ...x, zoom }))}
        />
        <RangeRow
          label="Reference overlay %"
          value={extras.overlay}
          min={0}
          max={1}
          step={0.01}
          onChange={(overlay) => setExtras((x) => ({ ...x, overlay }))}
        />
        <RangeRow
          label="Overlay scale"
          value={extras.overlayScale}
          min={0.4}
          max={2.4}
          step={0.01}
          onChange={(overlayScale) => setExtras((x) => ({ ...x, overlayScale }))}
        />
        <RangeRow
          label="Overlay X px"
          value={extras.overlayX}
          min={-400}
          max={400}
          step={1}
          onChange={(overlayX) => setExtras((x) => ({ ...x, overlayX }))}
        />
        <RangeRow
          label="Overlay Y px"
          value={extras.overlayY}
          min={-400}
          max={400}
          step={1}
          onChange={(overlayY) => setExtras((x) => ({ ...x, overlayY }))}
        />
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={extras.showGrid}
            onChange={(e) => setExtras((x) => ({ ...x, showGrid: e.target.checked }))}
          />
          Grid
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={extras.showTanks}
            onChange={(e) => setExtras((x) => ({ ...x, showTanks: e.target.checked }))}
          />
          Tanks
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={extras.showMixer}
            onChange={(e) => setExtras((x) => ({ ...x, showMixer: e.target.checked }))}
          />
          Mixer
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            data-testid="show-pipes"
            type="checkbox"
            checked={extras.showPipes}
            onChange={(e) => setExtras((x) => ({ ...x, showPipes: e.target.checked }))}
          />
          Pipes
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            data-testid="show-valves"
            type="checkbox"
            checked={extras.showValves}
            onChange={(e) => setExtras((x) => ({ ...x, showValves: e.target.checked }))}
          />
          Valves
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={extras.showElbows}
            onChange={(e) => setExtras((x) => ({ ...x, showElbows: e.target.checked }))}
          />
          Elbows
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={extras.showLabels}
            onChange={(e) => setExtras((x) => ({ ...x, showLabels: e.target.checked }))}
          />
          Labels
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={extras.showAreas}
            onChange={(e) => setExtras((x) => ({ ...x, showAreas: e.target.checked }))}
          />
          Areas
        </label>
        <label style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={extras.showCaps}
            onChange={(e) => setExtras((x) => ({ ...x, showCaps: e.target.checked }))}
          />
          End caps
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Fill colour
          <input
            type="color"
            value={params.fillColor}
            onChange={(e) => setParams((p) => ({ ...p, fillColor: e.target.value }))}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Edge colour
          <input
            type="color"
            value={params.edgeColor}
            onChange={(e) => setParams((p) => ({ ...p, edgeColor: e.target.value }))}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Liner colour
          <input
            type="color"
            value={params.linerColor}
            onChange={(e) => setParams((p) => ({ ...p, linerColor: e.target.value }))}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Pipe wire colour
          <input
            type="color"
            value={fittings.pipeWireColor}
            onChange={(e) => setFittings((p) => ({ ...p, pipeWireColor: e.target.value }))}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Pipe band colour
          <input
            type="color"
            value={fittings.pipeBandColor}
            onChange={(e) => setFittings((p) => ({ ...p, pipeBandColor: e.target.value }))}
            style={{ marginLeft: 8 }}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 12 }}>
          Handwheel colour
          <input
            type="color"
            value={fittings.valveHandwheel}
            onChange={(e) => setFittings((p) => ({ ...p, valveHandwheel: e.target.value }))}
            style={{ marginLeft: 8 }}
          />
        </label>
        {CHECKS.map((c) => (
          <label key={c.key} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={Boolean(params[c.key])}
              onChange={(e) => setParams((p) => ({ ...p, [c.key]: e.target.checked }))}
            />
            {c.label}
          </label>
        ))}
        {FITTING_CHECKS.map((c) => (
          <label key={c.key} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={Boolean(fittings[c.key])}
              onChange={(e) => setFittings((p) => ({ ...p, [c.key]: e.target.checked }))}
            />
            {c.label}
          </label>
        ))}
        {fittingGroups.map((group) => (
          <details key={group} open style={{ marginTop: 10 }}>
            <summary style={{ fontWeight: 600, cursor: 'pointer' }}>{group}</summary>
            {FITTING_SLIDERS.filter((s) => s.group === group).map((s) => (
              <RangeRow
                key={s.key}
                testId={`slider-${s.key}`}
                label={s.label}
                value={Number(fittings[s.key])}
                min={s.min}
                max={s.max}
                step={s.step}
                onChange={(n) => setFittings((prev) => ({ ...prev, [s.key]: n }))}
              />
            ))}
          </details>
        ))}
        {groups.map((group) => (
          <details key={group} open style={{ marginTop: 10 }}>
            <summary style={{ fontWeight: 600, cursor: 'pointer' }}>{group}</summary>
            {SLIDERS.filter((s) => s.group === group).map((s) => (
              <RangeRow
                key={s.key}
                testId={`slider-${s.key}`}
                label={s.label}
                value={Number(params[s.key])}
                min={s.min}
                max={s.max}
                step={s.step}
                onChange={(n) => setParams((prev) => ({ ...prev, [s.key]: n }))}
              />
            ))}
          </details>
        ))}
        <pre
          style={{
            marginTop: 12,
            padding: 8,
            background: '#fff',
            border: '1px solid #eee',
            fontSize: 10,
            overflow: 'auto',
            maxHeight: 180,
          }}
        >
          {json}
        </pre>
      </aside>
      <div style={{ flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden', zIndex: 0 }}>
        <ProcessSceneView
          scene={PROCESS_SCENE}
          zoom={extras.zoom}
          onZoomChange={(z) => setExtras((x) => ({ ...x, zoom: z }))}
          showControls
          showGrid={extras.showGrid}
        >
          <SnapshotLabelLock.Provider value={false}>
            <SceneGraph
              objects={objects}
              metrics={PROCESS_SNAPSHOT_METRICS}
              // Only what was changed (holodeck#235): the full state would override every preset.
              tankParams={tunedParams}
              fittings={fittings}
              instanced={false}
            />
          </SnapshotLabelLock.Provider>
        </ProcessSceneView>
        {extras.overlay > 0 ? (
          <img
            alt="reference"
            src={referenceCanvasPng}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              opacity: extras.overlay,
              pointerEvents: 'none',
              mixBlendMode: 'multiply',
              transform: `translate(${extras.overlayX}px, ${extras.overlayY}px) scale(${extras.overlayScale})`,
              transformOrigin: 'center center',
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
