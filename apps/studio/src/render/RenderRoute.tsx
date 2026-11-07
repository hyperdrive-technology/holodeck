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
 */

import { ISO_ENGINE_ID, ProcessEditor } from '@holodeck/editor-2.5d-react';
import { useMemo } from 'react';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { useStudio } from '../studio-context';
import { readRenderInput, RENDER_INPUT_GLOBAL } from './render-input';

const noop = () => {};

export function RenderRoute({ input: given }: { input?: Record<string, unknown> } = {}) {
  const { host } = useStudio();
  // Read once: the host sets the global before the app loads and never changes it.
  const input = useMemo(() => readRenderInput(host, given), [host, given]);
  const root = { 'data-testid': 'render', 'data-render-input': input.kind, className: 'relative flex h-full w-full flex-1 overflow-hidden bg-white' };
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
