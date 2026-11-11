/**
 * `/render`: one document, drawn once, no chrome (no palette, inspector,
 * live values or provider data: params are exactly what the document says).
 * For headless capture by `@holodeck/mcp` `scene_render`.
 *
 * Signals for the capturing host (wait on these, never sleep):
 * - root `data-render-input`: `missing` | `invalid` | `ok`;
 * - when `ok`, the engine's `[data-testid="process-editor"]` carries
 *   `data-render-state` (`pending` | `ready` | `unsupported` without WebGPU).
 * Problems with the input are listed in `[data-testid="render-problems"]`.
 *
 * A model input (`data-render-input="model"`, `blender_preview`) draws one GLB
 * as a data-only part in a one-object scene, on a fresh registry holding only
 * the editor built-ins plus that part: the host's packages are not involved,
 * and the look is the default theme's, as for any library part.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { createIsoRegistryWithBuiltins, GRID_CELL_SIZE, ISO_ENGINE_ID, ProcessEditor } from '@holodeck/editor-2.5d-react';
import { useMemo } from 'react';
import type { IsoPartDefinition, IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { useStudio } from '../studio-context';
import { readRenderInput, RENDER_INPUT_GLOBAL, type RenderModel } from './render-input';

const noop = () => {};

/** Part id of the model being previewed (only ever in the preview's own registry). */
export const RENDER_MODEL_PART_ID = 'holodeck.render:model';

/** The registry and one-object scene that draw `model` (exported for tests). */
export function modelScene(model: RenderModel): { registry: ContributionRegistry; scene: IsoSceneFile } {
  const registry = createIsoRegistryWithBuiltins();
  const part: IsoPartDefinition = {
    id: RENDER_MODEL_PART_ID,
    label: model.label,
    footprint: { ...model.footprint },
    params: {},
    // Data-only part (no component): DataPart draws the GLB styled by the theme.
    model: model.url,
    defaults: { height: model.height },
    hideInPalette: true,
  };
  registry.install({ id: 'holodeck.render-model', version: '1.0.0', label: 'Model preview', contributions: { [HOLODECK_KINDS.isoPart]: [part] } });
  return { registry, scene: { id: 'render-model', name: model.label, gridCellSize: GRID_CELL_SIZE, objects: [{ id: 'model', object: RENDER_MODEL_PART_ID, x: 0, y: 0 }] } };
}

function ModelRender({ model, root }: { model: RenderModel; root: Record<string, string> }) {
  const { registry, scene } = useMemo(() => modelScene(model), [model]);
  return (
    <div {...root} data-render-input="model">
      <ProcessEditor scene={scene} onChange={noop} mode="run" chrome="canvas" registry={registry} />
    </div>
  );
}

export function RenderRoute({ input: given }: { input?: Record<string, unknown> } = {}) {
  const { host } = useStudio();
  // Read once: the host sets the global before the app loads and never changes it.
  const input = useMemo(() => readRenderInput(host, given), [host, given]);
  const root = { 'data-testid': 'render', 'data-render-input': input.kind, className: 'relative flex h-full w-full flex-1 overflow-hidden bg-white' };
  if (input.kind === 'model') return <ModelRender model={input.model} root={root} />;
  if (input.kind === 'missing') {
    return (
      <div {...root}>
        <p role="status" className="m-auto p-6 text-sm text-muted-foreground">
          Nothing to render: set <code>window.{RENDER_INPUT_GLOBAL}</code> to a holodeck.document.v1 before the page loads.
        </p>
      </div>
    );
  }
  const problems = input.kind === 'invalid' ? input.problems : input.document.engine !== ISO_ENGINE_ID ? [`engine: no viewer for "${input.document.engine}"`] : [];
  if (input.kind === 'invalid' || problems.length) {
    return (
      <div {...root} data-render-input="invalid">
        <ul data-testid="render-problems" role="alert" className="m-auto list-disc p-6 text-sm text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div {...root}>
      <ProcessEditor scene={(input.document as { body: IsoSceneFile }).body} onChange={noop} mode="run" chrome="canvas" registry={host.registry} />
    </div>
  );
}
