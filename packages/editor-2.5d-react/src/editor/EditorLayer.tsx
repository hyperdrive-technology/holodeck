import { useEffect, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { Pipe } from '../../assets/process';
import { AREA_Y } from '../../assets/process/Area';
import { GROUND_CONTACT_EPSILON } from '../../assets/process/style';
import { SceneGraph } from '../iso/SceneGraph';
import { SceneObjectView } from '../iso/SceneObjectView';
import { gridToWorld } from '../iso/grid';
import type { IsoPlacement } from '../iso/scene';
import { claimPointer } from '../iso/use-view-pan';
import type { IsoMetrics, IsoPartDefinition } from '../registry/types';
import { placementFootprint } from '../registry/params';
import { useIsoRegistry } from '../registry/react';
import type { ContributionRegistry } from '@holodeck/sdk';
import { resolveRouteEnd } from '../routing/ports';
import { footprint, planRoute, type PlannedRoute } from './routing';
import { pointerToGrid } from './snap';
import { stamp, type EditorState, type ResizeHandle } from './editor-state';

/**
 * The invisible floor catcher sits just under the area slab (which itself
 * sits just under y = 0, see AREA_Y). If it were above the slab, R3F would
 * deliver a press to the catcher before the area object and a click on an
 * area would act twice (floor-click + area handler). The floor grid is
 * lower still and is not raycastable.
 */
const PICK_PLANE_Y = AREA_Y - GROUND_CONTACT_EPSILON;
const GROUND = new Plane(new Vector3(0, 1, 0), 0);
const hit = new Vector3();

function gridFromEvent(event: ThreeEvent<PointerEvent>): { x: number; y: number } {
  return pointerToGrid(event.point.x, event.point.z);
}

/** Catcher hits re-projected along the pointer ray onto y = 0, so the lowered plane does not shift snapping. */
function groundGridFromEvent(event: ThreeEvent<PointerEvent>): { x: number; y: number } {
  const p = event.ray.intersectPlane(GROUND, hit);
  return p ? pointerToGrid(p.x, p.z) : gridFromEvent(event);
}

/**
 * Scene input for the editor. View panning is not handled here: IsoCanvas
 * pans on any left press that no handler below claimed (`claimPointer`), and
 * on right / middle / Space presses. What this layer claims:
 * - Edit + select mode, press on an object: that is a move drag.
 * - Edit + place / draw-pipe mode, any left press: that places / routes.
 * Run mode and empty floor in select mode stay unclaimed, so they pan.
 */
export function EditorLayer({
  state,
  spacePan,
  onCursor,
  onFloorClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onHoverObject,
  metrics,
  readOnly = false,
  onSelectObject,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: {
  state: EditorState;
  spacePan: boolean;
  onCursor: (x: number, y: number) => void;
  onFloorClick: (x: number, y: number) => void;
  onDragStart: (id: string, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
  /** Pointer entered (true) or left (false) every scene object; drives the grab vs default cursor. */
  onHoverObject?: (over: boolean) => void;
  metrics?: IsoMetrics;
  /** Run mode: no ghost, halo or drags; clicking a part only reports it. */
  readOnly?: boolean;
  onSelectObject?: (id: string) => void;
  /** Resize handles (parts with `def.resize`). Omit to hide the handles. */
  onResizeStart?: (id: string, handle: ResizeHandle) => void;
  onResizeMove?: (value: number) => void;
  onResizeEnd?: () => void;
}) {
  const registry = useIsoRegistry();
  const placing = !readOnly && (state.mode === 'place' || state.mode === 'draw-pipe');

  const moveTo = (g: { x: number; y: number }) => {
    onCursor(g.x, g.y);
    onDragMove(g.x, g.y);
  };

  const handleUp = (event: ThreeEvent<PointerEvent>) => {
    onDragEnd();
    event.stopPropagation();
  };

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, PICK_PLANE_Y, 0]}
        onPointerDown={(event) => {
          if (event.button !== 0 || spacePan) {
            return;
          }
          if (placing) claimPointer(event.nativeEvent);
          const g = groundGridFromEvent(event);
          onFloorClick(g.x, g.y);
        }}
        onPointerMove={(event) => moveTo(groundGridFromEvent(event))}
        onPointerUp={handleUp}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group
        onPointerMove={(event) => moveTo(gridFromEvent(event))}
        onPointerUp={handleUp}
        onPointerOver={() => onHoverObject?.(true)}
        onPointerOut={() => onHoverObject?.(false)}
      >
        <SceneGraph
          objects={state.scene.objects}
          metrics={metrics}
          selectedId={readOnly ? null : state.selectedId}
          onObjectPointerDown={(id, event) => {
            if (event.button !== 0 || spacePan) {
              // Right / middle / Space: IsoCanvas pans. Keep the floor from also seeing it.
              event.stopPropagation();
              return;
            }
            if (readOnly) {
              // Unclaimed: a click selects, a drag also pans the view.
              onSelectObject?.(id);
              event.stopPropagation();
              return;
            }
            claimPointer(event.nativeEvent);
            event.stopPropagation();
            const g = gridFromEvent(event);
            if (state.mode !== 'select') {
              onFloorClick(g.x, g.y);
              return;
            }
            onDragStart(id, g.x, g.y);
          }}
        />
        {state.selectedId && !readOnly
          ? (() => {
              const selected = state.scene.objects.find((o) => o.id === state.selectedId);
              return selected ? (
                <>
                  <SelectionHalo object={selected} registry={registry} />
                  {onResizeStart && onResizeMove && onResizeEnd ? (
                    <ResizeHandles
                      object={selected}
                      registry={registry}
                      active={state.resize?.id === selected.id ? state.resize.handle : null}
                      onStart={onResizeStart}
                      onMove={onResizeMove}
                      onEnd={onResizeEnd}
                    />
                  ) : null}
                </>
              ) : null;
            })()
          : null}
      </group>
      {!readOnly && state.mode === 'place' && state.placing && state.cursor ? (
        <Ghost kind={state.placing} x={state.cursor.x} y={state.cursor.y} registry={registry} />
      ) : null}
      {!readOnly && state.mode === 'draw-pipe' && state.pipeStart && state.cursor ? (
        <PipePreview state={state} registry={registry} />
      ) : null}
    </group>
  );
}

function Ghost({
  kind,
  x,
  y,
  registry,
}: {
  kind: NonNullable<EditorState['placing']>;
  x: number;
  y: number;
  registry: ContributionRegistry;
}) {
  const [wx, , wz] = gridToWorld(x, y);
  const { w, h } = footprint(registry, kind);
  return (
    <group>
      <mesh position={[wx, 0.04, wz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#18BAE6" transparent opacity={0.28} />
      </mesh>
      <SceneObjectView object={stamp(registry, kind, x, y, '__ghost')} registry={registry} />
    </group>
  );
}

/** Ghost route colours: neutral grey while a clear route exists, red when only the straight-L fallback would be drawn. */
const GHOST_OK = '#95a5a6';
const GHOST_BLOCKED = '#ff3b30';

/**
 * Live route from the first click to the hovered cell. Recomputed at most once
 * per animation frame (the cleanup cancels a pending frame when the pointer
 * moves again, so only the latest cell is routed). `@tanstack/pacer` is not a
 * dependency of this package, hence requestAnimationFrame.
 */
function useGhostRoute(state: EditorState, registry: ContributionRegistry): PlannedRoute | null {
  const [plan, setPlan] = useState<PlannedRoute | null>(null);
  const { pipeStart, pipeStartHeading, cursor, scene } = state;
  const cx = cursor?.x;
  const cy = cursor?.y;
  useEffect(() => {
    if (!pipeStart || cx === undefined || cy === undefined) {
      setPlan(null);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const end = resolveRouteEnd(scene, registry, { x: cx, y: cy });
      setPlan(planRoute(scene, registry, { cell: pipeStart, heading: pipeStartHeading ?? undefined }, end));
    });
    return () => cancelAnimationFrame(frame);
  }, [scene, registry, pipeStart, pipeStartHeading, cx, cy]);
  return plan;
}

function PipePreview({ state, registry }: { state: EditorState; registry: ContributionRegistry }) {
  const plan = useGhostRoute(state, registry);
  if (!plan) {
    return null;
  }
  const band = plan.noRoute ? GHOST_BLOCKED : GHOST_OK;
  return (
    <group>
      {plan.pipes.map((pipe, i) => {
        const [wx, , wz] = gridToWorld(pipe.x, pipe.y);
        const [tx, , tz] = gridToWorld(pipe.toX, pipe.toY);
        return <Pipe key={i} from={[wx, wz]} to={[tx, tz]} band={band} />;
      })}
      {plan.bends.map((b, i) => (
        <SelectionHalo key={i} object={{ id: `elbow-preview-${i}`, object: 'elbow', x: b.x, y: b.y }} registry={registry} />
      ))}
    </group>
  );
}

function SelectionHalo({ object, registry }: { object: IsoPlacement; registry: ContributionRegistry }) {
  const [wx, , wz] = gridToWorld(object.x, object.y);
  // Per-placement footprint so the halo follows a resized vessel's radius.
  const { w, h } = placementFootprint(registry, object);
  const r = Math.max(w, h) * 0.55;
  return (
    <mesh position={[wx, 0.03, wz]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r * 0.85, r, 24]} />
      <meshBasicMaterial color="#18BAE6" />
    </mesh>
  );
}

const HANDLE_COLOR = '#18BAE6';
const HANDLE_ACTIVE = '#ff9f1c';
const HANDLE_RADIUS = 0.14;
/** Screen-right in the default iso view (camera on +X+Z): world (+X, -Z). */
const SIDE_DIR: [number, number] = [Math.SQRT1_2, -Math.SQRT1_2];

const numberParam = (obj: IsoPlacement, def: IsoPartDefinition, param: string | undefined): number | null => {
  if (!param) return null;
  const v = obj.params?.[param] ?? def.params[param]?.default;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** Pointer (CSS px, relative to the canvas) -> world point on the y = 0 floor. */
function floorPoint(camera: Camera, size: { width: number; height: number }, px: number, py: number): Vector3 | null {
  const ndc = new Vector2((px / size.width) * 2 - 1, -(py / size.height) * 2 + 1);
  const ray = new Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = new Vector3();
  return ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), hit) ? hit : null;
}

/**
 * World units per CSS pixel of vertical screen motion. An orthographic
 * camera's zoom is px per world unit along its own axes; world +Y projects
 * onto screen-up by the camera up vector's Y (cos of the elevation angle,
 * ~0.816 for the true-isometric rig).
 */
export function heightPerPixel(camera: Camera): number {
  const zoom = (camera as { zoom?: number }).zoom ?? 1;
  camera.updateMatrixWorld();
  const upY = camera.matrixWorld.elements[5];
  return 1 / Math.max(1e-6, zoom * Math.max(0.05, Math.abs(upY)));
}

/**
 * Two drag handles on a resizable part: a side handle (radius) and a top
 * handle (height). The grab goes through the reducer (`resize-start`), the
 * live value comes from window pointer events so the drag survives leaving
 * the canvas, and `resize-end` commits one undo step.
 */
function ResizeHandles({
  object,
  registry,
  active,
  onStart,
  onMove,
  onEnd,
}: {
  object: IsoPlacement;
  registry: ContributionRegistry;
  active: ResizeHandle | null;
  onStart: (id: string, handle: ResizeHandle) => void;
  onMove: (value: number) => void;
  onEnd: () => void;
}) {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, object.object);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const grab = useRef<{ handle: ResizeHandle; clientY: number; value: number } | null>(null);

  useEffect(() => {
    if (!active) {
      grab.current = null;
      return;
    }
    const canvas = gl.domElement;
    const [wx, , wz] = gridToWorld(object.x, object.y);
    const move = (event: PointerEvent) => {
      const g = grab.current;
      if (!g) return;
      if (g.handle === 'radius') {
        const rect = canvas.getBoundingClientRect();
        const hit = floorPoint(camera, size, event.clientX - rect.left, event.clientY - rect.top);
        if (hit) onMove(Math.hypot(hit.x - wx, hit.z - wz));
      } else {
        onMove(g.value + (g.clientY - event.clientY) * heightPerPixel(camera));
      }
    };
    const up = () => {
      grab.current = null;
      onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [active, camera, size, gl, object.x, object.y, onMove, onEnd]);

  if (!def?.resize) return null;
  const radius = numberParam(object, def, def.resize.radius);
  const height = numberParam(object, def, def.resize.height);
  const [wx, , wz] = gridToWorld(object.x, object.y);
  const topY = def.resize.topY?.(object) ?? (height ?? 1) + 0.4;
  const start = (handle: ResizeHandle, value: number) => (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    claimPointer(event.nativeEvent);
    event.stopPropagation();
    grab.current = { handle, clientY: event.nativeEvent.clientY, value };
    onStart(object.id, handle);
  };
  return (
    <group>
      {def.resize.radius && radius !== null ? (
        <mesh
          name="resize-handle-radius"
          position={[wx + SIDE_DIR[0] * radius, Math.max(0.3, topY * 0.45), wz + SIDE_DIR[1] * radius]}
          onPointerDown={start('radius', radius)}
        >
          <sphereGeometry args={[HANDLE_RADIUS, 12, 8]} />
          <meshBasicMaterial color={active === 'radius' ? HANDLE_ACTIVE : HANDLE_COLOR} depthTest={false} toneMapped={false} />
        </mesh>
      ) : null}
      {def.resize.height && height !== null ? (
        <mesh name="resize-handle-height" position={[wx, topY, wz]} onPointerDown={start('height', height)}>
          <sphereGeometry args={[HANDLE_RADIUS, 12, 8]} />
          <meshBasicMaterial color={active === 'height' ? HANDLE_ACTIVE : HANDLE_COLOR} depthTest={false} toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}
