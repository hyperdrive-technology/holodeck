/**
 * Tiled high-resolution PNG export of an IsoCanvas (holodeck#42, lane S2).
 *
 * `SceneCapture` mounts inside the R3F `<Canvas>` (IsoCanvas does it when a
 * host passes `captureRef`) and exposes `capture()`: it renders the live scene
 * once per tile (tiles.ts) into an off-screen render target with a clone of
 * the view camera, reads each tile back and stitches them into one PNG. The
 * on-screen canvas is never resized or touched.
 *
 * Not a screenshot: callers (ProcessEditor.exportImage) first wait for the
 * rendered signal (render-signal.tsx), so every GLB is loaded and the fit /
 * camera animation has settled before the first tile is drawn. Capturing does
 * no timing of its own (no sleeps): each tile is a synchronous render + a
 * GPU readback promise.
 *
 * Colour: rendering into a plain render target would give linear
 * (working-space) values. The target is set as the renderer's OUTPUT target
 * for the duration of each tile, so three.js applies the same output
 * colour-space conversion and tone mapping it applies to the canvas: the
 * export matches what is on screen (export-render.test.ts compares them).
 */
import { useThree } from '@react-three/fiber';
import { useImperativeHandle, type Ref } from 'react';
import { Material, Object3D, RenderTarget, type Camera, type OrthographicCamera, type Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { DEFAULT_EXPORT_SCALE, DEFAULT_EXPORT_TILE_SIZE, exportLineScale, planExportTiles, unpadRows, type TilePlan } from './tiles';

export interface ImageExportOptions {
  /** Output pixels per CSS pixel of the view. Default 2 (`DEFAULT_EXPORT_SCALE`), max 8. */
  scale?: number;
  /** Tile side in px, a multiple of 64. Default 1024. */
  tileSize?: number;
  /** Cancels between tiles; the promise rejects with the signal's reason. */
  signal?: AbortSignal;
}

export interface ExportedImage {
  /** Output size in pixels. */
  width: number;
  height: number;
  /** Number of tiles drawn. */
  tiles: number;
  /** `image/png`. */
  blob: Blob;
}

/** Internal: `ImageExportOptions` plus the scene-revision probe that `ProcessEditor.exportImage` passes (holodeck#159). */
export interface CaptureOptions extends ImageExportOptions {
  /**
   * Current render revision of the live scene. Read before the first tile and
   * after every readback; a change means the tiles would show different live
   * data (seams), so the capture fails with `SceneChangedError`.
   */
  revision?: () => number;
}

/** What `IsoCanvas` exposes through `captureRef`. */
export interface IsoCanvasCapture {
  /** Draw the current scene to a PNG. Call only once the rendered signal reports the current revision. */
  capture(options?: CaptureOptions): Promise<ExportedImage>;
}

/** Export failed for a reason other than bad options (`ExportSizeError`), e.g. no 2D canvas or PNG encoding refused. */
export class ImageExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageExportError';
  }
}

/** The live scene changed (data update, edit, resize) while tiles were being captured. Retryable. */
export class SceneChangedError extends ImageExportError {
  constructor() {
    super('the scene changed while the image was being captured');
    this.name = 'SceneChangedError';
  }
}

type Line2Like = Material & { isLine2NodeMaterial?: boolean; linewidth: number };

/** Every screen-space-width line material in `scene` (fat edge outlines), once each. */
function lineMaterials(scene: Object3D): Line2Like[] {
  const found = new Set<Line2Like>();
  scene.traverse((object) => {
    const material = (object as Object3D & { material?: Material | Material[] }).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if ((m as Line2Like).isLine2NodeMaterial) found.add(m as Line2Like);
    }
  });
  return [...found];
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('image export aborted', 'AbortError');
}

/** Encodes a 2D canvas as PNG. */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageExportError('the browser could not encode the PNG (image too large?)'))), 'image/png');
  });
}

/**
 * Renders `plan` with `renderer` from `camera` and stitches the tiles into a
 * PNG. Exported for the render test harness; hosts use `ProcessEditorHandle.exportImage`.
 */
export async function renderTiledPng(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  plan: TilePlan,
  { lineScale = 1, signal, revision }: { lineScale?: number; signal?: AbortSignal; revision?: () => number } = {},
): Promise<ExportedImage> {
  const out = document.createElement('canvas');
  out.width = plan.width;
  out.height = plan.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new ImageExportError(`no 2D canvas of ${plan.width} x ${plan.height} px (out of memory?)`);
  // A clone: the live camera keeps drawing the screen between tiles (R3F's
  // frame loop runs while a readback is in flight); its view offset must
  // never change under it.
  const view = camera.clone() as OrthographicCamera;
  view.updateMatrixWorld(true);
  // Linear in, sRGB out: see the module comment. 4x MSAA like the canvas (antialias: true).
  // One frozen view of the live data: every tile must be drawn at this revision.
  const baseline = revision?.();
  const assertUnchanged = () => {
    if (revision && revision() !== baseline) throw new SceneChangedError();
  };
  const target = new RenderTarget(plan.tileSize, plan.tileSize, { samples: 4 });
  const lines = lineScale === 1 ? [] : lineMaterials(scene);
  try {
    for (const tile of plan.tiles) {
      if (signal?.aborted) throw abortReason(signal);
      assertUnchanged();
      // Synchronous from here to the readback call: no frame of the live
      // loop can run in between and see the scaled line widths or our target.
      const widths = lines.map((m) => m.linewidth);
      const previousTarget = renderer.getRenderTarget();
      const previousOutput = renderer.getOutputRenderTarget();
      let readback: Promise<unknown>;
      try {
        for (const m of lines) m.linewidth *= lineScale;
        view.setViewOffset(plan.width, plan.height, tile.x, tile.y, plan.tileSize, plan.tileSize);
        view.updateProjectionMatrix();
        renderer.setOutputRenderTarget(target);
        renderer.setRenderTarget(target);
        renderer.render(scene, view);
        // The copy is encoded and submitted inside this call (before its
        // first await), so it reads exactly the frame just drawn.
        readback = renderer.readRenderTargetPixelsAsync(target, 0, 0, plan.tileSize, plan.tileSize);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.setOutputRenderTarget(previousOutput);
        lines.forEach((m, i) => {
          m.linewidth = widths[i]!;
        });
      }
      const raw = (await readback) as Uint8Array;
      // Data may have changed while the readback was in flight (this tile is then
      // a mix of old and new); drop the capture rather than stitch a seam.
      assertUnchanged();
      const pixels = unpadRows(raw, plan.tileSize, plan.tileSize);
      // putImageData with a dirty rect crops the part of an edge tile that lies outside the picture.
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), plan.tileSize, plan.tileSize), tile.x, tile.y, 0, 0, tile.width, tile.height);
    }
  } finally {
    target.dispose();
  }
  if (signal?.aborted) throw abortReason(signal);
  const blob = await canvasToPng(out);
  // Cancelling while the PNG was encoding must not resolve: the caller downloads on resolve (holodeck#160).
  if (signal?.aborted) throw abortReason(signal);
  return { width: plan.width, height: plan.height, tiles: plan.tiles.length, blob };
}

/** Mount inside the R3F Canvas; exposes `capture()` through `captureRef`. */
export function SceneCapture({ captureRef }: { captureRef: Ref<IsoCanvasCapture | null> }) {
  const get = useThree((s) => s.get);
  useImperativeHandle(
    captureRef,
    () => ({
      capture: ({ scale = DEFAULT_EXPORT_SCALE, tileSize = DEFAULT_EXPORT_TILE_SIZE, signal, revision } = {}) => {
        // Latest state at call time (size / camera / dpr can change after mount).
        const state = get();
        const plan = planExportTiles({ viewWidth: state.size.width, viewHeight: state.size.height, scale, tileSize });
        return renderTiledPng(state.gl as unknown as WebGPURenderer, state.scene, state.camera, plan, {
          lineScale: exportLineScale(scale, state.viewport.dpr),
          signal,
          revision,
        });
      },
    }),
    [get],
  );
  return null;
}
