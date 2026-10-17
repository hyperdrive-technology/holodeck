/// <reference types="vite/client" />
/**
 * Browser harness for export-render.test.ts (holodeck#42): a ProcessEditor in
 * a fixed 640x400 pane with the process scene plus a GLB part, and
 * `window.__export` to drive `exportImage` from Playwright.
 *
 * URL params: mode=run|edit (default edit), selected=<id>.
 */
import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import pumpUrl from '../../assets/models/pump.glb?url';
import { PROCESS_SCENE } from '../iso/load-process-scene';
import type { IsoSceneFile } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import { GlbPart } from '../registry/GlbPart';
import type { IsoPartDefinition } from '../registry/types';
import { ProcessEditor, type ProcessEditorHandle } from '../editor/ProcessEditor';
import type { ImageExportOptions } from './capture';

const params = new URLSearchParams(location.search);
const registry = createIsoRegistryWithBuiltins();
const pump: IsoPartDefinition = {
  id: 'export:pump',
  label: 'Export pump',
  category: 'Export pack',
  footprint: { w: 2, h: 2 },
  params: {},
  model: pumpUrl,
  component: GlbPart,
};
registry.install({ id: 'export.pack', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [pump] } });

const scene: IsoSceneFile = { ...PROCESS_SCENE, id: 'export', objects: [...PROCESS_SCENE.objects, { id: 'pump-1', object: 'export:pump', x: 10, y: 0 }] };

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function Harness() {
  const editorRef = useRef<ProcessEditorHandle>(null);
  (window as unknown as { __export: unknown }).__export = {
    async run(options: ImageExportOptions & { abortNow?: boolean } = {}) {
      const controller = new AbortController();
      if (options.abortNow) controller.abort(new Error('aborted by test'));
      const image = await editorRef.current!.exportImage({ ...options, signal: controller.signal });
      return { width: image.width, height: image.height, tiles: image.tiles, type: image.blob.type, png: await blobToBase64(image.blob) };
    },
    async error(options: ImageExportOptions) {
      try {
        await editorRef.current!.exportImage(options);
        return null;
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
    select(id: string | null) {
      editorRef.current!.dispatch({ type: 'select', id });
    },
  };
  return (
    <ProcessEditor
      scene={scene}
      onChange={() => {}}
      mode={params.get('mode') === 'run' ? 'run' : 'edit'}
      chrome="canvas"
      registry={registry}
      editorRef={editorRef}
    />
  );
}

createRoot(document.getElementById('pane')!).render(<Harness />);
