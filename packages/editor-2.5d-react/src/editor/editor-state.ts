import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { getDefaultIsoRegistry } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import type { Heading } from '../routing/grid';
import { resolveRouteEnd } from '../routing/ports';
import { carryHostedParts, chainFrom, detachFrom, hostPipeOf, INLINE_PART_LENGTH, isPipePlacement, positionOnPipe, segOf, splitChainAtParts, withAttachment } from '../routing/inline';
import { headingOf, pipeArmsAt } from '../routing/elbows';
import { findRun, isInlinePart } from '../routing/run';
import { routeToPlacements, type GridPoint } from './routing';
import { sameCell } from './snap';
import { snapParamValue } from '../registry/params';

/** Which on-canvas handle a resize drag grabbed. */
export type ResizeHandle = 'radius' | 'height';

/** Shown when A* finds no clear route and the manhattan L was drawn instead. */
export const NO_ROUTE_NOTICE = 'No clear route — drew a straight L';

/** Rerouting is atomic when the carried parts cannot fit on the new run. */
export const INLINE_PARTS_NO_ROUTE_NOTICE = 'No clear route — inline parts do not fit';

export const RETAINED_CONNECTIONS_NO_ROUTE_NOTICE = 'Reroute rejected — could not verify retained connections';

/** `run` = view only; `edit` = place / drag / delete. Set by the host via `ProcessEditor`'s `mode`. */
export type EditorHostMode = 'run' | 'edit';
export type EditorMode = 'select' | 'place' | 'draw-pipe';

export interface EditorState {
  scene: IsoSceneFile;
  past: IsoSceneFile[];
  future: IsoSceneFile[];
  mode: EditorMode;
  /** Part id being stamped in `place` mode. */
  placing: string | null;
  selectedId: string | null;
  pipeStart: GridPoint | null;
  /** Required exit direction at `pipeStart` (outward port heading), or null for a bare cell. */
  pipeStartHeading: Heading | null;
  /** One-line inline message (e.g. the routing fallback). Cleared by the next non-pointer action. */
  notice: string | null;
  cursor: GridPoint | null;
  drag: { id: string; origin: IsoPlacement; grab: GridPoint } | null;
  /**
   * Live resize drag (radius / height handle). `param` is the number param
   * the handle edits, `origin` its value when the handle was grabbed, so a
   * no-op drag commits nothing and `resize-end` writes one history step.
   */
  resize: { id: string; handle: ResizeHandle; param: string; origin: number } | null;
  /**
   * Bumped by every committed change (place, delete, drag-end that moved,
   * inspector edit, undo, redo, new-document). `ProcessEditor` calls
   * `onChange` when this changes: drag-move frames and `load` do not bump it.
   */
  revision: number;
  /** Run mode: scene-mutating actions are ignored. */
  readOnly: boolean;
  registry: ContributionRegistry;
}

export type EditorAction =
  | { type: 'select-mode' }
  | { type: 'place-mode'; object: string }
  | { type: 'pipe-mode' }
  | { type: 'cursor'; x: number; y: number }
  | { type: 'floor-click'; x: number; y: number }
  | { type: 'select'; id: string | null }
  | { type: 'drag-start'; id: string; x: number; y: number }
  | { type: 'drag-move'; x: number; y: number }
  | { type: 'drag-end' }
  /** Grab a resize handle on the selection (`def.resize` names the params). */
  | { type: 'resize-start'; id: string; handle: ResizeHandle }
  /** Live value in world units; clamped and snapped to the param spec, not committed. */
  | { type: 'resize-move'; value: number }
  | { type: 'resize-end' }
  | { type: 'delete' }
  /**
   * Re-route the pipe/elbow run containing the selection around the current
   * obstacles (the run itself excluded). One undo step.
   */
  | { type: 'reroute-selected' }
  | { type: 'rotate-selected'; direction: 1 | -1 }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'new-document' }
  /** Edit one `placement.params` entry on the selection (inspector control). */
  | { type: 'set-param'; param: string; value: unknown }
  /** Merge fields onto the selection (host inspector panels). */
  | { type: 'patch-selected'; patch: Partial<IsoPlacement> }
  /**
   * Replace the scene from outside (controlled `scene` prop). Not a commit.
   * Same `scene.id`: an external update of the open document, history kept.
   * Different `scene.id`: a different document, so undo/redo and all
   * transient editing state are reset (see `loadDocument`).
   */
  | { type: 'load'; scene: IsoSceneFile }
  | { type: 'set-read-only'; readOnly: boolean }
  | { type: 'cancel' };

const HISTORY_CAP = 50;

/** Actions that only move the view / selection and are safe in run mode. */
const RUN_MODE_ACTIONS: ReadonlySet<EditorAction['type']> = new Set([
  'select',
  'cursor',
  'cancel',
  'select-mode',
  'load',
  'set-read-only',
]);

export function cloneScene(scene: IsoSceneFile): IsoSceneFile {
  return { ...scene, objects: scene.objects.map((o) => ({ ...o })) };
}

export function emptyScene(id = 'untitled'): IsoSceneFile {
  return { id, name: 'Untitled', gridCellSize: 1, objects: [] };
}

export function createEditorState(
  scene: IsoSceneFile,
  opts: { registry?: ContributionRegistry; readOnly?: boolean } = {},
): EditorState {
  return {
    scene: cloneScene(scene),
    past: [],
    future: [],
    mode: 'select',
    placing: null,
    selectedId: null,
    pipeStart: null,
    pipeStartHeading: null,
    notice: null,
    cursor: null,
    drag: null,
    resize: null,
    revision: 0,
    readOnly: opts.readOnly ?? false,
    registry: opts.registry ?? getDefaultIsoRegistry(),
  };
}

export function nextId(prefix: string, objects: readonly IsoPlacement[]): string {
  const ids = new Set(objects.map((o) => o.id));
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) {
    n += 1;
  }
  return `${prefix}-${n}`;
}

/**
 * A new placement of part `kind`: the definition's `defaults` (deep-copied
 * so two stamps never share a `params` object) over the position. Run-draw
 * parts (pipes) start two cells long. Unknown parts get a bare placement.
 */
export function stamp(
  registry: ContributionRegistry,
  kind: string,
  x: number,
  y: number,
  id: string,
): IsoPlacement {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, kind);
  const defaults = def?.defaults ? structuredClone(def.defaults) : {};
  const run = def?.draw === 'run' ? { toX: x + 2, toY: y } : {};
  return { ...defaults, ...run, id, object: kind, x, y };
}

function commit(state: EditorState, scene: IsoSceneFile, extra: Partial<EditorState> = {}): EditorState {
  return {
    ...state,
    ...extra,
    scene,
    past: [...state.past, cloneScene(state.scene)].slice(-HISTORY_CAP),
    future: [],
    drag: null,
    resize: null,
    revision: state.revision + 1,
  };
}

function moveBy(obj: IsoPlacement, dx: number, dy: number): IsoPlacement {
  const next: IsoPlacement = { ...obj, x: obj.x + dx, y: obj.y + dy };
  if (typeof obj.toX === 'number') {
    next.toX = obj.toX + dx;
  }
  if (typeof obj.toY === 'number') {
    next.toY = obj.toY + dy;
  }
  return next;
}

function placeAt(state: EditorState, x: number, y: number): EditorState {
  if (!state.placing) {
    return state;
  }
  const id = nextId(state.placing, state.scene.objects);
  const stamped = stamp(state.registry, state.placing, x, y, id);
  // A single-node part dropped inside a pipe records that pipe (holodeck#22).
  const added = isInlinePart(stamped, state.registry) ? withAttachment(stamped, state.scene.objects) : stamped;
  return commit(
    state,
    { ...state.scene, objects: [...state.scene.objects, added] },
    { selectedId: id },
  );
}

function finishPipe(state: EditorState, click: GridPoint): EditorState {
  if (!state.pipeStart) {
    // First click: snap to a part port (heading = outward) or keep the bare cell.
    const start = resolveRouteEnd(state.scene, state.registry, click);
    return { ...state, pipeStart: start.cell, pipeStartHeading: start.heading ?? null };
  }
  const end = resolveRouteEnd(state.scene, state.registry, click);
  if (sameCell(state.pipeStart, end.cell)) {
    return { ...state, pipeStart: end.cell, pipeStartHeading: end.heading ?? null };
  }
  const { placements, noRoute } = routeToPlacements(
    state.scene,
    state.registry,
    { cell: state.pipeStart, heading: state.pipeStartHeading ?? undefined },
    end,
    nextId,
  );
  // Chaining continues from the end cell with no required heading: a port's
  // outward heading points back out of the pipe we just drew into it.
  return commit(
    state,
    { ...state.scene, objects: [...state.scene.objects, ...placements] },
    {
      pipeStart: end.cell,
      pipeStartHeading: null,
      selectedId: placements[0]?.id ?? state.selectedId,
      notice: noRoute ? NO_ROUTE_NOTICE : null,
    },
  );
}

/**
 * Replace the selected run with a fresh route between its two ends. The run is
 * excluded from the obstacles so it does not block itself; its ends re-resolve
 * through `resolveRouteEnd` so a run that leaves a tank port keeps leaving it.
 * Inline parts without declared ports keep the original pipe's joint heading.
 */
function rerouteSelected(state: EditorState): EditorState {
  const run = state.selectedId ? findRun(state.scene.objects, state.selectedId, state.registry) : null;
  if (!run) {
    return state;
  }
  if (sameCell(run.start, run.end)) {
    return state; // closed loop: nothing sensible to route between
  }
  const ids = new Set(run.ids);
  // Inline parts drawn on the run's pipes (holodeck#22) ride along unless a
  // retained pipe pins them in place. Movable parts are excluded as obstacles
  // and re-seated near the same fraction, with room for every carried body.
  const runPipes = state.scene.objects.filter((o) => ids.has(o.id) && isPipePlacement(o));
  const hosted = state.scene.objects.filter((o) => {
    const host = hostPipeOf(o, state.scene.objects);
    return host !== null && ids.has(host.id) && !ids.has(o.id);
  });
  const retainedPipes = state.scene.objects.filter((o) => !ids.has(o.id) && isPipePlacement(o));
  // An onPipe attachment does not imply that this is the part's only
  // connection. Retained branches (including a second pipe passing through
  // the part) pin it in place; split the old chain there before routing.
  const fixed = hosted.filter((part) => pipeArmsAt(retainedPipes, part).length > 0
    || retainedPipes.some((pipe) => positionOnPipe(segOf(pipe), part.x, part.y) !== null));
  const fixedIds = new Set(fixed.map((o) => o.id));
  const movable = hosted.filter((o) => !fixedIds.has(o.id));
  const movableIds = new Set(movable.map((o) => o.id));
  const rest = state.scene.objects.filter((o) => !ids.has(o.id) && !movableIds.has(o.id)).map((o) => {
    if (!fixedIds.has(o.id)) return o;
    // The fixed part becomes a joint between new pipes, rather than being
    // hosted strictly inside one. Do not leave an attachment to the old ID.
    const { onPipe: _onPipe, at: _at, ...joint } = o;
    return joint;
  });
  const sections = splitChainAtParts(chainFrom(runPipes.map(segOf), run.start), fixed);
  const band = state.scene.objects.find((o) => o.id === run.ids[0])?.band;
  // Obstacle exclusion must not release IDs belonging to carried parts.
  const reservedObjects = state.scene.objects.filter((o) => !ids.has(o.id));
  const placements: IsoPlacement[] = [];
  const carried: IsoPlacement[] = [];
  let noRoute = false;
  for (const [i, section] of sections.entries()) {
    const first = section[0]!;
    const last = section[section.length - 1]!;
    const without = { objects: [...rest, ...placements] };
    const from = i === 0 ? resolveRouteEnd(without, state.registry, run.start) : {
      cell: first.from,
      heading: headingOf(first.to.x - first.from.x, first.to.y - first.from.y) ?? undefined,
    };
    const to = i === sections.length - 1 ? resolveRouteEnd(without, state.registry, run.end) : {
      cell: last.to,
      heading: headingOf(last.from.x - last.to.x, last.from.y - last.to.y) ?? undefined,
    };
    if (i === 0) from.heading ??= run.startHeading;
    if (i === sections.length - 1) to.heading ??= run.endHeading;
    const route = routeToPlacements(without, state.registry, from, to, nextId, {
      band, reservedObjects: [...reservedObjects, ...placements],
    });
    // Both blocked and off-grid fallbacks skip heading/obstacle guarantees:
    // half-cell endpoints set fallback=true but noRoute=false. Conservatively
    // reject them for fixed sections and retained endpoint ports/flanges;
    // staged placements must never partially replace the original run.
    if (route.fallback && (fixed.length > 0 || from.heading !== undefined || to.heading !== undefined)) {
      return { ...state, notice: RETAINED_CONNECTIONS_NO_ROUTE_NOTICE };
    }
    const endpointLength = (cell: GridPoint) => rest.some((o) => sameCell(o, cell) && isInlinePart(o, state.registry))
      ? INLINE_PART_LENGTH : 0;
    const parts = carryHostedParts(
      movable.filter((part) => section.some((seg) => seg.id === part.onPipe && positionOnPipe(seg, part.x, part.y) !== null)),
      section,
      route.placements.filter(isPipePlacement).map(segOf),
      { start: endpointLength(from.cell), end: endpointLength(to.cell) },
    );
    if (parts === null) return { ...state, notice: INLINE_PARTS_NO_ROUTE_NOTICE };
    placements.push(...route.placements);
    carried.push(...parts);
    noRoute ||= route.noRoute;
  }
  if (carried.length !== movable.length) return { ...state, notice: INLINE_PARTS_NO_ROUTE_NOTICE };
  return commit(
    state,
    { ...state.scene, objects: [...rest, ...placements, ...carried] },
    { selectedId: placements[0]?.id ?? null, notice: noRoute ? NO_ROUTE_NOTICE : null },
  );
}

function updateSelected(state: EditorState, fn: (o: IsoPlacement) => IsoPlacement): EditorState {
  if (!state.selectedId) {
    return state;
  }
  const objects = state.scene.objects.map((o) => (o.id === state.selectedId ? fn(o) : o));
  return commit(state, { ...state.scene, objects });
}

/** Does this part draw as a click-click run (the palette's pipe)? */
function isRunPart(state: EditorState, partId: string): boolean {
  return state.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId)?.draw === 'run';
}

/** Actions that may set a notice; every other non-pointer action dismisses it. */
const NOTICE_KEEPERS: ReadonlySet<EditorAction['type']> = new Set(['cursor', 'drag-move', 'resize-move', 'load', 'set-read-only']);

/** The number-param spec a resize handle edits, or null when the part is not resizable that way. */
function resizeParam(state: EditorState, partId: string, handle: ResizeHandle): { param: string; spec: IsoPartDefinition['params'][string] } | null {
  const def = state.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId);
  const param = def?.resize?.[handle];
  if (!def || !param) return null;
  const spec = def.params[param];
  if (!spec || spec.type !== 'number') return null;
  return { param, spec };
}

/** Effective value of a number param on a placement (placement.params, else the spec default). */
function numberParam(obj: IsoPlacement, param: string, fallback: unknown): number {
  const v = obj.params?.[param] ?? fallback;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  let next = reduce(state, action);
  if (next.pipeStart === null && next.pipeStartHeading !== null) {
    next = { ...next, pipeStartHeading: null };
  }
  const setsNotice = action.type === 'floor-click' || action.type === 'reroute-selected';
  return next.notice && !setsNotice && !NOTICE_KEEPERS.has(action.type) ? { ...next, notice: null } : next;
}

function reduce(state: EditorState, action: EditorAction): EditorState {
  if (state.readOnly && !RUN_MODE_ACTIONS.has(action.type)) {
    return state;
  }
  switch (action.type) {
    case 'select-mode':
      return { ...state, mode: 'select', placing: null, pipeStart: null, drag: null, resize: null };
    case 'place-mode':
      if (isRunPart(state, action.object)) {
        return { ...state, mode: 'draw-pipe', placing: null, pipeStart: null, pipeStartHeading: null, selectedId: null, drag: null };
      }
      return { ...state, mode: 'place', placing: action.object, pipeStart: null, selectedId: null, drag: null };
    case 'pipe-mode':
      return { ...state, mode: 'draw-pipe', placing: null, pipeStart: null, pipeStartHeading: null, selectedId: null, drag: null };
    case 'cursor':
      return { ...state, cursor: { x: action.x, y: action.y } };
    case 'floor-click': {
      const pt = { x: action.x, y: action.y };
      if (state.mode === 'place') {
        return placeAt({ ...state, cursor: pt }, action.x, action.y);
      }
      if (state.mode === 'draw-pipe') {
        return finishPipe({ ...state, cursor: pt }, pt);
      }
      return { ...state, selectedId: null, cursor: pt };
    }
    case 'select':
      return { ...state, selectedId: action.id, mode: 'select', placing: null, pipeStart: null };
    case 'drag-start': {
      const obj = state.scene.objects.find((o) => o.id === action.id);
      if (!obj) {
        return state;
      }
      return {
        ...state,
        selectedId: action.id,
        mode: 'select',
        placing: null,
        pipeStart: null,
        drag: { id: action.id, origin: structuredClone(obj), grab: { x: action.x, y: action.y } },
      };
    }
    case 'drag-move': {
      if (!state.drag) {
        return { ...state, cursor: { x: action.x, y: action.y } };
      }
      const dx = action.x - state.drag.grab.x;
      const dy = action.y - state.drag.grab.y;
      const objects = state.scene.objects.map((o) => {
        if (o.id !== state.drag?.id) {
          return o;
        }
        const moved = moveBy(state.drag.origin, dx, dy);
        // Keep the pipe attachment in step with where the part is dropped.
        return isInlinePart(moved, state.registry) ? withAttachment(moved, state.scene.objects) : moved;
      });
      return { ...state, cursor: { x: action.x, y: action.y }, scene: { ...state.scene, objects } };
    }
    case 'drag-end': {
      if (!state.drag) {
        return state;
      }
      const current = state.scene.objects.find((o) => o.id === state.drag?.id);
      const moved = current && (current.x !== state.drag.origin.x || current.y !== state.drag.origin.y);
      if (!moved) {
        // A drag out and back is a no-op, including attachment metadata.
        const origin = state.drag.origin;
        const objects = state.scene.objects.map((o) => o.id === origin.id ? { ...origin } : o);
        return { ...state, scene: { ...state.scene, objects }, drag: null };
      }
      const before = cloneScene(state.scene);
      before.objects = before.objects.map((o) => {
        if (o.id !== state.drag?.id) {
          return o;
        }
        // Coordinates alone lose onPipe/at after withAttachment detaches it.
        return { ...state.drag.origin };
      });
      return {
        ...state,
        drag: null,
        past: [...state.past, before].slice(-HISTORY_CAP),
        future: [],
        revision: state.revision + 1,
      };
    }
    case 'resize-start': {
      const obj = state.scene.objects.find((o) => o.id === action.id);
      if (!obj) {
        return state;
      }
      const target = resizeParam(state, obj.object, action.handle);
      if (!target) {
        return state;
      }
      return {
        ...state,
        selectedId: action.id,
        mode: 'select',
        placing: null,
        pipeStart: null,
        drag: null,
        resize: {
          id: action.id,
          handle: action.handle,
          param: target.param,
          origin: numberParam(obj, target.param, target.spec.default),
        },
      };
    }
    case 'resize-move': {
      const resize = state.resize;
      if (!resize || !Number.isFinite(action.value)) {
        return state;
      }
      const objects = state.scene.objects.map((o) => {
        if (o.id !== resize.id) {
          return o;
        }
        const target = resizeParam(state, o.object, resize.handle);
        if (!target) {
          return o;
        }
        const value = snapParamValue(target.spec, action.value);
        if (numberParam(o, resize.param, target.spec.default) === value) {
          return o;
        }
        return { ...o, params: { ...o.params, [resize.param]: value } };
      });
      return { ...state, scene: { ...state.scene, objects } };
    }
    case 'resize-end': {
      const resize = state.resize;
      if (!resize) {
        return state;
      }
      const current = state.scene.objects.find((o) => o.id === resize.id);
      const now = current ? numberParam(current, resize.param, resize.origin) : resize.origin;
      if (!current || now === resize.origin) {
        return { ...state, resize: null };
      }
      // One undo step: the scene as it was before the handle moved.
      const before = cloneScene(state.scene);
      before.objects = before.objects.map((o) =>
        o.id === resize.id ? { ...o, params: { ...o.params, [resize.param]: resize.origin } } : o,
      );
      return {
        ...state,
        resize: null,
        past: [...state.past, before].slice(-HISTORY_CAP),
        future: [],
        revision: state.revision + 1,
      };
    }
    case 'delete': {
      if (!state.selectedId) {
        return state;
      }
      return commit(
        state,
        { ...state.scene, objects: detachFrom(state.scene.objects, state.selectedId).filter((o) => o.id !== state.selectedId) },
        { selectedId: null },
      );
    }
    case 'reroute-selected':
      return rerouteSelected(state);
    case 'rotate-selected':
      return updateSelected(state, (o) => ({
        ...o,
        rotation: (o.rotation ?? 0) + action.direction * (Math.PI / 2),
      }));
    case 'set-param':
      return updateSelected(state, (o) => ({ ...o, params: { ...o.params, [action.param]: action.value } }));
    case 'patch-selected':
      return updateSelected(state, (o) => ({ ...o, ...action.patch, id: o.id }));
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) {
        return state;
      }
      return {
        ...state,
        scene: prev,
        past: state.past.slice(0, -1),
        future: [cloneScene(state.scene), ...state.future],
        drag: null,
        revision: state.revision + 1,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) {
        return state;
      }
      return {
        ...state,
        scene: next,
        future: state.future.slice(1),
        past: [...state.past, cloneScene(state.scene)].slice(-HISTORY_CAP),
        drag: null,
        revision: state.revision + 1,
      };
    }
    case 'new-document':
      return commit(state, { ...emptyScene(state.scene.id), theme: state.scene.theme, extensions: state.scene.extensions }, {
        selectedId: null,
        pipeStart: null,
        pipeStartHeading: null,
        placing: null,
        mode: 'select',
      });
    case 'load':
      return loadDocument(state, action.scene);
    case 'set-read-only':
      return action.readOnly === state.readOnly
        ? state
        : { ...state, readOnly: action.readOnly, mode: 'select', placing: null, pipeStart: null, drag: null, resize: null };
    case 'cancel':
      return {
        ...state,
        mode: 'select',
        placing: null,
        pipeStart: null,
        drag: null,
        resize: null,
      };
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

/**
 * `load` reducer. Document identity is `scene.id` (the same key
 * `ProcessEditor` uses to re-fit the camera). On a switch, undo/redo must not
 * cross documents: undoing after "edit A, load B" used to put A back and
 * `ProcessEditor` then emitted A through `onChange` while the host was editing
 * B, overwriting it (holodeck#9). Hosts whose documents can share an id should
 * remount `ProcessEditor` with a React `key` instead.
 */
function loadDocument(state: EditorState, scene: IsoSceneFile): EditorState {
  if (scene.id !== state.scene.id) {
    const fresh = createEditorState(scene, { registry: state.registry, readOnly: state.readOnly });
    // Keep `revision` monotonic (ProcessEditor compares it) and don't bump it:
    // a load is not a commit, so nothing is emitted. Keep the caller's object
    // (createEditorState clones) so the controlled-prop echo check still works.
    return { ...fresh, scene, revision: state.revision };
  }
  const selectedId = scene.objects.some((o) => o.id === state.selectedId) ? state.selectedId : null;
  return { ...state, scene, selectedId, drag: null, resize: null };
}

export function selectedObject(state: EditorState): IsoPlacement | undefined {
  return state.scene.objects.find((o) => o.id === state.selectedId);
}

/**
 * The scene to hand to `onChange` after `prev -> next`, or null when nothing
 * was committed (cursor moves, drag frames, selection, `load`). Pure so the
 * "emit after each committed action" contract is testable without React.
 */
export function committedScene(prev: EditorState, next: EditorState): IsoSceneFile | null {
  return next.revision !== prev.revision ? next.scene : null;
}
