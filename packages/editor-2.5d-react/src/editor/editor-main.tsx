import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PROCESS_SCENE } from '../iso/load-process-scene';
import type { IsoSceneFile } from '../iso/scene';
import { emptyScene } from './editor-state';
import { ProcessEditor } from './ProcessEditor';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}

/** `?scene=routing`: three tanks in a row (middle one is the obstacle) for the auto-route browser test. */
function initialScene(): IsoSceneFile {
  if (new URLSearchParams(window.location.search).get('scene') !== 'routing') {
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

function Host() {
  const [scene, setScene] = useState(initialScene);
  // Test hook: the committed scene, readable from Playwright.
  (window as unknown as { __scene: IsoSceneFile }).__scene = scene;
  // `?mode=run`: the read-only host mode (pan browser test).
  const mode = new URLSearchParams(window.location.search).get('mode') === 'run' ? 'run' : 'edit';
  return <ProcessEditor scene={scene} onChange={setScene} mode={mode} />;
}

createRoot(root).render(<Host />);
