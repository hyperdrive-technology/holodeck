import { WebGPURenderer, type WebGPURendererParameters } from 'three/webgpu';

type SwizzleTexture = {
  createView: (descriptor?: { swizzle?: string }) => unknown;
  __holodeckSwizzle?: boolean;
};

/**
 * three r186 always puts `swizzle: 'rgba'` on GPUTextureViewDescriptor.
 * Chrome 140 (Playwright 1.59's Chromium) rejects that value with
 * TypeError: not of type GPUTextureComponentSwizzle. Newer Chrome accepts
 * the string. Drop the field only after the browser has refused it once.
 *
 * This project's TypeScript DOM lib does not include the WebGPU types, so
 * the patch goes through globalThis.
 */
function tolerateTextureViewSwizzle() {
  const gpuTexture = (globalThis as { GPUTexture?: { prototype: SwizzleTexture } }).GPUTexture;
  const prototype = gpuTexture?.prototype;
  if (!prototype || prototype.__holodeckSwizzle) {
    return;
  }
  prototype.__holodeckSwizzle = true;
  const original = prototype.createView;
  let swizzleOk: boolean | null = null;
  prototype.createView = function (this: SwizzleTexture, descriptor?: { swizzle?: string }) {
    if (descriptor && 'swizzle' in descriptor && swizzleOk === false) {
      const rest = { ...descriptor };
      delete rest.swizzle;
      return original.call(this, rest);
    }
    try {
      const view = original.call(this, descriptor);
      if (descriptor && 'swizzle' in descriptor) {
        swizzleOk = true;
      }
      return view;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (descriptor && 'swizzle' in descriptor && message.includes('swizzle')) {
        swizzleOk = false;
        const rest = { ...descriptor };
        delete rest.swizzle;
        return original.call(this, rest);
      }
      throw error;
    }
  };
}

type DrawEncoder = {
  drawIndexed: (indexCount: number, instanceCount?: number, firstIndex?: number, baseVertex?: number, firstInstance?: number) => void;
  __holodeckDraw?: boolean;
};

/**
 * WebGPU drawIndexed throws if a count is Infinity, and that exception
 * aborts the frame. three's InstancedBufferGeometry still defaults
 * instanceCount to Infinity (WebGL treats that as "all"). Skip those draws.
 */
function tolerateInfiniteDraws() {
  const gpuEncoder = (globalThis as { GPURenderPassEncoder?: { prototype: DrawEncoder } }).GPURenderPassEncoder;
  const prototype = gpuEncoder?.prototype;
  if (!prototype || prototype.__holodeckDraw) {
    return;
  }
  prototype.__holodeckDraw = true;
  const original = prototype.drawIndexed;
  let warned = false;
  prototype.drawIndexed = function (indexCount, instanceCount = 1, firstIndex = 0, baseVertex = 0, firstInstance = 0) {
    if (!Number.isFinite(indexCount) || !Number.isFinite(instanceCount)) {
      if (!warned) {
        warned = true;
        console.warn('WebGPU drawIndexed skipped a non-finite count', indexCount, instanceCount);
      }
      return;
    }
    return original.call(this, indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
  };
}

/**
 * R3F 9 accepts an async `gl` factory. WebGPURenderer.init() must finish
 * before the first frame; there is no synchronous constructor.
 *
 * `forceWebGL` stays off. A WebGL fallback would silently drop TSL materials
 * (iso shade, fat edges, floor grid) and look like a blank or flat scene.
 */
export function createWebGPURenderer(props: WebGPURendererParameters) {
  tolerateTextureViewSwizzle();
  tolerateInfiniteDraws();
  const renderer = new WebGPURenderer({
    ...props,
    antialias: true,
    forceWebGL: false,
  });
  return renderer.init().then(() => renderer);
}
