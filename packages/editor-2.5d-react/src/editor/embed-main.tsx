/// <reference types="vite/client" />
/**
 * Browser harness for embed-render.test.ts (holodeck#34): ProcessEditor inside
 * host layouts like the ones that broke it (core#69's Logic split), with a GLB
 * part so the rendered signal has an asset to wait for.
 *
 * URL params:
 *   layout=flex   app shell: header + nav + tab strip, and the editor in a flex
 *                 item that does NOT set min-height: 0 (the sloppy-host case)
 *   layout=box    a fixed 640x360 box in the middle of the page
 *   mode=run|edit
 *   empty        start empty, for first-placement fitting
 *   latePack     leave the pump unresolved until __embed.installPump()
 *   canvas       mount a standalone IsoCanvas for host-resize checks
 *   directModel  with canvas, load the public HolodeckModel in a null fallback
 *   directModel=removable  as above; __embed.removeModel() unmounts the model
 *                (holodeck#58: a removed model's load must not hold the signal)
 *   selected=id  show the inspector for this placement
 *
 * Exposes window.__embed.rendered: every revision `onRendered` reported.
 */
import { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import pumpUrl from '../../assets/models/pump.glb?url';
import { PROCESS_SCENE } from '../iso/load-process-scene';
import type { IsoSceneFile } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import { GlbPart } from '../registry/GlbPart';
import type { IsoPartDefinition } from '../registry/types';
import { ProcessEditor } from './ProcessEditor';
import { IsoCanvas } from '../iso/IsoCanvas';
import { HolodeckModel } from '../index';

const params = new URLSearchParams(location.search);
const layout = params.get('layout') ?? 'flex';
const mode = params.get('mode') === 'run' ? 'run' : 'edit';

const registry = createIsoRegistryWithBuiltins();
const pump: IsoPartDefinition = {
  id: 'embed:pump',
  label: 'Embed pump',
  category: 'Embed pack',
  footprint: { w: 2, h: 2 },
  params: {},
  model: pumpUrl,
  component: GlbPart,
};
function installPump() {
  registry.install({ id: 'embed.pack', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [pump] } });
}
if (!params.has('latePack') && !params.has('empty')) installPump();

const initial: IsoSceneFile = {
  ...PROCESS_SCENE,
  id: 'embed',
  objects: params.has('empty') ? [] : [...PROCESS_SCENE.objects, { id: 'pump-1', object: 'embed:pump', x: 10, y: 0 }],
};

const embed = {
  rendered: [] as number[],
  modelReady: false,
  renderedBeforeModel: false,
  installPump,
  removeModel: () => {},
};
(window as unknown as { __embed: typeof embed }).__embed = embed;

function Editor() {
  const [scene, setScene] = useState(initial);
  const [modelShown, setModelShown] = useState(true);
  embed.removeModel = () => setModelShown(false);
  if (params.has('canvas')) {
    return (
      <IsoCanvas registry={registry} showControls={false} onRendered={(revision) => {
        embed.rendered.push(revision);
        if (params.has('directModel') && !embed.modelReady) embed.renderedBeforeModel = true;
      }}>
        {params.has('directModel') && modelShown ? (
          <Suspense fallback={null}>
            <HolodeckModel url={pumpUrl} onReady={() => { embed.modelReady = true; }} />
          </Suspense>
        ) : null}
      </IsoCanvas>
    );
  }
  return (
    <ProcessEditor
      scene={scene}
      onChange={setScene}
      mode={mode}
      registry={registry}
      selectedId={params.get('selected') ?? undefined}
      onRendered={(revision) => embed.rendered.push(revision)}
    />
  );
}

function FlexShell() {
  // Deliberately no `min-height: 0` anywhere below the header: a flex item's
  // automatic minimum size is its content height, which is exactly how the
  // palette used to stretch the editor past the viewport.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{ height: 48, flex: 'none', background: '#f4f4f5', borderBottom: '1px solid #ddd' }}>host header</header>
      <div style={{ display: 'flex', flex: 1 }}>
        <nav style={{ width: 200, flex: 'none', background: '#fafafa', borderRight: '1px solid #ddd' }}>nav</nav>
        <section style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ height: 36, flex: 'none', borderBottom: '1px solid #ddd' }}>brewhouse.iso.json</div>
          <div data-testid="pane" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Editor />
          </div>
        </section>
      </div>
    </div>
  );
}

function BoxShell() {
  return (
    <div style={{ padding: 40 }}>
      <div data-testid="pane" style={{ width: 640, height: 360, border: '1px solid #ddd' }}>
        <Editor />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(layout === 'box' ? <BoxShell /> : <FlexShell />);
