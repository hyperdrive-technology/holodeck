import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Mesh, Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
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
import { stamp, type EditorState, type LinkEndName, type ResizeHandle } from './editor-state';
import { canInsertWaypoint, connectorEndPoint, linkEndPoint, waypointInsertHandles } from './connect';
import { isPlacementEditable, visibleObjects } from './layers';
import { isClickSized, marqueeHits, rectFromPoints, type ScreenRect } from './marquee';

/** Raycast override for meshes the pointer must see through (previews, a handle being dragged). */
const NO_RAYCAST = () => undefined;

/** Selection halos drawn at most (a select-all on a huge plant still shows the first N). */
const MAX_HALOS = 400;

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
 * - Edit + select mode, press on an object: that is a move drag (of the
 *   whole selection when the object is part of it); Shift+press toggles it
 *   in the selection instead.
 * - Edit + select mode, Shift+press on empty floor: a marquee selection.
 * - Edit + place / draw-pipe / draw-connector mode, any left press: that places / routes.
 * - Connector end handles (one selected connector): drag to re-anchor.
 * Run mode, empty floor in select mode, and parts on locked layers stay
 * unclaimed, so they pan. Parts on hidden layers are not drawn at all.
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
  onMarquee,
  onMarqueeSelect,
  onLinkDragStart,
  onLinkDragEnd,
  onWaypointInsert,
  onWaypointDragStart,
  onWaypointRemove,
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
  /** `additive`: Shift was held (toggle in / out of the selection). */
  onSelectObject?: (id: string, additive?: boolean) => void;
  /** Live marquee rectangle in client px (null when it ends), for the host overlay. */
  onMarquee?: (rect: ScreenRect | null) => void;
  /** Marquee released: ids whose centres fall inside. Omit to disable the marquee. */
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  /** Connector end handles (holodeck#91). Omit both to hide them. */
  onLinkDragStart?: (id: string, end: LinkEndName) => void;
  onLinkDragEnd?: () => void;
  /**
   * Connector waypoints (holodeck#112): press a "+" midpoint handle to insert
   * one (then drag it), drag a waypoint handle to move it, double-click to
   * remove it. Omit to hide the waypoint handles.
   */
  onWaypointInsert?: (id: string, index: number, x: number, y: number) => void;
  onWaypointDragStart?: (id: string, index: number) => void;
  onWaypointRemove?: (id: string, index: number) => void;
  /** Resize handles (parts with `def.resize`). Omit to hide the handles. */
  onResizeStart?: (id: string, handle: ResizeHandle) => void;
  onResizeMove?: (value: number) => void;
  onResizeEnd?: () => void;
}) {
  const registry = useIsoRegistry();
  const placing = !readOnly && (state.mode === 'place' || state.mode === 'draw-pipe' || state.mode === 'draw-connector');
  const drawn = visibleObjects(state.scene);
  const startMarquee = useMarquee(drawn, registry, onMarquee, onMarqueeSelect);

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
          if (!readOnly && !placing && event.nativeEvent.shiftKey && onMarqueeSelect) {
            claimPointer(event.nativeEvent);
            startMarquee(event.nativeEvent.clientX, event.nativeEvent.clientY);
            return;
          }
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
          objects={drawn}
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
            const target = state.scene.objects.find((o) => o.id === id);
            if (state.mode === 'select' && target && !isPlacementEditable(state.scene, target)) {
              // Locked layer: behave like empty floor (the floor catcher deselects, a drag pans).
              return;
            }
            claimPointer(event.nativeEvent);
            event.stopPropagation();
            const g = gridFromEvent(event);
            if (state.mode !== 'select') {
              onFloorClick(g.x, g.y);
              return;
            }
            if (event.nativeEvent.shiftKey) {
              onSelectObject?.(id, true);
              return;
            }
            onDragStart(id, g.x, g.y);
          }}
        />
        {!readOnly
          ? state.selectedIds.slice(0, MAX_HALOS).map((id) => {
              if (id === state.selectedId) return null;
              const o = state.scene.objects.find((p) => p.id === id);
              return o ? <SelectionHalo key={id} object={o} registry={registry} secondary /> : null;
            })
          : null}
        {state.selectedId && !readOnly
          ? (() => {
              const selected = state.scene.objects.find((o) => o.id === state.selectedId);
              const single = state.selectedIds.length <= 1;
              const isConnector = selected ? registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, selected.object)?.connector === true : false;
              return selected ? (
                <>
                  <SelectionHalo object={selected} registry={registry} />
                  {single && isConnector && onLinkDragStart && onLinkDragEnd ? (
                    <LinkHandles
                      state={state}
                      connector={selected}
                      registry={registry}
                      onStart={onLinkDragStart}
                      onEnd={onLinkDragEnd}
                      waypoints={onWaypointInsert && onWaypointDragStart && onWaypointRemove ? { insert: onWaypointInsert, drag: onWaypointDragStart, remove: onWaypointRemove } : undefined}
                    />
                  ) : null}
                  {single && onResizeStart && onResizeMove && onResizeEnd ? (
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
      {!readOnly && state.mode === 'draw-connector' && state.linkStart && state.cursor
        ? (() => {
            const from = linkEndPoint(state.scene, registry, state.linkStart);
            return from ? <FloorSegment from={from} to={state.cursor} color={HANDLE_COLOR} /> : null;
          })()
        : null}
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

/** Primary selection ring colour; other selected parts get a lighter ring. */
const HALO_PRIMARY = '#18BAE6';
const HALO_SECONDARY = '#7fd6ee';

function SelectionHalo({ object, registry, secondary = false }: { object: IsoPlacement; registry: ContributionRegistry; secondary?: boolean }) {
  const [wx, , wz] = gridToWorld(object.x, object.y);
  // Per-placement footprint so the halo follows a resized vessel's radius.
  const { w, h } = placementFootprint(registry, object);
  const r = Math.max(w, h) * 0.55;
  return (
    <mesh position={[wx, 0.03, wz]} rotation={[-Math.PI / 2, 0, 0]} name={secondary ? 'selection-halo-secondary' : 'selection-halo'}>
      <ringGeometry args={[r * (secondary ? 0.9 : 0.85), r, 24]} />
      <meshBasicMaterial color={secondary ? HALO_SECONDARY : HALO_PRIMARY} />
    </mesh>
  );
}

/** Thin flat bar on the floor between two grid points (connector draw preview). */
function FloorSegment({ from, to, color }: { from: { x: number; y: number }; to: { x: number; y: number }; color: string }) {
  const [ax, , az] = gridToWorld(from.x, from.y);
  const [bx, , bz] = gridToWorld(to.x, to.y);
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-6) return null;
  return (
    <mesh position={[(ax + bx) / 2, 0.05, (az + bz) / 2]} rotation={[-Math.PI / 2, 0, -Math.atan2(bz - az, bx - ax)]} raycast={NO_RAYCAST}>
      <planeGeometry args={[len, 0.08]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
}

/**
 * Shift+drag marquee on empty floor. Returns the start function; the live
 * rectangle goes to `onMarquee` (client px) and the hit ids to `onSelect`
 * on release. Window listeners so the drag survives leaving the canvas.
 */
function useMarquee(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  onMarquee: ((rect: ScreenRect | null) => void) | undefined,
  onSelect: ((ids: string[], additive: boolean) => void) | undefined,
): (clientX: number, clientY: number) => void {
  const get = useThree((s) => s.get);
  const latest = useRef({ objects, registry, onMarquee, onSelect });
  latest.current = { objects, registry, onMarquee, onSelect };
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return (startX: number, startY: number) => {
    cleanup.current?.();
    const start = { x: startX, y: startY };
    let rect = rectFromPoints(start, start);
    latest.current.onMarquee?.(rect);
    const move = (event: PointerEvent) => {
      rect = rectFromPoints(start, { x: event.clientX, y: event.clientY });
      latest.current.onMarquee?.(rect);
    };
    const up = () => {
      cleanup.current?.();
      latest.current.onMarquee?.(null);
      if (isClickSized(rect)) return;
      const { camera, gl } = get();
      const box = gl.domElement.getBoundingClientRect();
      const v = new Vector3();
      const toScreen = (gx: number, gy: number) => {
        const [wx, , wz] = gridToWorld(gx, gy);
        v.set(wx, 0, wz).project(camera);
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
        return { x: box.left + ((v.x + 1) / 2) * box.width, y: box.top + ((1 - v.y) / 2) * box.height };
      };
      latest.current.onSelect?.(marqueeHits(latest.current.objects, latest.current.registry, toScreen, rect), true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cleanup.current = null;
    };
  };
}

/**
 * End handles on the selected connector (holodeck#91): press a handle, move
 * (the floor / parts report the cursor cell), release to re-anchor that end
 * on the part / port under the cursor or free it on empty floor. The handle
 * being dragged follows the cursor and ignores raycasts so it never hides
 * the part underneath.
 */
function LinkHandles({
  state,
  connector,
  registry,
  onStart,
  onEnd,
  waypoints,
}: {
  state: EditorState;
  connector: IsoPlacement;
  registry: ContributionRegistry;
  onStart: (id: string, end: LinkEndName) => void;
  onEnd: () => void;
  /** Waypoint editing (holodeck#112); omit to show end handles only. */
  waypoints?: {
    insert: (id: string, index: number, x: number, y: number) => void;
    drag: (id: string, index: number) => void;
    remove: (id: string, index: number) => void;
  };
}) {
  const drag = state.linkDrag?.id === connector.id ? state.linkDrag : null;
  const dragging = drag?.end ?? null;
  const draggingVia = drag?.end === 'via' ? drag.index : null;
  useEffect(() => {
    if (!dragging) return;
    const up = () => onEnd();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [dragging, onEnd]);
  const press = (fn: () => void) => (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    claimPointer(event.nativeEvent);
    event.stopPropagation();
    fn();
  };
  const editingWaypoints = waypoints !== undefined;
  const inserts = useMemo(
    () => (editingWaypoints ? waypointInsertHandles(state.scene, registry, connector) : []),
    [editingWaypoints, state.scene, registry, connector],
  );
  const via = connector.link?.via ?? [];
  return (
    <group>
      {(['from', 'to'] as const).map((end) => {
        const live = dragging === end && state.cursor ? state.cursor : connectorEndPoint(state.scene, registry, connector, end);
        if (!live) return null;
        const [wx, , wz] = gridToWorld(live.x, live.y);
        return (
          <mesh
            key={end}
            name={`link-handle-${end}`}
            position={[wx, 0.25, wz]}
            raycast={dragging === end ? NO_RAYCAST : Mesh.prototype.raycast}
            onPointerDown={press(() => onStart(connector.id, end))}
          >
            <sphereGeometry args={[HANDLE_RADIUS * 1.2, 12, 8]} />
            <meshBasicMaterial color={dragging === end ? HANDLE_ACTIVE : HANDLE_COLOR} depthTest={false} toneMapped={false} />
          </mesh>
        );
      })}
      {waypoints
        ? via.map((p, index) => {
            const live = draggingVia === index && state.cursor ? state.cursor : p;
            const [wx, , wz] = gridToWorld(live.x, live.y);
            return (
              <mesh
                key={`via-${index}`}
                name={`waypoint-handle-${index}`}
                position={[wx, 0.25, wz]}
                raycast={draggingVia === index ? NO_RAYCAST : Mesh.prototype.raycast}
                onPointerDown={press(() => waypoints.drag(connector.id, index))}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  waypoints.remove(connector.id, index);
                }}
              >
                {/* Invisible hit sphere: the visible marker is a few px wide at normal zoom. */}
                <sphereGeometry args={[HANDLE_HIT_RADIUS, 10, 6]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
                <mesh raycast={NO_RAYCAST}>
                  <boxGeometry args={[HANDLE_RADIUS * 1.6, HANDLE_RADIUS * 1.6, HANDLE_RADIUS * 1.6]} />
                  <meshBasicMaterial color={draggingVia === index ? HANDLE_ACTIVE : HANDLE_COLOR} depthTest={false} toneMapped={false} />
                </mesh>
              </mesh>
            );
          })
        : null}
      {waypoints && !drag
        ? inserts.map(({ index, point }) => {
            const [wx, , wz] = gridToWorld(point.x, point.y);
            return (
              <mesh
                key={`insert-${index}`}
                name={`waypoint-insert-${index}`}
                position={[wx, 0.22, wz]}
                onPointerDown={press(() => {
                  // At the limit the insert is rejected and the drag would grab via[index] (holodeck#126).
                  if (!canInsertWaypoint(connector)) return;
                  // Insert (one undo step), then keep dragging the new waypoint (a second step if it moves).
                  waypoints.insert(connector.id, index, point.x, point.y);
                  waypoints.drag(connector.id, index);
                })}
              >
                <sphereGeometry args={[HANDLE_HIT_RADIUS, 10, 6]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
                <mesh raycast={NO_RAYCAST}>
                  <sphereGeometry args={[HANDLE_RADIUS * 0.8, 10, 6]} />
                  <meshBasicMaterial color={HANDLE_COLOR} transparent opacity={0.55} depthTest={false} toneMapped={false} />
                </mesh>
              </mesh>
            );
          })
        : null}
    </group>
  );
}

const HANDLE_COLOR = '#18BAE6';
const HANDLE_ACTIVE = '#ff9f1c';
const HANDLE_RADIUS = 0.14;
/** Pick radius (grid cells) of the connector end / waypoint handles; larger than the drawn marker. */
const HANDLE_HIT_RADIUS = 0.4;
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
