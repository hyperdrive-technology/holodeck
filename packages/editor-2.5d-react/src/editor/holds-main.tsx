/// <reference types="vite/client" />
/**
 * Browser harness for holds-render.test.ts: every asset-loading path inside one
 * IsoCanvas, so the rendered signal's per-instance holds can be driven as a
 * matrix (component x boundary x scenario).
 *
 * URL params:
 *   component=glb|data|marks|texture|bare|owned|mixed
 *       glb   GlbPart           data  data-only DataPart (model)
 *       marks ImageMark         texture  a bare useTrackedTexture reader
 *       bare  HolodeckModel     owned    HolodeckModel ownBoundary
 *       mixed instance a is owned, instance b bare, same URL (holodeck#199)
 *   boundary=own|shared   shared: a second child of the SAME host Suspense
 *       stays suspended until __holds.releaseSibling(), so nothing in the
 *       boundary commits (no wrapper, no fallback)
 *   dup   two instances (a, b) of the same URL instead of one
 *
 * window.__holds: remove(id), releaseSibling(), committed (ids whose model
 * mounted: bare/owned/mixed only), rendered (reported revisions), and
 * renderedEarly (a frame was reported before every remaining model mounted).
 */
import { Component, Suspense, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { HOLODECK_STYLE } from '../../assets/process/style';
import pumpUrl from '../../assets/models/pump.glb?url';
import { HolodeckModel } from '../anim/HolodeckModel';
import { IsoCanvas } from '../iso/IsoCanvas';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import { DataPart } from '../registry/DataPart';
import { GlbPart } from '../registry/GlbPart';
import type { IsoPartDefinition } from '../registry/types';
import { ImageMark } from '../objects/Marks';
import { useTrackedTexture } from '../objects/assets';

const q = new URLSearchParams(location.search);
const component = q.get('component') ?? 'glb';
const shared = q.get('boundary') === 'shared';
const IMG = '/holds-img.png';
const registry = createIsoRegistryWithBuiltins();

const baseDef = { label: 'Pump', footprint: { w: 2, h: 2 }, params: {}, model: pumpUrl } satisfies Partial<IsoPartDefinition>;
const glbDef: IsoPartDefinition = { ...baseDef, id: 'holds:glb', component: GlbPart };
const dataDef: IsoPartDefinition = { ...baseDef, id: 'holds:data' };
const placement = (id: string, x: number) => ({ id, object: 'holds:pump', x, y: 0 });

const holds = {
  committed: [] as string[],
  rendered: [] as number[],
  renderedEarly: false,
  remove: (_id: string) => {},
  releaseSibling: () => {},
};
(window as unknown as { __holds: typeof holds }).__holds = holds;

const sibling = new Promise<void>((resolve) => { holds.releaseSibling = resolve; });
let siblingDone = false;
void sibling.then(() => { siblingDone = true; });
function Sibling() {
  if (!siblingDone) throw sibling;
  return null;
}

function TextureReader({ id }: { id: string }) {
  useTrackedTexture(IMG, id);
  return null;
}

/** A failed asset renders nothing, like the product's AssetBoundary but without its warning dedupe. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

const modelOf = (id: string) => (id === 'a' && component === 'mixed') || component === 'owned' ? 'owned' : 'bare';

function Instance({ id, x }: { id: string; x: number }) {
  const common = { placement: placement(id, x), params: {}, style: HOLODECK_STYLE, selected: false };
  switch (component) {
    case 'glb': return <GlbPart {...common} def={glbDef} />;
    case 'data': return <DataPart {...common} def={dataDef} />;
    case 'marks': return <ImageMark owner={id} x={x} z={0} src={IMG} width={1} height={0} orient="flat" />;
    case 'texture': return <TextureReader id={id} />;
    default:
      return (
        <HolodeckModel
          url={pumpUrl}
          instanceKey={id}
          position={[x, 0, 0]}
          ownBoundary={modelOf(id) === 'owned'}
          onReady={() => { holds.committed.push(id); }}
        />
      );
  }
}

const isModel = ['bare', 'owned', 'mixed'].includes(component);

function Harness() {
  const [ids, setIds] = useState(q.has('dup') || component === 'mixed' ? ['a', 'b'] : ['a']);
  holds.remove = (id) => setIds((current) => current.filter((i) => i !== id));
  return (
    <div style={{ width: 640, height: 360 }} data-testid="pane">
      <IsoCanvas
        registry={registry}
        showControls={false}
        onRendered={(revision) => {
          holds.rendered.push(revision);
          if (isModel && ids.some((id) => !holds.committed.includes(id))) holds.renderedEarly = true;
        }}
      >
        <Suspense fallback={null}>
          {ids.map((id, i) => (
            <Boundary key={id}>
              <Instance id={id} x={i * 3} />
            </Boundary>
          ))}
          {shared ? <Sibling /> : null}
        </Suspense>
      </IsoCanvas>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
