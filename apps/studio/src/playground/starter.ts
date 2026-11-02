/**
 * The playground's starter document: a small process line (feed tank ->
 * valve -> mixer -> valve -> product tank) with readings on labels, and one
 * secret-free `holodeck.sim` connection already bound, so the Viewer tab
 * animates on the very first run with no configuration.
 *
 * Every binding uses a sim waveform (deterministic, no network, no secrets):
 * see the SDK's `SIM_SOURCE_SYNTAX`. Vessel `level` is a 0..1 fraction, so
 * percent signals go through a `scale` transform (PERCENT_TO_FRACTION).
 */

import { SIM_PROVIDER_ID, type HolodeckDocument, type SignalBinding, type ValueTransform } from '@holodeck/sdk';
import { toIsoDocument, type IsoPlacement, type IsoSceneFile } from '@holodeck/editor-2.5d-react';

/** The one playground document's fixed id in the studio store. */
export const PLAYGROUND_DOCUMENT_ID = 'playground';
export const PLAYGROUND_DOCUMENT_NAME = 'Playground';
/** The starter's simulated connection. */
export const PLAYGROUND_CONNECTION_ID = 'sim';

/** 0–100 % -> a vessel's 0..1 `level`. */
export const PERCENT_TO_FRACTION: ValueTransform = { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1, clamp: true };

/** Sim signals the starter binds (all 0–100 unless noted). */
export const STARTER_SIGNALS = {
  /** Feed tank: fills and drains every 20 s between 15 % and 90 %. */
  feedLevel: 'sine:20:15:90',
  /** Mixer contents: slow sawtooth 20–80 %. */
  mixerLevel: 'ramp:30:20:80',
  /** Agitator speed in rpm (40–180, period 8 s). */
  agitatorRpm: 'sine:8:40:180',
  /** Product tank: fills over 45 s from 5 % to 95 %. */
  productLevel: 'ramp:45:5:95',
  /** Inlet valve: open for 3 s of every 6 s. */
  inletValve: 'square:6',
  /** Outlet valve: open for 5 s of every 10 s. */
  outletValve: 'square:10',
} as const;

/** High-level alarm: on at 85 % and above. */
const HIGH_ALARM: ValueTransform = { kind: 'threshold', below: false, steps: [{ at: 85, value: true }] };
/** Accent colour of the process area follows the feed level: green, amber from 70 %, red from 85 %. */
const AREA_ACCENT: ValueTransform = {
  kind: 'threshold',
  below: '#dcfce7',
  steps: [
    { at: 70, value: '#fef3c7' },
    { at: 85, value: '#fee2e2' },
  ],
};

const bind = (source: string, transform?: ValueTransform): SignalBinding => ({
  connection: PLAYGROUND_CONNECTION_ID,
  source,
  ...(transform ? { transform } : {}),
});

function starterObjects(): IsoPlacement[] {
  return [
    {
      id: 'process-area',
      object: 'area',
      x: 10,
      y: 0,
      width: 26,
      height: 12,
      z: -1,
      params: { fill: '#dcfce7', outline: '#94a3b8', outlineStyle: 'dashed' },
      bindings: { fill: bind(STARTER_SIGNALS.feedLevel, AREA_ACCENT) },
    },
    {
      id: 'feed-tank',
      object: 'tank',
      x: 0,
      y: 0,
      params: { level: 0.5 },
      bindings: { level: bind(STARTER_SIGNALS.feedLevel, PERCENT_TO_FRACTION), alarm: bind(STARTER_SIGNALS.feedLevel, HIGH_ALARM) },
    },
    { id: 'inlet-pipe', object: 'pipe', x: 1, y: 0, toX: 9, toY: 0, attach: { from: { object: 'feed-tank', port: 'east' }, to: { object: 'mixer', port: 'west' } } },
    { id: 'inlet-valve', object: 'valve', x: 5, y: 0, onPipe: 'inlet-pipe', at: 0.5, bindings: { open: bind(STARTER_SIGNALS.inletValve) } },
    {
      id: 'mixer',
      object: 'mixer',
      x: 10,
      y: 0,
      params: { level: 0.4, rpm: 60 },
      bindings: { level: bind(STARTER_SIGNALS.mixerLevel, PERCENT_TO_FRACTION), rpm: bind(STARTER_SIGNALS.agitatorRpm) },
    },
    { id: 'outlet-pipe', object: 'pipe', x: 11, y: 0, toX: 19, toY: 0, attach: { from: { object: 'mixer', port: 'east' }, to: { object: 'product-tank', port: 'west' } } },
    { id: 'outlet-valve', object: 'valve', x: 15, y: 0, onPipe: 'outlet-pipe', at: 0.5, bindings: { open: bind(STARTER_SIGNALS.outletValve) } },
    {
      id: 'product-tank',
      object: 'tank',
      x: 20,
      y: 0,
      params: { level: 0.3 },
      bindings: { level: bind(STARTER_SIGNALS.productLevel, PERCENT_TO_FRACTION) },
    },
    {
      id: 'feed-label',
      object: 'label',
      size: 0.55,
      x: 0,
      y: 3,
      params: { text: 'Feed', unit: '%', format: 'int', bold: true },
      bindings: { value: bind(STARTER_SIGNALS.feedLevel), alarm: bind(STARTER_SIGNALS.feedLevel, HIGH_ALARM) },
    },
    {
      id: 'mixer-label',
      object: 'label',
      size: 0.55,
      x: 10,
      y: 3,
      params: { text: 'Agitator', unit: 'rpm', format: 'int', bold: true },
      bindings: { value: bind(STARTER_SIGNALS.agitatorRpm) },
    },
    {
      id: 'product-label',
      object: 'label',
      size: 0.55,
      x: 20,
      y: 3,
      params: { text: 'Product', unit: '%', format: 'int', bold: true },
      bindings: { value: bind(STARTER_SIGNALS.productLevel) },
    },
    {
      id: 'title-label',
      object: 'label',
      x: 10,
      y: -5,
      size: 0.8,
      params: { text: 'Process line (simulated)', bold: true },
    },
  ];
}

/**
 * A fresh starter document (independent objects every call: edits must never
 * mutate a shared copy). `requires` is filled in by the workspace / store
 * validation path (`withRequires`), as for any edit.
 */
export function createPlaygroundDocument(): HolodeckDocument<IsoSceneFile> {
  const scene: IsoSceneFile = {
    id: PLAYGROUND_DOCUMENT_ID,
    name: PLAYGROUND_DOCUMENT_NAME,
    gridCellSize: 1,
    objects: starterObjects(),
  };
  return {
    ...toIsoDocument(scene),
    connections: [{ id: PLAYGROUND_CONNECTION_ID, provider: SIM_PROVIDER_ID, label: 'Simulated plant' }],
  };
}
