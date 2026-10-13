/// <reference types="vite/client" />
/**
 * Browser harness for registry-render.test.ts: a controlled ProcessEditor
 * with a "pack" installed at runtime that registers pump.glb as a part with
 * zero React code (GlbPart) and an `anim.shaft` spin binding.
 *
 * URL params: mode=run|edit, theme=<theme id>, selected=<placement id>.
 * Exposes window.__harness for the test to read back what the page saw.
 */
import { useThree } from '@react-three/fiber';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import pumpUrl from '../../assets/models/pump.glb?url';
import { ProcessEditor } from '../editor/ProcessEditor';
import type { IsoSceneFile } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from './default';
import { GlbPart } from './GlbPart';
import type { IsoInspectorPanel, IsoPartDefinition } from './types';

const params = new URLSearchParams(location.search);
const registry = createIsoRegistryWithBuiltins();

const pump: IsoPartDefinition = {
  id: 'test:pump',
  label: 'Test pump',
  category: 'Test pack',
  footprint: { w: 2, h: 2 },
  params: { rpm: { type: 'number', label: 'Pump rpm', default: 0, min: 0, max: 1500 } },
  model: pumpUrl,
  animNodes: { rpm: { node: 'anim.shaft', animator: 'spin' } },
  component: GlbPart,
};

/** Hands the R3F scene to the test so it can inspect GLB nodes and materials. */
function SceneProbe() {
  const scene = useThree((s) => s.scene);
  (window as unknown as { __harness: Harness }).__harness.scene = scene;
  return null;
}
const probe: IsoPartDefinition = {
  id: 'test:probe',
  label: 'Probe',
  footprint: { w: 1, h: 1 },
  params: {},
  hideInPalette: true,
  component: SceneProbe,
};

const binding: IsoInspectorPanel = {
  id: 'test:binding',
  label: 'Test binding',
  component: ({ placement }) => <div data-testid="host-panel">binding for {placement.id}</div>,
};

interface Harness {
  registry: typeof registry;
  scene: import('three').Object3D | null;
  changes: IsoSceneFile[];
  selections: Array<string | null>;
  installLater(): void;
}
const harness: Harness = {
  registry,
  scene: null,
  changes: [],
  selections: [],
  installLater() {
    const late: IsoPartDefinition = { ...pump, id: 'late:part', label: 'Late arrival', category: 'Late pack' };
    registry.install({ id: 'test.late', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [late] } });
  },
};
(window as unknown as { __harness: Harness }).__harness = harness;

registry.install({
  id: 'test.pack',
  version: '1',
  contributions: {
    [HOLODECK_KINDS.isoPart]: [pump, probe],
    [HOLODECK_KINDS.isoInspector]: [binding],
  },
});

const initial: IsoSceneFile = {
  id: 'harness',
  name: 'harness',
  gridCellSize: 1,
  theme: params.get('theme') ?? undefined,
  objects: [
    { id: 'tank-1', object: 'tank', x: 0, y: 0, height: 3.05, params: { level: 0.4 } },
    { id: 'pump-1', object: 'test:pump', x: 5, y: 0 },
    { id: 'probe', object: 'test:probe', x: 9, y: 9 },
  ],
};

function Host() {
  const [scene, setScene] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>(params.get('selected'));
  return (
    <ProcessEditor
      scene={scene}
      mode={params.get('mode') === 'run' ? 'run' : 'edit'}
      registry={registry}
      metrics={{ 'pump-1': { rpm: 600 } }}
      selectedId={selectedId}
      onSelect={(id) => {
        harness.selections.push(id);
        setSelectedId(id);
      }}
      onChange={(next) => {
        harness.changes.push(next);
        setScene(next);
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Host />);
