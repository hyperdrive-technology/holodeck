/**
 * Render-only host for pipe-cutaway-render.test.ts: one brewery scene
 * (injected as `window.__cutawayScene`) with its vessels drawn as the base
 * `Tank` presets, so pipes that run into a cut-away window can be checked
 * up close.
 *
 * The brewery vessel parts live in the core repo (@hyperdrive/ext-brewery
 * iso-parts.tsx), which depends on this package, so they cannot be imported
 * here. `presetVessel` (pipe-cutaway-parts.tsx) mirrors the parts that matter for the clip:
 * same part ids, the preset's radius / height / closures / stand, the
 * `windowYaw` / `windowDeg` params and the `wallSpan` from `tankWallSpan`.
 * Pumps and the heat exchanger (GLBs) are dropped by the test.
 *
 * URL params: mode=editor (ProcessEditor, its own fitted zoom) or
 * mode=canvas&zoom=<z>&tx=&ty=&tz= (IsoCanvas at an explicit zoom and
 * look-at, for close-ups).
 */
import { createRoot } from 'react-dom/client';
import { IsoCanvas } from '../iso/IsoCanvas';
import { SceneGraph } from '../iso/SceneGraph';
import type { IsoSceneFile } from '../iso/scene';
import { IsoRegistryProvider } from '../registry/react';
import { ProcessEditor } from './ProcessEditor';
import { createCutawayRegistry } from './pipe-cutaway-parts';

const registry = createCutawayRegistry();
const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
const scene = (window as unknown as { __cutawayScene?: IsoSceneFile }).__cutawayScene;
if (!scene) throw new Error('window.__cutawayScene not set');
const q = new URLSearchParams(location.search);

if (q.get('mode') === 'canvas') {
  const zoom = Number(q.get('zoom') ?? 40);
  const target: [number, number, number] = [Number(q.get('tx') ?? 0), Number(q.get('ty') ?? 0), Number(q.get('tz') ?? 0)];
  createRoot(root).render(
    <main data-testid="cutaway-root" style={{ width: '100%', height: '100%' }}>
      <IsoRegistryProvider registry={registry}>
        <IsoCanvas zoom={zoom} target={target} showControls={false} showGrid registry={registry}>
          <SceneGraph objects={scene.objects} registry={registry} />
        </IsoCanvas>
      </IsoRegistryProvider>
    </main>,
  );
} else {
  createRoot(root).render(
    <main data-testid="cutaway-root" style={{ width: '100%', height: '100%' }}>
      <ProcessEditor scene={scene} onChange={() => {}} mode="run" registry={registry} />
    </main>,
  );
}
