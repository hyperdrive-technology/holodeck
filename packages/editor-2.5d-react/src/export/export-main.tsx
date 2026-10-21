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
    /**
     * holodeck#154: queue `n` exports, let the first one start waiting for its
     * frame (one task), then unmount the editor. Resolves with how each settled.
     */
    async queueThenUnmount(n: number) {
      const exports = Array.from({ length: n }, () => editorRef.current!.exportImage({ scale: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      root.unmount();
      const settled = await Promise.allSettled(exports);
      return settled.map((r) => (r.status === 'fulfilled' ? 'ok' : `${(r.reason as Error).name}: ${(r.reason as Error).message}`));
    },
    /**
     * Two queued exports; the first export's first GPU readback is held while the
     * scene changes (a selection) and the editor unmounts, then released: the
     * capture sees a changed revision and would retry on an unmounted editor.
     * Resolves with how each settled, or 'hang' if they do not settle in time.
     */
    async changeAndUnmountDuringReadback() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proto = (window as any).GPUBuffer.prototype;
      const original = proto.mapAsync;
      let held = false;
      proto.mapAsync = function (this: unknown, ...args: unknown[]) {
        if (held) return original.apply(this, args);
        held = true;
        editorRef.current!.dispatch({ type: 'select', id: 'pump-1' });
        // Let the selection render (revision changes), finish the real map, and
        // unmount before the capture code resumes from its readback.
        return new Promise<void>((resolve) => setTimeout(resolve, 100))
          .then(() => original.apply(this, args))
          .then((value: unknown) => {
            root.unmount();
            return value;
          });
      };
      try {
        const exports = [editorRef.current!.exportImage({ scale: 1 }), editorRef.current!.exportImage({ scale: 1 })];
        const timeout = new Promise<string[]>((resolve) => setTimeout(() => resolve(['hang']), 5000));
        const settled = Promise.allSettled(exports).then((rs) => rs.map((r) => (r.status === 'fulfilled' ? 'ok' : `${(r.reason as Error).name}: ${(r.reason as Error).message}`)));
        const results = await Promise.race([settled, timeout]);
        return { held, results };
      } finally {
        proto.mapAsync = original;
      }
    },
    /**
     * holodeck#191: the retry branch of `exportImage` with the editor MOUNTED.
     * The first `changes` GPU readbacks each see a scene change (selection
     * toggles, so the revision moves) while in flight; later ones are quiet.
     * Two exports are queued so the release of the queue is observable.
     * Waits on the revision attribute, not on timers.
     */
    async changeDuringReadbacks(changes: number) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proto = (window as any).GPUBuffer.prototype;
      const original = proto.mapAsync;
      const revisionNow = () => document.querySelector('[data-holodeck-revision]')!.getAttribute('data-holodeck-revision');
      let calls = 0;
      let changed = 0;
      proto.mapAsync = async function (this: unknown, ...args: unknown[]) {
        calls++;
        if (changed < changes) {
          const before = revisionNow();
          editorRef.current!.dispatch({ type: 'select', id: changed % 2 === 0 ? 'pump-1' : null });
          changed++;
          for (let frame = 0; revisionNow() === before; frame++) {
            if (frame > 300) throw new Error('the scene change never produced a new revision');
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
        }
        return original.apply(this, args);
      };
      try {
        const settled = await Promise.allSettled([editorRef.current!.exportImage({ scale: 1 }), editorRef.current!.exportImage({ scale: 1 })]);
        const describeResult = (r: PromiseSettledResult<{ tiles: number }>) =>
          r.status === 'fulfilled' ? `ok:${r.value.tiles}` : `${(r.reason as Error).name}: ${(r.reason as Error).message}`;
        return { changed, calls, results: settled.map(describeResult) };
      } finally {
        proto.mapAsync = original;
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

const root = createRoot(document.getElementById('pane')!);
root.render(<Harness />);
