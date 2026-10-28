import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import { imageAspectsKey, sceneImageSrcs, subscribeImageAspects } from '../objects/image-aspect';
import { initialIsoPose, rotatePose, toggleTopDown } from '../iso/pose';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import type { Vector3Tuple } from 'three';
import { getDefaultIsoRegistry } from '../registry/default';
import { IsoRegistryProvider, useIsoParts, useIsoRegistryVersion } from '../registry/react';
import type { IsoInspectorSlot, IsoMetrics, IsoPartDefinition } from '../registry/types';
import { EditorLayer } from './EditorLayer';
import { clampZoom, WHEEL_ZOOM_STEP } from '../iso/pan';
import { renderState, useRevision } from '../iso/render-signal';
import { useWebGPUSupport } from '../iso/use-webgpu';
import { fitView, sceneWorldBox } from './fit';
import { armedPart, hostPlacingAction } from './placing-sync';
import {
  committedScene,
  createEditorState,
  editorReducer,
  selectedObject,
  selectedObjects,
  type EditorAction,
  type EditorHostMode,
  type EditorMode,
  type EditorState,
} from './editor-state';
import { CAMERA_CHANGE_DEBOUNCE_MS, cameraFromView, clampCamera, isValidCamera, poseFromCamera, sameCamera, type EditorCamera } from './camera';
import { copyObjects, parseClipboard, serializeClipboard } from './clipboard';
import { sceneLayers } from './layers';
import { LayersPanel } from './LayersPanel';
import type { ScreenRect } from './marquee';
import { matchShortcut, type ShortcutId } from './shortcuts';
import { ShortcutHelp } from './ShortcutHelp';
import {
  ACCENT,
  BAR,
  BAR_BG,
  BAR_BORDER,
  BAR_BTN_BG,
  BAR_BTN_BORDER,
  BAR_BTN_DISABLED_BG,
  BAR_BTN_DISABLED_TEXT,
  BAR_BTN_TEXT,
  BAR_MUTED,
  CANVAS_BG,
  CANVAS_TEXT,
  FONT,
  MUTED,
  PANEL,
  RAIL,
  RAIL_BG,
  SIDEBAR,
  SIDEBAR_TEXT,
} from './editor-styles';
import { InspectorPanel } from './InspectorPanel';
import { Palette } from './Palette';
import { ProcessSceneView, sceneTarget } from './ProcessSceneView';
import { ImageExportError, SceneChangedError, type ExportedImage, type ImageExportOptions, type IsoCanvasCapture } from '../export/capture';

/** Which built-in panels `ProcessEditor` draws in edit mode (holodeck#100). All default to true. */
export interface ProcessEditorChrome {
  /** Tool rail (add / select / pipe / connector). */
  rail?: boolean;
  /** Part palette (left sidebar, "Parts" tab). */
  palette?: boolean;
  /** Layers list (left sidebar, "Layers" tab). */
  layers?: boolean;
  /** Right-hand inspector. */
  inspector?: boolean;
  /** Bottom toolbar (undo / redo / zoom / view). */
  bottomBar?: boolean;
}

/** Imperative access for hosts that draw their own chrome (holodeck#100). */
export interface ProcessEditorHandle {
  /** Run any editor action (align, group, copy, layers...); same rules and undo history as the built-in UI. */
  dispatch: (action: EditorAction) => void;
  /** Current editor state (selection, mode, clipboard...). A snapshot: read it when needed, don't keep it. */
  getState: () => EditorState;
  /** Current view, as `onCameraChange` reports it. */
  getCamera: () => EditorCamera;
  /**
   * High-resolution PNG of the current view (holodeck#42): the canvas size
   * times `scale`, drawn in tiles (export/tiles.ts). Selection and tool
   * overlays are hidden for the capture. Waits for the rendered signal (every
   * GLB loaded, fit and camera animation settled) instead of sleeping, so the
   * picture is deterministic. Exports run one at a time. Rejects with
   * `ImageExportError` without WebGPU or after unmount, `ExportSizeError` on
   * bad options, the signal's reason when aborted.
   */
  exportImage: (options?: ImageExportOptions) => Promise<ExportedImage>;
}

function resolveChrome(chrome: ProcessEditorProps['chrome']): Required<ProcessEditorChrome> {
  if (chrome === 'canvas') return { rail: false, palette: false, layers: false, inspector: false, bottomBar: false };
  const c = chrome === 'full' || chrome === undefined ? {} : chrome;
  return {
    rail: c.rail ?? true,
    palette: c.palette ?? true,
    layers: c.layers ?? true,
    inspector: c.inspector ?? true,
    bottomBar: c.bottomBar ?? true,
  };
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export interface ProcessEditorProps {
  /**
   * The document. Controlled: edits are reported through `onChange`; a new object here replaces the editor's copy.
   * `scene.id` is the document identity: a new id resets undo/redo, selection and in-progress tools.
   */
  scene: IsoSceneFile;
  /** Called with the new scene after each committed action (place, delete, drag end, inspector edit, undo, redo). */
  onChange: (scene: IsoSceneFile) => void;
  /** `run`: view only (no palette, inspector or drags). `edit`: full editor. */
  mode: EditorHostMode;
  /** Live param values by placement id; override `placement.params`. */
  metrics?: IsoMetrics;
  /** Parts, themes, animators, inspector panels. Default: the built-in extension only. */
  registry?: ContributionRegistry;
  /** Controlled selection. Omit to let the editor manage it. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Extra inspector content for the selection (edit mode), e.g. a host tag-binding panel. */
  inspector?: IsoInspectorSlot;
  /**
   * Called with the render revision once a presented frame shows it: the scene fitted
   * to the canvas (first load), every GLB part loaded, no camera animation running.
   * The same state is on the root element for tests and screenshot loops:
   * `data-holodeck-revision` (current), `data-holodeck-rendered` (last presented) and
   * `data-render-state` (`pending` | `ready` | `unsupported` when WebGPU is missing).
   * Wait for `[data-testid="process-editor"][data-render-state="ready"]`, never a sleep.
   * The revision increases on any change to the picture (scene, selection/drag state,
   * metrics, zoom, look-at, pose, canvas size, registry contents), so a reported revision can already be
   * stale: compare it with `data-holodeck-revision` when that matters.
   */
  onRendered?: (revision: number) => void;
  /**
   * Built-in panels in edit mode: `'full'` (default), `'canvas'` (canvas
   * only: hosts with their own library / inspector), or per panel.
   */
  chrome?: 'full' | 'canvas' | ProcessEditorChrome;
  /**
   * Controlled / initial camera. When set at mount the editor opens on it
   * instead of fitting the scene; a later value that differs from the current
   * view moves the view there. Echoing back what `onCameraChange` reported is a no-op.
   */
  camera?: EditorCamera;
  /** User zoom / pan / rotate / fit, debounced to the end of the gesture (`CAMERA_CHANGE_DEBOUNCE_MS`). */
  onCameraChange?: (camera: EditorCamera) => void;
  /**
   * Arm the place tool for a part from outside (a host library click):
   * the next floor click stamps it. `null` returns to select. Omit to leave
   * the tool to the editor.
   */
  placing?: string | null;
  /** The armed part changed inside the editor (palette pick, Escape, another tool). */
  onPlacingChange?: (partId: string | null) => void;
  /** A part was stamped by the place tool (palette or `placing`). */
  onPlaced?: (placement: IsoPlacement) => void;
  /** Controlled multi-selection (all ids). `selectedId` stays the primary (last) id. */
  selectedIds?: readonly string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Imperative handle (`dispatch`, `getState`, `getCamera`). */
  editorRef?: Ref<ProcessEditorHandle>;
  /**
   * Window keyboard shortcuts (`?` lists them). Default true; hosts with
   * their own key handling can turn them off and use `editorRef.dispatch`.
   */
  keyboard?: boolean;
}

/** How many times `exportImage` restarts a capture that live data changed under (holodeck#159). */
const EXPORT_ATTEMPTS = 3;

export function ProcessEditor({
  scene,
  onChange,
  mode,
  metrics,
  registry: registryProp,
  selectedId,
  onSelect,
  inspector,
  onRendered,
  chrome: chromeProp,
  camera,
  onCameraChange,
  placing,
  onPlacingChange,
  onPlaced,
  selectedIds,
  onSelectionChange,
  editorRef,
  keyboard = true,
}: ProcessEditorProps) {
  const registry = registryProp ?? getDefaultIsoRegistry();
  const registryVersion = useIsoRegistryVersion(registry);
  const readOnly = mode === 'run';
  const chrome = resolveChrome(chromeProp);
  const home = useMemo(() => initialIsoPose(18), []);
  const [state, dispatch] = useReducer(
    editorReducer,
    undefined,
    () => createEditorState(scene, { registry, readOnly }),
  );
  // A valid `camera` at mount wins over fit-to-scene (see the fit effect below).
  const initialCamera = useRef(isValidCamera(camera) ? clampCamera(camera) : null);
  const [zoom, setZoom] = useState(() => initialCamera.current?.zoom ?? 20);
  const [pose, setPose] = useState(() => (initialCamera.current ? poseFromCamera(initialCamera.current, home) : home));
  const [target, setTarget] = useState<Vector3Tuple>(() => initialCamera.current?.target ?? sceneTarget(scene, registry));
  const [helpOpen, setHelpOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'parts' | 'layers'>('parts');
  const [marquee, setMarquee] = useState<ScreenRect | null>(null);
  const [spacePan, setSpacePan] = useState(false);
  const [overObject, setOverObject] = useState(false);
  // Canvas size, for fit-to-scene. Null until the first layout.
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const selected = selectedObject(state);
  const selectedDef = selected
    ? registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, selected.object)
    : undefined;
  const topDown = pose.radius < 1e-3;
  const canReroute = !readOnly && Boolean(selected && (selected.object === 'pipe' || selected.object === 'elbow'));
  const parts = useIsoParts(registry);
  const firstPlaceable = parts.find((p) => !p.hideInPalette && p.draw !== 'run')?.id;

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setView((v) => (v && v.w === width && v.h === height ? v : { w: width, h: height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Zoom + look-at that frame the whole scene at the home pose; null while the canvas is unmeasured. */
  const fitScene = useCallback(
    (target: IsoSceneFile) => {
      if (!view || target.objects.length === 0) return null;
      const box = sceneWorldBox(target, (id) => registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, id));
      return fitView(box, home, view.w, view.h);
    },
    [view, registry, home],
  );

  // Fit when the scene id first appears (mount, or the host swapping documents).
  // After that, re-fit on canvas resizes (e.g. Run -> Edit adds two side panels
  // and would otherwise leave the plant clipped) only while the user has not
  // zoomed, panned or rotated: their view wins. The "fit" button resets that.
  // Scene edits never re-fit, except the first placement in an empty document.
  // A camera supplied at mount counts as "fitted" and "the user's view", so no auto-fit overrides it.
  // Image URLs in the scene at the last fit: the only ones whose late-loading aspect may refit (holodeck#127).
  const [fitImageSrcs, setFitImageSrcsState] = useState<string[]>(() => sceneImageSrcs(scene.objects));
  const setFitImageSrcs = useCallback(
    (next: string[]) => setFitImageSrcsState((prev) => (prev.length === next.length && prev.every((s, i) => s === next[i]) ? prev : next)),
    [],
  );
  const fittedSceneId = useRef<string | null>(initialCamera.current ? scene.id : null);
  // Mirrors fittedSceneId as state so the render hold below re-evaluates when a
  // fit lands even if it changed neither zoom nor target.
  const [fittedId, setFittedId] = useState<string | null>(initialCamera.current ? scene.id : null);
  const userMovedView = useRef(initialCamera.current !== null);
  const sceneForFit = useRef(scene);
  sceneForFit.current = scene;
  const hasObjects = scene.objects.length > 0;
  useEffect(() => {
    const scene = sceneForFit.current;
    const sceneChanged = fittedSceneId.current !== scene.id;
    if (!sceneChanged && userMovedView.current) return;
    const fit = fitScene(scene);
    if (!fit) return;
    if (sceneChanged) userMovedView.current = false;
    fittedSceneId.current = scene.id;
    setFittedId(scene.id);
    setZoom(fit.zoom);
    setTarget(fit.target);
    setFitImageSrcs(sceneImageSrcs(scene.objects));
    if (sceneChanged) setPose(home);
  }, [scene.id, hasObjects, fitScene, home, setFitImageSrcs]);

  // Images loading after the fit (holodeck#108): the square guess becomes the
  // real aspect and the bounds change, so refit while the view is still the
  // fitted one. Only images that were in the scene at the last fit count
  // (holodeck#127): one in another editor on the page, or one the user just
  // placed, is a scene edit and never re-fits.
  const fitAspectsSnapshot = useCallback(() => imageAspectsKey(fitImageSrcs), [fitImageSrcs]);
  const fitAspects = useSyncExternalStore(subscribeImageAspects, fitAspectsSnapshot, fitAspectsSnapshot);
  const lastFitAspects = useRef(fitAspects);
  useEffect(() => {
    if (lastFitAspects.current === fitAspects) return;
    lastFitAspects.current = fitAspects;
    const scene = sceneForFit.current;
    if (userMovedView.current || fittedSceneId.current !== scene.id) return;
    const fit = fitScene(scene);
    if (!fit) return;
    setZoom(fit.zoom);
    setTarget(fit.target);
  }, [fitAspects, fitScene]);

  // camera prop -> view (holodeck#100). Declared after the fit effect so a
  // document switch that brings its own camera lands on it, not on the fit.
  // Keyed on the value (and scene id), so an echo of onCameraChange is a no-op.
  const cameraKey = isValidCamera(camera) ? JSON.stringify(clampCamera(camera)) : '';
  const viewNow = useRef({ zoom, target, pose });
  viewNow.current = { zoom, target, pose };
  const lastReportedCamera = useRef<EditorCamera | null>(initialCamera.current);
  useEffect(() => {
    if (!cameraKey) return;
    const next = JSON.parse(cameraKey) as EditorCamera;
    const v = viewNow.current;
    lastReportedCamera.current = next;
    fittedSceneId.current = sceneForFit.current.id;
    setFittedId(sceneForFit.current.id);
    userMovedView.current = true;
    if (sameCamera(cameraFromView(v.zoom, v.target, v.pose), next)) return;
    setZoom(next.zoom);
    setTarget(next.target);
    setPose(poseFromCamera(next, home));
  }, [cameraKey, scene.id, home]);

  // view -> onCameraChange, only for user gestures, once the view has been still for a moment.
  const cameraDirty = useRef(false);
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  useEffect(() => {
    if (!cameraDirty.current) return;
    const timer = setTimeout(() => {
      cameraDirty.current = false;
      const v = viewNow.current;
      const cam = cameraFromView(v.zoom, v.target, v.pose);
      if (sameCamera(cam, lastReportedCamera.current)) return;
      lastReportedCamera.current = cam;
      onCameraChangeRef.current?.(cam);
    }, CAMERA_CHANGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [zoom, target, pose]);

  // Rendered signal (holodeck#34, render-signal.tsx). Held until the canvas is
  // measured and, for a non-empty scene, fitted: the first "ready" frame is the
  // fitted one, whatever size the host gives the editor.
  const holdRender = view === null || (scene.objects.length > 0 && fittedId !== scene.id);
  // Image export (exportImage below): the id of the export in progress, or
  // null. A fresh id per export is part of the revision, so every export waits
  // for a frame drawn with the editor overlays hidden, even two back to back.
  const [captureId, setCaptureId] = useState<number | null>(null);
  const revision = useRevision([scene, state, metrics, registry, registryVersion, readOnly, zoom, target, pose, view, holdRender, captureId]);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const [renderedRevision, setRenderedRevision] = useState<number | null>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const reportRendered = useCallback((rev: number) => {
    setRenderedRevision(rev);
    onRenderedRef.current?.(rev);
  }, []);
  const webgpu = useWebGPUSupport();
  const webgpuRef = useRef(webgpu);
  webgpuRef.current = webgpu;

  // Image export plumbing. `captureRef` reaches the R3F tree (SceneCapture);
  // waiters resolve once the frame for their export id is presented.
  const captureRef = useRef<IsoCanvasCapture | null>(null);
  type RenderWaiter = { captureId: number; resolve: () => void; reject: (reason: unknown) => void };
  const renderWaiters = useRef<RenderWaiter[]>([]);
  const nextCaptureId = useRef(1);
  const exportChain = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (webgpu === 'missing') {
      const waiting = renderWaiters.current.splice(0);
      for (const w of waiting) w.reject(new ImageExportError('image export needs WebGPU, which this browser does not provide'));
      return;
    }
    if (captureId === null || renderedRevision !== revision) return;
    const ready = renderWaiters.current.filter((w) => w.captureId === captureId);
    renderWaiters.current = renderWaiters.current.filter((w) => w.captureId !== captureId);
    for (const w of ready) w.resolve();
  }, [captureId, revision, renderedRevision, webgpu]);
  // Mounted flag for queued exports (holodeck#154): an export that starts
  // after unmount (it was queued behind one that the cleanup rejected) must
  // fail at once, not register a waiter nobody will ever settle.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const waiting = renderWaiters.current.splice(0);
      for (const w of waiting) w.reject(new ImageExportError('the editor was unmounted during an image export'));
    };
  }, []);
  const exportImage = useCallback((options: ImageExportOptions = {}): Promise<ExportedImage> => {
    const run = async (): Promise<ExportedImage> => {
      const { signal } = options;
      if (signal?.aborted) throw signal.reason ?? new DOMException('image export aborted', 'AbortError');
      if (!mounted.current) throw new ImageExportError('the editor was unmounted before this image export started');
      if (webgpuRef.current === 'missing') throw new ImageExportError('image export needs WebGPU, which this browser does not provide');
      // A live-data change mid-capture would put different revisions in different
      // tiles; capture() then throws SceneChangedError and we start again with a
      // fresh id (so the wait below really waits for the new frame), up to a limit (holodeck#159).
      for (let attempt = 1; ; attempt++) {
        // Every attempt re-checks: the editor may have unmounted (or the caller
        // cancelled) while the previous attempt's readback was in flight. A
        // waiter registered on an unmounted editor would never settle and would
        // block every queued export behind it.
        if (signal?.aborted) throw signal.reason ?? new DOMException('image export aborted', 'AbortError');
        if (!mounted.current) throw new ImageExportError('the editor was unmounted during this image export');
        const id = nextCaptureId.current++;
        try {
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              renderWaiters.current = renderWaiters.current.filter((w) => w !== waiter);
              reject(signal?.reason ?? new DOMException('image export aborted', 'AbortError'));
            };
            const settle = (fn: () => void) => {
              signal?.removeEventListener('abort', onAbort);
              fn();
            };
            const waiter: RenderWaiter = {
              captureId: id,
              resolve: () => settle(resolve),
              reject: (reason) => settle(() => reject(reason)),
            };
            renderWaiters.current.push(waiter);
            signal?.addEventListener('abort', onAbort, { once: true });
            setCaptureId(id);
          });
          const capture = captureRef.current;
          if (!mounted.current || !capture) throw new ImageExportError('the canvas is not mounted');
          return await capture.capture({ ...options, revision: () => revisionRef.current });
        } catch (error) {
          if (error instanceof SceneChangedError && !mounted.current) throw new ImageExportError('the editor was unmounted during this image export');
          if (error instanceof SceneChangedError && attempt < EXPORT_ATTEMPTS && !signal?.aborted && mounted.current) continue;
          throw error;
        } finally {
          setCaptureId((current) => (current === id ? null : current));
        }
      }
    };
    const result = exportChain.current.then(run, run);
    exportChain.current = result.catch(() => undefined);
    return result;
  }, []);

  // Host callbacks via refs so effects below depend only on what they watch.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const stateRef = useRef(state);
  stateRef.current = state;

  // Move-drag frames re-route attached pipes (follow.ts), so they are
  // coalesced to one dispatch per animation frame: only the latest pointer
  // position is applied. The drop flushes a pending frame first so it lands
  // exactly where the pointer was released. (`@tanstack/pacer` is not a
  // dependency of this package; see the note in EditorLayer.tsx.)
  const pendingMove = useRef<{ x: number; y: number; detach: boolean } | null>(null);
  const moveFrame = useRef<number | null>(null);
  const altHeld = useRef(false);
  const flushDragMove = useCallback(() => {
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }
    const move = pendingMove.current;
    pendingMove.current = null;
    if (move) dispatch({ type: 'drag-move', ...move });
  }, []);
  const queueDragMove = useCallback((x: number, y: number, detach = false) => {
    altHeld.current = detach;
    pendingMove.current = { x, y, detach };
    if (moveFrame.current === null) {
      moveFrame.current = requestAnimationFrame(() => {
        moveFrame.current = null;
        flushDragMove();
      });
    }
  }, [flushDragMove]);
  const endDrag = useCallback(() => {
    flushDragMove();
    dispatch({ type: 'drag-end' });
  }, [flushDragMove]);
  useEffect(() => () => {
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
  }, []);

  useImperativeHandle(
    editorRef,
    () => ({
      dispatch,
      getState: () => stateRef.current,
      getCamera: () => {
        const v = viewNow.current;
        return cameraFromView(v.zoom, v.target, v.pose);
      },
      exportImage,
    }),
    [exportImage],
  );

  // mode prop -> reducer guard (the guard is what makes drags no-ops in run mode).
  useEffect(() => {
    dispatch({ type: 'set-read-only', readOnly });
  }, [readOnly]);

  // scene prop -> editor. Skipped when the prop is just our own last emission echoed back.
  const lastScenePropRef = useRef(scene);
  const sceneRef = useRef(state.scene);
  sceneRef.current = state.scene;
  useEffect(() => {
    if (scene === lastScenePropRef.current) return;
    lastScenePropRef.current = scene;
    if (scene !== sceneRef.current) dispatch({ type: 'load', scene });
  }, [scene]);

  // editor -> onChange, once per committed revision.
  const prevState = useRef(state);
  useEffect(() => {
    const next = committedScene(prevState.current, state);
    prevState.current = state;
    if (next) onChangeRef.current(next);
  }, [state]);

  // selection: prop -> editor, editor -> onSelect.
  // Editor -> host fires only for changes the editor made itself (state moved
  // and no longer matches the prop). Comparing against the prop, rather than
  // against "the last value we emitted", is what stops the two directions from
  // ping-ponging when the host echoes selection back: an earlier version did
  // exactly that and hit React's "maximum update depth" on first render.
  const selectedPropRef = useRef(selectedId);
  selectedPropRef.current = selectedId;
  useEffect(() => {
    if (selectedId === undefined || selectedId === sceneSelectedRef.current) return;
    dispatch({ type: 'select', id: selectedId });
  }, [selectedId]);
  const sceneSelectedRef = useRef(state.selectedId);
  const prevSelected = useRef(state.selectedId);
  useEffect(() => {
    sceneSelectedRef.current = state.selectedId;
    if (state.selectedId === prevSelected.current) return;
    prevSelected.current = state.selectedId;
    if (state.selectedId !== selectedPropRef.current) onSelectRef.current?.(state.selectedId);
  }, [state.selectedId]);

  // Multi-selection: same prop-vs-state rule as selectedId above (no ping-pong on echo).
  const selectedIdsKey = selectedIds ? JSON.stringify(selectedIds) : null;
  const selectedIdsPropRef = useRef(selectedIds);
  selectedIdsPropRef.current = selectedIds;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    const ids = selectedIdsPropRef.current;
    if (!ids || sameIds(ids, stateRef.current.selectedIds)) return;
    dispatch({ type: 'select-many', ids });
  }, [selectedIdsKey]);
  const prevSelectedIds = useRef(state.selectedIds);
  useEffect(() => {
    if (state.selectedIds === prevSelectedIds.current) return;
    const changed = !sameIds(state.selectedIds, prevSelectedIds.current);
    prevSelectedIds.current = state.selectedIds;
    const prop = selectedIdsPropRef.current;
    if (changed && !(prop && sameIds(prop, state.selectedIds))) onSelectionChangeRef.current?.(state.selectedIds);
  }, [state.selectedIds]);

  // placing prop -> place tool; editor -> onPlacingChange / onPlaced (holodeck#100).
  // The rules (run parts arm draw-pipe with `placing: null`, echoes are not
  // disarms) live in placing-sync.ts (holodeck#133, review of #140).
  const isRun = useCallback(
    (id: string) => registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, id)?.draw === 'run',
    [registry],
  );
  const placingPropRef = useRef(placing);
  placingPropRef.current = placing;
  /** The host value the last effect run saw; undefined at mount so an initial `placing` arms. */
  const prevHostPlacing = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevHostPlacing.current;
    prevHostPlacing.current = placing;
    const action = hostPlacingAction(prev, placing, stateRef.current, isRun);
    if (action) dispatch(action);
    // isRun is read at the moment of the change; a registry swap alone arms nothing.
  }, [placing]);
  const onPlacingChangeRef = useRef(onPlacingChange);
  onPlacingChangeRef.current = onPlacingChange;
  const reportedArmed = useRef<string | null>(armedPart(state, placing, isRun));
  useEffect(() => {
    const host = placingPropRef.current;
    const armed = armedPart(state, host, isRun);
    if (armed === reportedArmed.current) return;
    reportedArmed.current = armed;
    // Report only what the host does not already hold (no echo of its own value).
    if (armed !== (host ?? null)) onPlacingChangeRef.current?.(armed);
  }, [state.placing, state.mode, isRun]);
  const onPlacedRef = useRef(onPlaced);
  onPlacedRef.current = onPlaced;
  useEffect(() => {
    if (!state.placed) return;
    const placement = state.scene.objects.find((o) => o.id === state.placed);
    if (placement) onPlacedRef.current?.(placement);
  }, [state.placed, state.scene]);

  // One handler per shortcut id; the table (shortcuts.ts) maps keys to ids and feeds the help overlay.
  const fitRef = useRef<() => void>(() => {});
  const pendingPaste = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardText = useRef<string | null>(null);
  const keyboardCut = useRef(false);
  const runShortcut = useCallback((id: ShortcutId): boolean => {
    const s = stateRef.current;
    const nudge = (dx: number, dy: number) => dispatch({ type: 'nudge', dx, dy });
    switch (id) {
      case 'select-tool': dispatch({ type: 'select-mode' }); return true;
      case 'pipe-tool': dispatch({ type: 'pipe-mode' }); return true;
      case 'connector-tool': dispatch({ type: 'connector-mode' }); return true;
      case 'cancel':
        // Esc: leave a tool / drop an in-flight gesture first; in plain select mode it clears the selection.
        if (s.mode === 'select' && !s.drag && !s.resize && !s.linkDrag) dispatch({ type: 'select', id: null });
        else dispatch({ type: 'cancel' });
        return true;
      case 'undo': dispatch({ type: 'undo' }); return true;
      case 'redo': dispatch({ type: 'redo' }); return true;
      case 'delete': dispatch({ type: 'delete' }); return true;
      case 'select-all': dispatch({ type: 'select-all' }); return true;
      case 'copy': dispatch({ type: 'copy' }); return true;
      case 'cut': dispatch({ type: 'cut' }); return true;
      case 'paste':
        // The native 'paste' event (below) may bring system-clipboard parts; it cancels this fallback.
        if (pendingPaste.current) clearTimeout(pendingPaste.current);
        pendingPaste.current = setTimeout(() => {
          pendingPaste.current = null;
          dispatch({ type: 'paste' });
        }, 0);
        return true;
      case 'duplicate': dispatch({ type: 'duplicate' }); return true;
      case 'group': dispatch({ type: 'group-selected' }); return true;
      case 'ungroup': dispatch({ type: 'ungroup-selected' }); return true;
      case 'rotate-left': dispatch({ type: 'rotate-selected', direction: 1 }); return true;
      case 'rotate-right': dispatch({ type: 'rotate-selected', direction: -1 }); return true;
      case 'nudge-left': nudge(-1, 0); return true;
      case 'nudge-right': nudge(1, 0); return true;
      case 'nudge-up': nudge(0, -1); return true;
      case 'nudge-down': nudge(0, 1); return true;
      case 'nudge-left-5': nudge(-5, 0); return true;
      case 'nudge-right-5': nudge(5, 0); return true;
      case 'nudge-up-5': nudge(0, -5); return true;
      case 'nudge-down-5': nudge(0, 5); return true;
      case 'bring-forward': dispatch({ type: 'z-order', to: 'forward' }); return true;
      case 'send-backward': dispatch({ type: 'z-order', to: 'backward' }); return true;
      case 'bring-to-front': dispatch({ type: 'z-order', to: 'front' }); return true;
      case 'send-to-back': dispatch({ type: 'z-order', to: 'back' }); return true;
      case 'reroute': dispatch({ type: 'reroute-selected' }); return true;
      case 'view-rotate-left':
        cameraDirty.current = true;
        userMovedView.current = true;
        setPose((p) => rotatePose(p, 1));
        return true;
      case 'view-rotate-right':
        cameraDirty.current = true;
        userMovedView.current = true;
        setPose((p) => rotatePose(p, -1));
        return true;
      case 'toggle-2d':
        cameraDirty.current = true;
        userMovedView.current = true;
        setPose((p) => toggleTopDown(p, home.radius));
        return true;
      case 'fit': fitRef.current(); return true;
      case 'help': setHelpOpen((open) => !open); return true;
      default: {
        const _never: never = id;
        return _never;
      }
    }
  }, [home.radius]);

  useEffect(() => {
    if (!keyboard) return;
    // Pressing / releasing Alt mid-drag switches follow <-> detach without waiting for the pointer to move.
    const toggleDetach = (detach: boolean) => {
      const s = stateRef.current;
      if (!s.drag || !s.cursor || altHeld.current === detach) return;
      altHeld.current = detach;
      pendingMove.current = null;
      dispatch({ type: 'drag-move', x: s.cursor.x, y: s.cursor.y, detach });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        if (stateRef.current.drag) event.preventDefault(); // no menu-bar focus on Windows mid-drag
        toggleDetach(true);
        return;
      }
      const inField = Boolean((event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]'));
      if (event.code === 'Space') {
        if (inField) return;
        setSpacePan(true);
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape' && helpOpenRef.current) {
        setHelpOpen(false);
        return;
      }
      if (inField) {
        // Escape in an inspector field only drops the tool / gesture (it never clears the selection under the field).
        if (event.key === 'Escape') dispatch({ type: 'cancel' });
        return;
      }
      const shortcut = matchShortcut(event);
      if (!shortcut) return;
      // Run mode: only view shortcuts, copy and Escape (the reducer ignores edits anyway).
      if (readOnlyRef.current && shortcut.group !== 'View' && shortcut.id !== 'copy' && shortcut.id !== 'cancel') return;
      // Leave Cmd/Ctrl+C alone while the user has text selected on the page.
      if (shortcut.id === 'copy' && (stateRef.current.selectedIds.length === 0 || hasTextSelection())) return;
      if ((shortcut.id === 'cut' || shortcut.id === 'duplicate' || shortcut.id === 'select-all') && hasTextSelection()) return;
      if (shortcut.id === 'copy' || shortcut.id === 'cut') {
        // Snapshot for the native copy / cut event that follows this keydown:
        // by then a cut has already removed the parts from the state.
        const s = stateRef.current;
        clipboardText.current = s.selectedIds.length ? serializeClipboard(copyObjects(s.scene, new Set(s.selectedIds), s.registry)) : null;
        // The keydown already cut: the native 'cut' event it triggers must not delete again.
        keyboardCut.current = shortcut.id === 'cut';
        setTimeout(() => {
          clipboardText.current = null;
          keyboardCut.current = false;
        }, 0);
      }
      // Copy / cut / paste keep the browser default so the native clipboard
      // event fires: onCopy writes the parts, onPaste reads parts copied in
      // another tab. preventDefault on Mod+V suppressed the paste event, so a
      // cross-tab paste did nothing or pasted stale editor contents (PR #114 review).
      const native = shortcut.id === 'copy' || shortcut.id === 'cut' || shortcut.id === 'paste';
      if (runShortcut(shortcut.id) && !native) event.preventDefault();
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') toggleDetach(false);
      if (event.code === 'Space') {
        setSpacePan(false);
      }
    };
    // System clipboard: copy / cut write the parts as JSON text so they paste
    // into another editor (tab, document); paste reads them back. The editor
    // clipboard (state.clipboard) is the fallback when the text is anything else.
    const inField = (event: Event) => Boolean((event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]'));
    const onCopy = (event: ClipboardEvent) => {
      if (inField(event) || hasTextSelection() || !event.clipboardData) return;
      const s = stateRef.current;
      const text = clipboardText.current
        ?? (s.selectedIds.length ? serializeClipboard(copyObjects(s.scene, new Set(s.selectedIds), s.registry)) : null);
      clipboardText.current = null;
      if (!text) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    };
    // Native cut with no keydown (browser Edit > Cut, a context menu): write
    // the parts like copy, then cut them here (holodeck#123: it used to copy
    // without deleting, so a later paste duplicated them).
    const onCut = (event: ClipboardEvent) => {
      const fromKeyboard = keyboardCut.current;
      keyboardCut.current = false;
      const canCut = !fromKeyboard && !readOnlyRef.current && !inField(event) && !hasTextSelection() && stateRef.current.selectedIds.length > 0;
      onCopy(event);
      if (canCut) dispatch({ type: 'cut' });
    };
    const onPaste = (event: ClipboardEvent) => {
      if (inField(event) || readOnlyRef.current) return;
      const parts = parseClipboard(event.clipboardData?.getData('text/plain') ?? '');
      if (!parts) return;
      if (pendingPaste.current) {
        clearTimeout(pendingPaste.current);
        pendingPaste.current = null;
      }
      event.preventDefault();
      dispatch({ type: 'paste', objects: parts });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
      if (pendingPaste.current) clearTimeout(pendingPaste.current);
    };
  }, [keyboard, runShortcut]);
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  // IsoCanvas swaps in `grabbing` while a pan is live. Idle: `grab` wherever a
  // left drag would pan (all of Run mode; empty floor in Edit/select), the
  // default arrow over objects you can drag, a crosshair while placing.
  const cursor =
    state.mode === 'select' && (state.drag || state.linkDrag)
      ? 'grabbing'
      : spacePan || readOnly
        ? 'grab'
        : state.mode === 'place' || state.mode === 'draw-pipe' || state.mode === 'draw-connector' || marquee
          ? 'crosshair'
          : overObject
            ? 'default'
            : 'grab';

  /** Any user zoom / pan / rotate: the view is theirs and stops auto-fitting until "fit". */
  const userZoom = (z: number) => {
    userMovedView.current = true;
    cameraDirty.current = true;
    setZoom(z);
  };
  const userTarget = (t: Vector3Tuple) => {
    userMovedView.current = true;
    cameraDirty.current = true;
    setTarget(t);
  };
  const fitNow = () => {
    userMovedView.current = false;
    cameraDirty.current = true;
    const fit = fitScene(state.scene);
    if (fit) {
      fittedSceneId.current = state.scene.id;
      setFittedId(state.scene.id);
      setFitImageSrcs(sceneImageSrcs(state.scene.objects));
    }
    setZoom(fit?.zoom ?? 20);
    setTarget(fit?.target ?? sceneTarget(state.scene, registry));
    setPose(home);
  };
  fitRef.current = fitNow;
  const act = useCallback((action: EditorAction) => dispatch(action), []);
  const linkDragEnd = useCallback(() => dispatch({ type: 'link-drag-end' }), []);
  const selection = selectedObjects(state);
  const layers = sceneLayers(state.scene);
  const showSidebar = !readOnly && (chrome.palette || chrome.layers);
  // Marquee overlay is drawn in the view's own coordinates.
  const viewBox = marquee ? viewRef.current?.getBoundingClientRect() : undefined;

  return (
    <IsoRegistryProvider registry={registry}>
      <div
        data-testid="process-editor"
        data-mode={state.mode}
        data-host-mode={mode}
        data-cursor={state.cursor ? `${state.cursor.x},${state.cursor.y}` : ''}
        data-pipe-start={state.pipeStart ? `${state.pipeStart.x},${state.pipeStart.y}` : ''}
        data-object-count={String(state.scene.objects.length)}
        data-selected-ids={state.selectedIds.join(',')}
        data-layer-count={String(layers.length)}
        data-zoom={zoom.toFixed(1)}
        data-target={target.map((v) => v.toFixed(3)).join(',')}
        data-holodeck-revision={revision}
        data-holodeck-rendered={renderedRevision ?? ''}
        data-render-state={renderState(revision, renderedRevision, webgpu !== 'missing')}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          // Never grow past the host's box. Without this, a host that lays the
          // editor out as a flex/grid item (min-height: auto) let the palette's
          // full content height stretch the editor past its pane (core#69:
          // 1136 px editor in a 900 px viewport, scene fitted to the overflow).
          // overflow: hidden makes the automatic minimum size 0; the palette and
          // inspector scroll inside instead.
          overflow: 'hidden',
          position: 'relative',
          boxSizing: 'border-box',
          background: CANVAS_BG,
          font: FONT,
          color: CANVAS_TEXT,
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {readOnly || !chrome.rail ? null : (
            <Rail
              mode={state.mode}
              onSelect={() => dispatch({ type: 'select-mode' })}
              onAdd={() => firstPlaceable && dispatch({ type: 'place-mode', object: firstPlaceable })}
              onPipe={() => dispatch({ type: 'pipe-mode' })}
              onConnect={() => dispatch({ type: 'connector-mode' })}
            />
          )}
          {showSidebar ? (
            <aside
              style={{
                width: PANEL,
                flex: 'none',
                background: SIDEBAR,
                color: SIDEBAR_TEXT,
                position: 'relative',
                minHeight: 0,
              }}
            >
              <div style={{ ...FILL, flexDirection: 'column' }}>
                {chrome.palette && chrome.layers ? (
                  <div role="tablist" aria-label="Sidebar" style={{ display: 'flex', flex: 'none', borderBottom: `1px solid ${RAIL_BG}` }}>
                    {(['parts', 'layers'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={sideTab === tab}
                        onClick={() => setSideTab(tab)}
                        style={{
                          flex: 1,
                          padding: '8px 0',
                          border: 0,
                          borderBottom: `2px solid ${sideTab === tab ? ACCENT : 'transparent'}`,
                          background: 'transparent',
                          color: sideTab === tab ? SIDEBAR_TEXT : MUTED,
                          font: FONT,
                          cursor: 'pointer',
                          textTransform: 'capitalize',
                        }}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                  <div style={FILL}>
                    {chrome.palette && (sideTab === 'parts' || !chrome.layers) ? (
                      <Palette
                        registry={registry}
                        placing={state.placing}
                        drawing={state.mode === 'draw-pipe'}
                        onPick={(id) => dispatch({ type: 'place-mode', object: id })}
                      />
                    ) : (
                      <LayersPanel scene={state.scene} activeLayer={state.activeLayer} hasSelection={state.selectedIds.length > 0} onAction={act} />
                    )}
                  </div>
                </div>
              </div>
            </aside>
          ) : null}
          <div ref={viewRef} style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
            {state.notice ? (
              <div
                role="status"
                data-testid="editor-notice"
                style={{
                  position: 'absolute',
                  top: 10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1,
                  padding: '6px 12px',
                  borderRadius: 4,
                  background: SIDEBAR,
                  color: SIDEBAR_TEXT,
                  border: `1px solid ${ACCENT}`,
                  font: FONT,
                  pointerEvents: 'none',
                }}
              >
                {state.notice}
              </div>
            ) : null}
            {marquee && viewBox ? (
              <div
                data-testid="marquee"
                style={{
                  position: 'absolute',
                  zIndex: 2,
                  left: marquee.left - viewBox.left,
                  top: marquee.top - viewBox.top,
                  width: marquee.right - marquee.left,
                  height: marquee.bottom - marquee.top,
                  border: `1px dashed ${ACCENT}`,
                  background: 'rgba(24, 186, 230, 0.08)',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
            <div style={FILL}>
            <ProcessSceneView
              scene={state.scene}
              zoom={zoom}
              onZoomChange={userZoom}
              target={target}
              onTargetChange={userTarget}
              forcePan={spacePan}
              pose={pose}
              onPoseChange={(p) => {
                userMovedView.current = true;
                cameraDirty.current = true;
                setPose(p);
              }}
              showControls={false}
              cursor={cursor}
              registry={registry}
              revision={revision}
              holdRender={holdRender}
              onRendered={reportRendered}
              captureRef={captureRef}
            >
              <EditorLayer
                state={state}
                spacePan={spacePan}
                metrics={metrics}
                readOnly={readOnly || captureId !== null}
                onSelectObject={(id, additive) => dispatch({ type: 'select', id, additive })}
                onCursor={(x, y) => dispatch({ type: 'cursor', x, y })}
                onFloorClick={(x, y) => dispatch({ type: 'floor-click', x, y })}
                onDragStart={(id, x, y) => dispatch({ type: 'drag-start', id, x, y })}
                onDragMove={queueDragMove}
                onDragEnd={endDrag}
                onResizeStart={(id, handle) => dispatch({ type: 'resize-start', id, handle })}
                onResizeMove={(value) => dispatch({ type: 'resize-move', value })}
                onResizeEnd={() => dispatch({ type: 'resize-end' })}
                onHoverObject={setOverObject}
                onMarquee={setMarquee}
                onMarqueeSelect={(ids, additive) => dispatch({ type: 'select-many', ids, additive })}
                onLinkDragStart={(id, end) => dispatch({ type: 'link-drag-start', id, end })}
                onLinkDragEnd={linkDragEnd}
                onWaypointInsert={(id, index, x, y) => dispatch({ type: 'waypoint-insert', id, index, x, y })}
                onWaypointDragStart={(id, index) => dispatch({ type: 'link-drag-start', id, end: 'via', index })}
                onWaypointRemove={(id, index) => dispatch({ type: 'waypoint-remove', id, index })}
              />
            </ProcessSceneView>
            </div>
          </div>
          {readOnly || !chrome.inspector ? null : (
            <div style={{ width: PANEL, flex: 'none', position: 'relative', minHeight: 0 }}>
              <div style={FILL}>
                <InspectorPanel
                  registry={registry}
                  def={selectedDef}
                  selected={selected}
                  selection={selection}
                  layers={layers}
                  onAction={act}
                  slot={inspector}
                  onParam={(param, value) => dispatch({ type: 'set-param', param, value })}
                  onPatch={(patch) => dispatch({ type: 'patch-selected', patch })}
                  onRotate={(direction) => dispatch({ type: 'rotate-selected', direction })}
                  onDelete={() => dispatch({ type: 'delete' })}
                />
              </div>
            </div>
          )}
        </div>
        {helpOpen ? <ShortcutHelp onClose={() => setHelpOpen(false)} /> : null}
        {chrome.bottomBar ? <BottomBar
          zoom={zoom}
          readOnly={readOnly}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          topDown={topDown}
          canReroute={canReroute}
          onReroute={() => dispatch({ type: 'reroute-selected' })}
          count={state.scene.objects.length}
          onNew={() => dispatch({ type: 'new-document' })}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onZoomIn={() => userZoom(clampZoom(zoom * WHEEL_ZOOM_STEP))}
          onZoomOut={() => userZoom(clampZoom(zoom / WHEEL_ZOOM_STEP))}
          onFit={fitNow}
          onRotate={(dir) => {
            userMovedView.current = true;
            cameraDirty.current = true;
            setPose((p) => rotatePose(p, dir));
          }}
          onToggle2d={() => {
            userMovedView.current = true;
            cameraDirty.current = true;
            setPose((p) => toggleTopDown(p, home.radius));
          }}
          onHelp={() => setHelpOpen((open) => !open)}
        /> : null}
      </div>
    </IsoRegistryProvider>
  );
}

function hasTextSelection(): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return Boolean(sel && !sel.isCollapsed && sel.toString().length > 0);
}

/**
 * Fills a `position: relative` parent without contributing to its intrinsic
 * size: the palette list, inspector and canvas then never push the editor
 * taller than the box its host gave it (core#69). Row flex so a single child
 * stretches to the full height and scrolls inside.
 */
const FILL = { position: 'absolute', inset: 0, display: 'flex' } as const;

function Rail({
  mode,
  onSelect,
  onAdd,
  onPipe,
  onConnect,
}: {
  mode: EditorMode;
  onSelect: () => void;
  onAdd: () => void;
  onPipe: () => void;
  onConnect: () => void;
}) {
  return (
    <div
      style={{
        width: RAIL,
        flex: 'none',
        background: RAIL_BG,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      <RailBtn label="Add" active={mode === 'place'} onClick={onAdd}>
        +
      </RailBtn>
      <RailBtn label="Select" active={mode === 'select'} onClick={onSelect}>
        ▤
      </RailBtn>
      <RailBtn label="Pipe" active={mode === 'draw-pipe'} onClick={onPipe}>
        /
      </RailBtn>
      <RailBtn label="Connector" active={mode === 'draw-connector'} onClick={onConnect}>
        ⤳
      </RailBtn>
    </div>
  );
}

function RailBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        height: RAIL,
        border: 0,
        background: active ? SIDEBAR : 'transparent',
        color: active ? ACCENT : MUTED,
        font: '20px/1 system-ui, sans-serif',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function BottomBar({
  zoom,
  canUndo,
  canRedo,
  topDown,
  canReroute,
  count,
  readOnly,
  onReroute,
  onNew,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  onRotate,
  onToggle2d,
  onHelp,
}: {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  topDown: boolean;
  canReroute: boolean;
  count: number;
  readOnly: boolean;
  onReroute: () => void;
  onNew: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onRotate: (direction: 1 | -1) => void;
  onToggle2d: () => void;
  onHelp: () => void;
}) {
  return (
    <div
      style={{
        height: BAR,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 10px',
        borderTop: `1px solid ${BAR_BORDER}`,
        background: BAR_BG,
        font: FONT,
      }}
    >
      {readOnly ? null : (
        <>
          <BarBtn onClick={onNew}>+ new</BarBtn>
          <BarBtn onClick={onUndo} disabled={!canUndo}>
            undo
          </BarBtn>
          <BarBtn onClick={onRedo} disabled={!canRedo}>
            redo
          </BarBtn>
          <BarBtn onClick={onReroute} disabled={!canReroute} title="Reroute the selected pipe run around obstacles (R)">
            Reroute
          </BarBtn>
        </>
      )}
      <BarBtn onClick={onFit}>fit</BarBtn>
      <BarBtn onClick={onZoomOut}>−</BarBtn>
      <span style={{ width: 48, textAlign: 'center', color: BAR_MUTED }}>{Math.round(zoom)}</span>
      <BarBtn onClick={onZoomIn}>+</BarBtn>
      <BarBtn onClick={() => onRotate(1)}>rotate L</BarBtn>
      <BarBtn onClick={() => onRotate(-1)}>rotate R</BarBtn>
      <BarBtn onClick={onToggle2d}>{topDown ? '2.5D' : '2D'}</BarBtn>
      <span data-testid="item-count" style={{ marginLeft: 'auto', color: BAR_MUTED }}>
        {count} items
      </span>
      <BarBtn onClick={onHelp} title="Keyboard shortcuts (?)">
        ?
      </BarBtn>
    </div>
  );
}

function BarBtn({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1px solid ${BAR_BTN_BORDER}`,
        background: disabled ? BAR_BTN_DISABLED_BG : BAR_BTN_BG,
        color: disabled ? BAR_BTN_DISABLED_TEXT : BAR_BTN_TEXT,
        padding: '6px 10px',
        borderRadius: 4,
        cursor: disabled ? 'default' : 'pointer',
        font: FONT,
      }}
    >
      {children}
    </button>
  );
}
