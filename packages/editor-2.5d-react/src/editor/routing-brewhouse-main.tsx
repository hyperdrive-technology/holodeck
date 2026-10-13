/**
 * Render-only host for routing-brewhouse-render.test.ts: shows the scene the
 * test injects as `window.__brewhouseScene` (the Hyperdrive brewhouse with
 * its vessels mapped onto built-in parts, see the test) in run mode.
 */
import { createRoot } from 'react-dom/client';
import type { IsoSceneFile } from '../iso/scene';
import { ProcessEditor } from './ProcessEditor';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}
const scene = (window as unknown as { __brewhouseScene?: IsoSceneFile }).__brewhouseScene;
if (!scene) {
  throw new Error('window.__brewhouseScene not set');
}
createRoot(root).render(<ProcessEditor scene={scene} onChange={() => {}} mode="run" />);
