/**
 * renderTiledPng with a fake renderer and canvas (no GPU): the cancel and
 * live-data-change rules around the async readback / PNG encode (holodeck#159, #160).
 * Real-GPU behaviour is covered by export-render.test.ts.
 */
import { OrthographicCamera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageExportError, renderTiledPng, SceneChangedError } from './capture';
import { planExportTiles } from './tiles';

const plan = planExportTiles({ viewWidth: 128, viewHeight: 64, scale: 1, tileSize: 64 }); // two 64px tiles

/** `encode` controls when the fake canvas finishes encoding the PNG. */
function setup({ onReadback, encode }: { onReadback?: (call: number) => void; encode?: (done: () => void) => void } = {}) {
  let readbacks = 0;
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ putImageData: () => undefined }),
      toBlob: (cb: (b: Blob | null) => void) => {
        const done = () => cb(new Blob(['png'], { type: 'image/png' }));
        if (encode) encode(done);
        else done();
      },
    }),
  });
  const renderer = {
    getRenderTarget: () => null,
    getOutputRenderTarget: () => null,
    setRenderTarget: () => undefined,
    setOutputRenderTarget: () => undefined,
    render: () => undefined,
    readRenderTargetPixelsAsync: async () => {
      onReadback?.(++readbacks);
      return new Uint8Array(64 * 64 * 4);
    },
  } as unknown as WebGPURenderer;
  const camera = new OrthographicCamera(-1, 1, 1, -1);
  return { renderer, camera, scene: new Scene(), readbackCount: () => readbacks };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderTiledPng', () => {
  it('resolves with a PNG when nothing changes', async () => {
    const { renderer, scene, camera } = setup();
    const image = await renderTiledPng(renderer, scene, camera, plan, { revision: () => 1 });
    expect(image.tiles).toBe(2);
    expect(image.blob.type).toBe('image/png');
  });

  it('rejects when cancelled while the PNG is encoding, instead of resolving into a download (holodeck#160)', async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const { renderer, scene, camera } = setup({ encode: (done) => (finish = done) });
    const result = renderTiledPng(renderer, scene, camera, plan, { signal: controller.signal });
    const settled = vi.fn();
    result.then(settled, () => undefined);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function')); // all tiles drawn, now encoding
    controller.abort(new Error('closed'));
    finish();
    await expect(result).rejects.toThrow('closed');
    expect(settled).not.toHaveBeenCalled();
  });

  it('rejects with SceneChangedError when live data changes between tile readbacks (holodeck#159)', async () => {
    let revision = 1;
    const { renderer, scene, camera, readbackCount } = setup({ onReadback: (n) => n === 1 && (revision = 2) });
    await expect(renderTiledPng(renderer, scene, camera, plan, { revision: () => revision })).rejects.toBeInstanceOf(SceneChangedError);
    expect(readbackCount()).toBe(1); // stopped before drawing a second tile
  });

  it('also detects a change during the last readback', async () => {
    let revision = 1;
    const { renderer, scene, camera } = setup({ onReadback: (n) => n === 2 && (revision = 2) });
    await expect(renderTiledPng(renderer, scene, camera, plan, { revision: () => revision })).rejects.toBeInstanceOf(ImageExportError);
  });
});

