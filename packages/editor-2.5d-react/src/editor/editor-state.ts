import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { getDefaultIsoRegistry } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { routeToPlacements, type GridPoint } from './routing';
import { sameCell } from './snap';

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
  cursor: GridPoint | null;
  drag: { id: string; origin: GridPoint; grab: GridPoint } | null;
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
  | { type: 'delete' }
  | { type: 'rotate-selected'; direction: 1 | -1 }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'new-document' }
  /** Edit one `placement.params` entry on the selection (inspector control). */
  | { type: 'set-param'; param: string; value: unknown }
  /** Merge fields onto the selection (host inspector panels). */
  | { type: 'patch-selected'; patch: Partial<IsoPlacement> }
  /** Replace the scene from outside (controlled `scene` prop). Not a commit; keeps history. */
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
    cursor: null,
    drag: null,
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
  const added = stamp(state.registry, state.placing, x, y, id);
  return commit(
    state,
    { ...state.scene, objects: [...state.scene.objects, added] },
    { selectedId: id },
  );
}

function finishPipe(state: EditorState, to: GridPoint): EditorState {
  if (!state.pipeStart || sameCell(state.pipeStart, to)) {
    return { ...state, pipeStart: to };
  }
  const objects = state.scene.objects;
  const pipeA = nextId('pipe', objects);
  const pipeB = nextId('pipe', [...objects, { id: pipeA, object: 'pipe', x: 0, y: 0 }]);
  const added = routeToPlacements(state.pipeStart, to, {
    pipeA,
    pipeB,
    elbow: nextId('elbow', objects),
  });
  return commit(
    state,
    { ...state.scene, objects: [...state.scene.objects, ...added] },
    { pipeStart: to, selectedId: added[0]?.id ?? state.selectedId },
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

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (state.readOnly && !RUN_MODE_ACTIONS.has(action.type)) {
    return state;
  }
  switch (action.type) {
    case 'select-mode':
      return { ...state, mode: 'select', placing: null, pipeStart: null, drag: null };
    case 'place-mode':
      if (isRunPart(state, action.object)) {
        return { ...state, mode: 'draw-pipe', placing: null, pipeStart: null, selectedId: null, drag: null };
      }
      return { ...state, mode: 'place', placing: action.object, pipeStart: null, selectedId: null, drag: null };
    case 'pipe-mode':
      return { ...state, mode: 'draw-pipe', placing: null, pipeStart: null, selectedId: null, drag: null };
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
        drag: { id: action.id, origin: { x: obj.x, y: obj.y }, grab: { x: action.x, y: action.y } },
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
        const fromOrigin = { ...o, x: state.drag.origin.x, y: state.drag.origin.y };
        if (typeof o.toX === 'number' && typeof o.toY === 'number') {
          const dtx = o.toX - o.x;
          const dty = o.toY - o.y;
          fromOrigin.toX = state.drag.origin.x + dtx;
          fromOrigin.toY = state.drag.origin.y + dty;
        }
        return moveBy(fromOrigin, dx, dy);
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
        return { ...state, drag: null };
      }
      const before = cloneScene(state.scene);
      before.objects = before.objects.map((o) => {
        if (o.id !== state.drag?.id) {
          return o;
        }
        const restored = { ...o, x: state.drag.origin.x, y: state.drag.origin.y };
        if (typeof o.toX === 'number' && typeof o.toY === 'number') {
          const dtx = o.toX - o.x;
          const dty = o.toY - o.y;
          restored.toX = state.drag.origin.x + dtx;
          restored.toY = state.drag.origin.y + dty;
        }
        return restored;
      });
      return {
        ...state,
        drag: null,
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
        { ...state.scene, objects: state.scene.objects.filter((o) => o.id !== state.selectedId) },
        { selectedId: null },
      );
    }
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
        placing: null,
        mode: 'select',
      });
    case 'load': {
      const selectedId = action.scene.objects.some((o) => o.id === state.selectedId) ? state.selectedId : null;
      return { ...state, scene: action.scene, selectedId, drag: null };
    }
    case 'set-read-only':
      return action.readOnly === state.readOnly
        ? state
        : { ...state, readOnly: action.readOnly, mode: 'select', placing: null, pipeStart: null, drag: null };
    case 'cancel':
      return {
        ...state,
        mode: 'select',
        placing: null,
        pipeStart: null,
        drag: null,
      };
    default: {
      const _never: never = action;
      return _never;
    }
  }
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
