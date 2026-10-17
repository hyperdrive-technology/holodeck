/// <reference types="vite/client" />
/**
 * Browser harness for objects-render.test.ts (holodeck#36): one scene with
 * every Arcentry-parity object, rendered by the run-mode ProcessEditor.
 *
 * - data-only parts: a code-free block with a logo, and pump.glb with a logo
 *   and brand colours (no `component` on either definition);
 * - connectors: port-to-port routed around an obstacle, centre-anchored,
 *   free with waypoints, dashed with a caption, animated flow;
 * - areas: dashed outline + shadow, walled;
 * - labels: bold / italic / outline, upright;
 * - icons (built-in + glyph), images (floor + billboard + a broken URL);
 * - a metadata plane, opacity and z-order.
 *
 * URL params: theme=<theme id>. Exposes window.__objects (scene, warnings).
 */
import { useThree } from '@react-three/fiber';
import { createRoot } from 'react-dom/client';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import pumpUrl from '../../assets/models/pump.glb?url';
import { ProcessEditor } from '../editor/ProcessEditor';
import type { IsoSceneFile } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';

const params = new URLSearchParams(location.search);

const svg = (body: string, w = 64, h = 64) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;

/** Logo colours are distinctive so the test can find them in the screenshot. */
const LOGO_ORANGE = '#ff9900';
const CONNECTOR_RED = '#d0021b';
const IMAGE_GREEN = '#22aa44';

const LOGO = svg(`<rect width="64" height="64" rx="12" fill="${LOGO_ORANGE}"/><path d="M14 44 L32 14 L50 44 Z" fill="#ffffff"/>`);
const IMAGE = svg(`<rect width="128" height="64" fill="${IMAGE_GREEN}"/><circle cx="32" cy="32" r="18" fill="#ffffff"/>`, 128, 64);

const registry = createIsoRegistryWithBuiltins();

const block: IsoPartDefinition = {
  id: 'cloud:server',
  label: 'Server (data-only block)',
  category: 'Cloud',
  footprint: { w: 2, h: 2 },
  params: {},
  blockHeight: 1.2,
  logo: { url: LOGO },
  colors: { body: '#f4f6fb', edge: '#3a4a5e' },
  ports: { east: { x: 1, y: 0, dir: 'e' }, west: { x: -1, y: 0, dir: 'w' } },
};
const branded: IsoPartDefinition = {
  id: 'cloud:pump',
  label: 'Pump (data-only GLB)',
  category: 'Cloud',
  footprint: { w: 2, h: 2 },
  params: {},
  model: pumpUrl,
  logo: { url: LOGO, size: 0.6 },
  colors: { accent: '#18bae6' },
};

/** Hands the R3F scene to the test. */
function SceneProbe() {
  const scene = useThree((s) => s.scene);
  (window as unknown as { __objects: Harness }).__objects.scene = scene;
  return null;
}
const probe: IsoPartDefinition = { id: 'test:probe', label: 'Probe', footprint: { w: 1, h: 1 }, params: {}, hideInPalette: true, floor: true, component: SceneProbe };

registry.install({ id: 'objects.test', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [block, branded, probe] } });

interface Harness {
  scene: import('three').Object3D | null;
  warnings: string[];
}
const harness: Harness = { scene: null, warnings: [] };
(window as unknown as { __objects: Harness }).__objects = harness;
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  harness.warnings.push(args.map(String).join(' '));
  warn(...args);
};

const OBJECTS_SCENE: IsoSceneFile = {
  id: 'objects',
  name: 'E2 objects',
  gridCellSize: 1,
  theme: params.get('theme') ?? undefined,
  objects: [
    { id: 'zone', object: 'area', x: 6, y: 1, width: 18, height: 9, params: { outlineStyle: 'dashed', shadow: 2, fill: '#eef3fb' }, z: -1 },
    { id: 'vpn', object: 'area', x: 6, y: 9, width: 8, height: 4, params: { walled: true, wallHeight: 0.5 } },
    { id: 'web', object: 'cloud:server', x: 0, y: 0, meta: { region: 'eu-west-1', nodes: 3 } },
    { id: 'db', object: 'cloud:server', x: 12, y: 0 },
    { id: 'blocker', object: 'tank', x: 6, y: 0, opacity: 0.5 },
    { id: 'pump', object: 'cloud:pump', x: 12, y: 5 },
    {
      id: 'c-routed',
      object: 'connector',
      x: 0,
      y: 0,
      link: { from: { object: 'web', port: 'east' }, to: { object: 'db', port: 'west' } },
      params: { color: CONNECTOR_RED, width: 0.14, label: 'HTTPS', flow: true, flowSpeed: 2 },
    },
    { id: 'c-centre', object: 'connector', x: 0, y: 0, link: { from: { object: 'web' }, to: { object: 'pump' } }, params: { dash: 'dashed', startTip: 'dot' } },
    { id: 'c-free', object: 'connector', x: -2, y: 4, toX: 4, toY: 7, link: { via: [{ x: 1, y: 4 }, { x: 1, y: 7 }] }, params: { dash: 'dotted', endTip: 'arrow' }, z: 2 },
    { id: 'title', object: 'label', x: 2, y: -4, size: 0.45, params: { text: 'Production VPC', bold: true, italic: true, outline: '#ffffff', align: 'left' } },
    { id: 'sign', object: 'label', x: 6, y: 9, size: 0.4, params: { text: 'VPN', orient: 'upright', bold: true } },
    { id: 'icon-db', object: 'icon', x: 14, y: -3, params: { icon: 'database', color: '#18bae6', size: 1.4 } },
    { id: 'icon-glyph', object: 'icon', x: 16, y: -3, params: { glyph: 'S3', orient: 'upright' } },
    { id: 'img-floor', object: 'image', x: -2, y: -3, params: { src: IMAGE, width: 3 } },
    { id: 'img-board', object: 'image', x: 2, y: 9, params: { src: IMAGE, mode: 'billboard', width: 2 } },
    { id: 'img-broken', object: 'image', x: 4, y: 12, params: { src: '/does-not-exist.png', width: 2 } },
    { id: 'probe', object: 'test:probe', x: 20, y: 12 },
  ],
};

createRoot(document.getElementById('root')!).render(<ProcessEditor scene={OBJECTS_SCENE} mode="run" registry={registry} onChange={() => {}} />);
