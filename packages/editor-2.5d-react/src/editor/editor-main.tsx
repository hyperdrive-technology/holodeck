import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PROCESS_SCENE } from '../iso/load-process-scene';
import type { IsoSceneFile } from '../iso/scene';
import { emptyScene } from './editor-state';
import type { EditorCamera } from './camera';
import { ProcessEditor, type ProcessEditorProps } from './ProcessEditor';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}

/** `?scene=routing`: three tanks in a row (middle one is the obstacle) for the auto-route browser test. */
const params = new URLSearchParams(window.location.search);

/** `?scene=editing`: three tanks on a row plus a valve, for the E3 editing-UX browser test. */
function editingScene(): IsoSceneFile {
  return {
    ...emptyScene('editing'),
    objects: [
      { id: 'tank-a', object: 'tank', x: 0, y: 0, height: 3.05, params: { level: 0.6 } },
      { id: 'tank-b', object: 'tank', x: 6, y: 0, height: 3.05, params: { level: 0.3 } },
      { id: 'tank-c', object: 'tank', x: 12, y: 0, height: 3.05, params: { level: 0.8 } },
      { id: 'valve-a', object: 'valve', x: 6, y: 6 },
    ],
  };
}

function initialScene(): IsoSceneFile {
  if (params.get('scene') === 'editing') return editingScene();
  if (params.get('scene') !== 'routing') {
    return PROCESS_SCENE;
  }
  return {
    ...emptyScene('routing'),
    objects: [
      { id: 'tank-1', object: 'tank', x: 0, y: 0, height: 3.05, params: { level: 0.6 } },
      { id: 'tank-2', object: 'tank', x: 6, y: 0, height: 3.05, params: { level: 0.3 } },
      { id: 'tank-3', object: 'tank', x: 12, y: 0, height: 3.05, params: { level: 0.8 } },
    ],
  };
}

type HostWindow = {
  __scene: IsoSceneFile;
  /** Every onCameraChange report, oldest first. */
  __cameras: EditorCamera[];
  /** Every onPlaced id. */
  __placed: string[];
  /** Host-side tool arm (holodeck#100 `placing`), set from Playwright. */
  __setPlacing?: (partId: string | null) => void;
};

function Host() {
  const [scene, setScene] = useState(initialScene);
  const [placing, setPlacing] = useState<string | null | undefined>(undefined);
  const w = window as unknown as HostWindow;
  // Test hooks: the committed scene and host callbacks, readable from Playwright.
  w.__scene = scene;
  w.__cameras ??= [];
  w.__placed ??= [];
  w.__setPlacing = setPlacing;
  // `?mode=run`: the read-only host mode (pan browser test).
  const mode = params.get('mode') === 'run' ? 'run' : 'edit';
  // `?chrome=canvas`: Studio-style canvas only (holodeck#100).
  const chrome = (params.get('chrome') ?? undefined) as ProcessEditorProps['chrome'];
  // `?camera=<json>`: open on a stored camera instead of fitting.
  const cameraParam = params.get('camera');
  const [camera] = useState<EditorCamera | undefined>(() => (cameraParam ? (JSON.parse(cameraParam) as EditorCamera) : undefined));
  return (
    <ProcessEditor
      scene={scene}
      onChange={setScene}
      mode={mode}
      chrome={chrome}
      camera={camera}
      onCameraChange={(c) => w.__cameras.push(c)}
      placing={placing}
      onPlacingChange={setPlacing}
      onPlaced={(p) => w.__placed.push(p.id)}
    />
  );
}

createRoot(root).render(<Host />);
