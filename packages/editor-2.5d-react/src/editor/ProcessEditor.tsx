import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialIsoPose, rotatePose, toggleTopDown } from '../iso/pose';
import type { IsoSceneFile } from '../iso/scene';
import type { Vector3Tuple } from 'three';
import { getDefaultIsoRegistry } from '../registry/default';
import { IsoRegistryProvider, useIsoParts } from '../registry/react';
import type { IsoInspectorSlot, IsoMetrics, IsoPartDefinition } from '../registry/types';
import { EditorLayer } from './EditorLayer';
import { clampZoom, WHEEL_ZOOM_STEP } from '../iso/pan';
import { fitView, sceneWorldBox } from './fit';
import {
  committedScene,
  createEditorState,
  editorReducer,
  selectedObject,
  type EditorHostMode,
  type EditorMode,
} from './editor-state';
import { ACCENT, BAR, FONT, MUTED, RAIL, SIDEBAR, SIDEBAR_TEXT } from './editor-styles';
import { InspectorPanel } from './InspectorPanel';
import { Palette } from './Palette';
import { ProcessSceneView, sceneTarget } from './ProcessSceneView';

export interface ProcessEditorProps {
  /** The document. Controlled: edits are reported through `onChange`; a new object here replaces the editor's copy. */
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
}

export function ProcessEditor({
  scene,
  onChange,
  mode,
  metrics,
  registry: registryProp,
  selectedId,
  onSelect,
  inspector,
}: ProcessEditorProps) {
  const registry = registryProp ?? getDefaultIsoRegistry();
  const readOnly = mode === 'run';
  const home = useMemo(() => initialIsoPose(18), []);
  const [state, dispatch] = useReducer(
    editorReducer,
    undefined,
    () => createEditorState(scene, { registry, readOnly }),
  );
  const [zoom, setZoom] = useState(20);
  const [pose, setPose] = useState(home);
  const [target, setTarget] = useState(() => sceneTarget(scene));
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
  // Scene edits never re-fit.
  const fittedSceneId = useRef<string | null>(null);
  const userMovedView = useRef(false);
  const sceneForFit = useRef(scene);
  sceneForFit.current = scene;
  useEffect(() => {
    const scene = sceneForFit.current;
    const sceneChanged = fittedSceneId.current !== scene.id;
    if (!sceneChanged && userMovedView.current) return;
    const fit = fitScene(scene);
    if (!fit) return;
    if (sceneChanged) userMovedView.current = false;
    fittedSceneId.current = scene.id;
    setZoom(fit.zoom);
    setTarget(fit.target);
    if (sceneChanged) setPose(home);
  }, [scene.id, fitScene, home]);

  // Host callbacks via refs so effects below depend only on what they watch.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const inField = Boolean((event.target as HTMLElement | null)?.closest?.('input, textarea, select'));
      if (event.code === 'Space') {
        if (inField) return;
        setSpacePan(true);
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        dispatch({ type: 'cancel' });
        return;
      }
      if (inField) {
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        dispatch({ type: 'delete' });
        return;
      }
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (event.key === 'v' || event.key === 'V') {
        dispatch({ type: 'select-mode' });
      }
      if (event.key === 'p' || event.key === 'P') {
        dispatch({ type: 'pipe-mode' });
      }
      // R = reroute (the view rotates on Q/E, so R was free). Cmd/Ctrl+R stays the browser's reload.
      if (!meta && (event.key === 'r' || event.key === 'R')) {
        dispatch({ type: 'reroute-selected' });
      }
      if (event.key === 'q' || event.key === 'Q') {
        setPose((p) => rotatePose(p, 1));
      }
      if (event.key === 'e' || event.key === 'E') {
        setPose((p) => rotatePose(p, -1));
      }
      if (event.key === 'x' || event.key === 'X') {
        setPose((p) => toggleTopDown(p, home.radius));
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpacePan(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [home.radius]);

  // IsoCanvas swaps in `grabbing` while a pan is live. Idle: `grab` wherever a
  // left drag would pan (all of Run mode; empty floor in Edit/select), the
  // default arrow over objects you can drag, a crosshair while placing.
  const cursor =
    state.mode === 'select' && state.drag
      ? 'grabbing'
      : spacePan || readOnly
        ? 'grab'
        : state.mode === 'place' || state.mode === 'draw-pipe'
          ? 'crosshair'
          : overObject
            ? 'default'
            : 'grab';

  /** Any user zoom / pan / rotate: the view is theirs and stops auto-fitting until "fit". */
  const userZoom = (z: number) => {
    userMovedView.current = true;
    setZoom(z);
  };
  const userTarget = (t: Vector3Tuple) => {
    userMovedView.current = true;
    setTarget(t);
  };

  return (
    <IsoRegistryProvider registry={registry}>
      <div
        data-testid="process-editor"
        data-mode={state.mode}
        data-host-mode={mode}
        data-cursor={state.cursor ? `${state.cursor.x},${state.cursor.y}` : ''}
        data-pipe-start={state.pipeStart ? `${state.pipeStart.x},${state.pipeStart.y}` : ''}
        data-object-count={String(state.scene.objects.length)}
        data-zoom={zoom.toFixed(1)}
        data-target={target.map((v) => v.toFixed(3)).join(',')}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          minHeight: 0,
          background: '#fff',
          font: FONT,
          color: '#222',
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {readOnly ? null : (
            <>
              <Rail
                mode={state.mode}
                onSelect={() => dispatch({ type: 'select-mode' })}
                onAdd={() => firstPlaceable && dispatch({ type: 'place-mode', object: firstPlaceable })}
                onPipe={() => dispatch({ type: 'pipe-mode' })}
              />
              <aside
                style={{
                  width: 280,
                  flex: 'none',
                  background: SIDEBAR,
                  color: SIDEBAR_TEXT,
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <Palette
                  registry={registry}
                  placing={state.placing}
                  drawing={state.mode === 'draw-pipe'}
                  onPick={(id) => dispatch({ type: 'place-mode', object: id })}
                />
              </aside>
            </>
          )}
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
                setPose(p);
              }}
              showControls={false}
              cursor={cursor}
              registry={registry}
            >
              <EditorLayer
                state={state}
                spacePan={spacePan}
                metrics={metrics}
                readOnly={readOnly}
                onSelectObject={(id) => dispatch({ type: 'select', id })}
                onCursor={(x, y) => dispatch({ type: 'cursor', x, y })}
                onFloorClick={(x, y) => dispatch({ type: 'floor-click', x, y })}
                onDragStart={(id, x, y) => dispatch({ type: 'drag-start', id, x, y })}
                onDragMove={(x, y) => dispatch({ type: 'drag-move', x, y })}
                onDragEnd={() => dispatch({ type: 'drag-end' })}
                onResizeStart={(id, handle) => dispatch({ type: 'resize-start', id, handle })}
                onResizeMove={(value) => dispatch({ type: 'resize-move', value })}
                onResizeEnd={() => dispatch({ type: 'resize-end' })}
                onHoverObject={setOverObject}
              />
            </ProcessSceneView>
          </div>
          {readOnly ? null : (
            <InspectorPanel
              registry={registry}
              def={selectedDef}
              selected={selected}
              slot={inspector}
              onParam={(param, value) => dispatch({ type: 'set-param', param, value })}
              onPatch={(patch) => dispatch({ type: 'patch-selected', patch })}
              onRotate={(direction) => dispatch({ type: 'rotate-selected', direction })}
              onDelete={() => dispatch({ type: 'delete' })}
            />
          )}
        </div>
        <BottomBar
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
          onFit={() => {
            userMovedView.current = false;
            const fit = fitScene(state.scene);
            setZoom(fit?.zoom ?? 20);
            setTarget(fit?.target ?? sceneTarget(state.scene));
            setPose(home);
          }}
          onRotate={(dir) => {
            userMovedView.current = true;
            setPose((p) => rotatePose(p, dir));
          }}
          onToggle2d={() => {
            userMovedView.current = true;
            setPose((p) => toggleTopDown(p, home.radius));
          }}
        />
      </div>
    </IsoRegistryProvider>
  );
}

function Rail({
  mode,
  onSelect,
  onAdd,
  onPipe,
}: {
  mode: EditorMode;
  onSelect: () => void;
  onAdd: () => void;
  onPipe: () => void;
}) {
  return (
    <div
      style={{
        width: RAIL,
        flex: 'none',
        background: '#1b2028',
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
        borderTop: '1px solid #e6e6e6',
        background: '#fafafa',
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
      <span style={{ width: 48, textAlign: 'center', color: '#666' }}>{Math.round(zoom)}</span>
      <BarBtn onClick={onZoomIn}>+</BarBtn>
      <BarBtn onClick={() => onRotate(1)}>rotate L</BarBtn>
      <BarBtn onClick={() => onRotate(-1)}>rotate R</BarBtn>
      <BarBtn onClick={onToggle2d}>{topDown ? '2.5D' : '2D'}</BarBtn>
      <span style={{ marginLeft: 'auto', color: '#888' }}>{count} items</span>
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
        border: '1px solid #ddd',
        background: disabled ? '#f3f3f3' : '#fff',
        color: disabled ? '#bbb' : '#333',
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
