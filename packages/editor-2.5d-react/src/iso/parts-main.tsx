/// <reference types="vite/client" />
/**
 * Parts workbench: every Blender-built GLB in `assets/models/`, styled by
 * `applyHolodeckStyle`, next to its hand-coded R3F counterpart (if any).
 *
 * Loop: `pnpm parts:watch` rebuilds a GLB when its Blender script changes;
 * the vite plugin in `vite.config.ts` full-reloads this page on GLB writes.
 */
import { Suspense, useCallback, useState, type ReactNode } from 'react';
import { Box3, Vector3, type Object3D, type Vector3Tuple } from 'three';
import { createRoot } from 'react-dom/client';
import { HolodeckModel } from '../../assets/process/HolodeckModel';
import { Valve } from '../../assets/process/Valve';
import { IsoCanvas } from './IsoCanvas';

const MODELS = import.meta.glob('../../assets/models/*.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Code-built twin per part name, for side-by-side comparison while migrating. */
const CODE_TWINS: Record<string, () => ReactNode> = {
  valve: () => <Valve position={[0, 0, 0]} />,
};

// Bust the browser/GLTFLoader cache: a rebuilt GLB keeps the same URL.
const STAMP = Date.now();

const PARTS = Object.entries(MODELS)
  .map(([file, url]) => ({ name: file.split('/').pop()!.replace(/\.glb$/, ''), url: `${url}?t=${STAMP}` }))
  .sort((a, b) => a.name.localeCompare(b.name));

const PANEL = { width: 360, height: 300 };

type Framing = { target: Vector3Tuple; zoom: number };

/**
 * Fit the orthographic camera to a part. Ortho zoom is pixels per world
 * unit; the bounding-box diagonal bounds the iso-projected width, so this
 * never clips (a 1.4-long pump overflowed the old fixed zoom of 260).
 */
function frameObject(root: Object3D): Framing {
  const box = new Box3().setFromObject(root);
  const center = box.getCenter(new Vector3());
  const diagonal = Math.max(box.getSize(new Vector3()).length(), 1e-3);
  return {
    target: [center.x, center.y, center.z],
    zoom: (Math.min(PANEL.width, PANEL.height) * 0.9) / diagonal,
  };
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <figcaption style={{ font: '12px system-ui, sans-serif', color: '#555' }}>{title}</figcaption>
      <div style={{ ...PANEL, border: '1px solid #eee' }}>{children}</div>
    </figure>
  );
}

function PartRow({ name, url, onLoaded }: { name: string; url: string; onLoaded: (name: string) => void }) {
  const [framing, setFraming] = useState<Framing | null>(null);
  const onReady = useCallback(
    (root: Object3D) => {
      setFraming(frameObject(root));
      onLoaded(name);
    },
    [name, onLoaded],
  );
  const twin = CODE_TWINS[name];
  // Both panels share the GLB's framing so they compare at the same scale.
  const view = framing ?? { target: [0, 0, 0] as Vector3Tuple, zoom: 260 };
  return (
    <section data-part={name} data-zoom={Math.round(view.zoom)}>
      <h2 style={{ font: '500 16px system-ui, sans-serif', margin: '0 0 8px' }}>{name}</h2>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Panel title="Blender GLB + style layer">
          <IsoCanvas zoom={view.zoom} target={view.target} showControls={false}>
            <Suspense fallback={null}>
              <HolodeckModel url={url} onReady={onReady} />
            </Suspense>
          </IsoCanvas>
        </Panel>
        {twin ? (
          <Panel title="Code (R3F)">
            <IsoCanvas zoom={view.zoom} target={view.target} showControls={false}>
              {twin()}
            </IsoCanvas>
          </Panel>
        ) : null}
      </div>
    </section>
  );
}

function PartsWorkbench() {
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const markLoaded = useCallback(
    (name: string) => setLoaded((prev) => (prev.has(name) ? prev : new Set(prev).add(name))),
    [],
  );

  return (
    <main
      data-testid="parts-root"
      data-part-names={PARTS.map((p) => p.name).join(',')}
      data-loaded={[...loaded].sort().join(',')}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24, font: '14px system-ui, sans-serif' }}
    >
      {PARTS.length === 0 ? <p>No GLBs in assets/models — run pnpm parts:build.</p> : null}
      {PARTS.map((part) => (
        <PartRow key={part.name} name={part.name} url={part.url} onLoaded={markLoaded} />
      ))}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}
createRoot(root).render(<PartsWorkbench />);
