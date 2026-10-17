import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { validatePlacementGeometry, validatePlacementPart, validateSceneGeometry, type IsoPlacement, type IsoSceneFile } from '../iso/scene';
import { getDefaultIsoRegistry } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { rotateOffset, type Heading } from '../routing/grid';
import { resolveRouteEnd } from '../routing/ports';
import { carryHostedParts, chainFrom, hostPipeOf, INLINE_PART_LENGTH, isPipePlacement, positionOnPipe, segOf, splitChainAtParts, withAttachment } from '../routing/inline';
import { headingOf, pipeArmsAt } from '../routing/elbows';
import { findRun, isInlinePart } from '../routing/run';
import { routeToPlacements, type GridPoint } from './routing';
import { sameCell } from './snap';
import { snapParamValue } from '../registry/params';
import type { IsoLayer, IsoLinkEnd } from '../objects/validate';
import { MAX_Z } from '../objects/validate';
import { alignObjects, distributeObjects, moveBy, moveObjects, rotateObjectsAbout, type AlignEdge, type DistributeAxis } from './arrange';
import { copyObjects, pasteObjects, removeObjects } from './clipboard';
import { anchorAt, buildConnector, insertWaypoint, moveWaypoint, reanchor, removeWaypoint, sameLinkEnd } from './connect';
import { DEFAULT_LAYER_ID, DEFAULT_LAYER_NAME, expandGroups, isPlacementEditable, isPlacementHidden, nextFreeId, sceneLayers, withLayer } from './layers';

/** Which on-canvas handle a resize drag grabbed. */
export type ResizeHandle = 'radius' | 'height';

/** Shown when A* finds no clear route and the manhattan L was drawn instead. */
export const NO_ROUTE_NOTICE = 'No clear route — drew a straight L';
export const ROUTE_FAILED_NOTICE = 'No route drawn — no replacement geometry';
export const REROUTE_FAILED_NOTICE = 'Could not reroute — original run kept';

/** Rerouting is atomic when the carried parts cannot fit on the new run. */
export const INLINE_PARTS_NO_ROUTE_NOTICE = 'No clear route — inline parts do not fit';

/** Reroute refused because part of the run (or a part on it) is on a locked or hidden layer. */
export const REROUTE_LOCKED_NOTICE = 'Reroute rejected — part of the run is on a locked or hidden layer';

export const RETAINED_CONNECTIONS_NO_ROUTE_NOTICE = 'Reroute rejected — could not verify retained connections';

/** `run` = view only; `edit` = place / drag / delete. Set by the host via `ProcessEditor`'s `mode`. */
export type EditorHostMode = 'run' | 'edit';
export type EditorMode = 'select' | 'place' | 'draw-pipe' | 'draw-connector';

/** Shown when the connector tool is used but no `connector` part is installed. */
export const NO_CONNECTOR_PART_NOTICE = 'No connector part installed';

/** Which end of a connector a handle drag grabbed. */
export type LinkEndName = 'from' | 'to';

export interface EditorState {
  scene: IsoSceneFile;
  past: IsoSceneFile[];
  future: IsoSceneFile[];
  mode: EditorMode;
  /** Part id being stamped in `place` mode. */
  placing: string | null;
  /**
   * Primary selection: the last object clicked, the one the inspector edits.
   * Always the last entry of `selectedIds` (or null when nothing is selected).
   */
  selectedId: string | null;
  /**
   * Every selected placement id, scene order not guaranteed (click order).
   * Selecting a grouped placement selects its whole group. Hidden and (edit
   * mode) locked placements are never selected.
   */
  selectedIds: string[];
  /** Copied placements (`copy` / `cut`), kept across documents for cross-document paste. */
  clipboard: IsoPlacement[] | null;
  /** Layer new placements go on (place, pipe, connector, paste). Editor state, not part of the document. */
  activeLayer: string;
  /** First end of a connector being drawn (`draw-connector` mode). */
  linkStart: IsoLinkEnd | null;
  /** Connector end handle being dragged (holodeck#91); drops at `cursor`. */
  linkDrag: { id: string; end: LinkEndName } | { id: string; end: 'via'; index: number } | null;
  /**
   * Id of the placement the last action stamped from `place` mode, else null.
   * Cleared by the next action; `ProcessEditor` reports it via `onPlaced`.
   */
  placed: string | null;
  pipeStart: GridPoint | null;
  /** Required exit direction at `pipeStart` (outward port heading), or null for a bare cell. */
  pipeStartHeading: Heading | null;
  /** One-line inline message (e.g. the routing fallback). Cleared by the next non-pointer action. */
  notice: string | null;
  cursor: GridPoint | null;
  drag: {
    id: string;
    origin: IsoPlacement;
    grab: GridPoint;
    /** Single-node part, computed once so drag-move frames stay O(1) in footprint calls. */
    inline: boolean;
    /** Origins of the other selected placements moving with `id` (multi-select drag). */
    others: Array<{ origin: IsoPlacement; inline: boolean }>;
  } | null;
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
  /**
   * Select one placement (and its group). `additive` (shift-click) toggles it
   * in or out of the current selection instead of replacing it.
   */
  | { type: 'select'; id: string | null; additive?: boolean }
  /** Marquee / host selection: replace (or, `additive`, extend) the selection with `ids`. */
  | { type: 'select-many'; ids: readonly string[]; additive?: boolean }
  | { type: 'select-all' }
  /** Connector tool: click an object / port / cell, then another (holodeck#91). */
  | { type: 'connector-mode' }
  /**
   * Grab a selected connector's end handle (`link-drag-end` re-anchors it at
   * the drop cell) or a waypoint handle (`end: 'via'`, `index`: the drop cell
   * moves `link.via[index]`).
   */
  | { type: 'link-drag-start'; id: string; end: LinkEndName }
  | { type: 'link-drag-start'; id: string; end: 'via'; index: number }
  /** Insert a connector waypoint before `link.via[index]` (holodeck#112). One undo step. */
  | { type: 'waypoint-insert'; id: string; index: number; x: number; y: number }
  /** Remove `link.via[index]`. One undo step. */
  | { type: 'waypoint-remove'; id: string; index: number }
  | { type: 'link-drag-end'; x?: number; y?: number }
  /** Copy the selection to the editor clipboard (not a commit). */
  | { type: 'copy' }
  /** Copy, then delete the selection. One undo step. */
  | { type: 'cut' }
  /** Paste `objects` (e.g. from the system clipboard) or the editor clipboard. One undo step. */
  | { type: 'paste'; objects?: readonly unknown[] }
  /** Copy + paste the selection without touching the clipboard. One undo step. */
  | { type: 'duplicate' }
  /** Move the selection by whole cells (arrow keys). */
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'align'; edge: AlignEdge }
  | { type: 'distribute'; axis: DistributeAxis }
  | { type: 'group-selected' }
  | { type: 'ungroup-selected' }
  /** Draw order of the selection (`placement.z`). */
  | { type: 'z-order'; to: 'forward' | 'backward' | 'front' | 'back' }
  /** Add a layer (`scene.layers`) and make it the active layer. */
  | { type: 'add-layer'; name?: string }
  /** Rename / hide / lock a layer (the default layer included). */
  | { type: 'update-layer'; id: string; patch: Partial<Omit<IsoLayer, 'id'>> }
  /** Remove a layer; its placements move to the default layer. */
  | { type: 'remove-layer'; id: string }
  /** Move the selection to a layer. */
  | { type: 'assign-layer'; layer: string }
  /** Layer that new placements go on (editor state, not a commit). */
  | { type: 'set-active-layer'; id: string }
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
  /** Merge fields onto the primary selection (host inspector panels). */
  | { type: 'patch-selected'; patch: Partial<IsoPlacement> }
  /** Merge fields onto every selected placement (multi-edit: opacity, meta...). One undo step. */
  | { type: 'patch-selection'; patch: Partial<IsoPlacement> }
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
  'copy',
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
    selectedIds: [],
    clipboard: null,
    activeLayer: DEFAULT_LAYER_ID,
    linkStart: null,
    linkDrag: null,
    placed: null,
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

/**
 * Host-side palette stamp (holodeck#100): the placement the palette would
 * create for part `partId` at (x, y). `id` defaults to the next free
 * `<partId>-N` among `objects`. Hosts placing parts from their own library
 * use this so they cannot drift from the editor's defaults.
 */
export function stampPlacement(
  registry: ContributionRegistry,
  partId: string,
  x: number,
  y: number,
  opts: { id?: string; objects?: readonly IsoPlacement[] } = {},
): IsoPlacement {
  return stamp(registry, partId, x, y, opts.id ?? nextId(partId, opts.objects ?? []));
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

function placeAt(state: EditorState, x: number, y: number): EditorState {
  if (!state.placing) {
    return state;
  }
  const id = nextId(state.placing, state.scene.objects);
  const stamped = stamp(state.registry, state.placing, x, y, id);
  // A single-node part dropped inside a pipe records that pipe (holodeck#22).
  const added = withLayer(
    isInlinePart(stamped, state.registry) ? withAttachment(stamped, state.scene.objects) : stamped,
    activeLayerOf(state),
  );
  return commit(
    state,
    { ...state.scene, objects: [...state.scene.objects, added] },
    { selectedId: id, selectedIds: [id], placed: id },
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
  if (placements.length === 0) {
    return { ...state, notice: ROUTE_FAILED_NOTICE };
  }
  // Chaining continues from the end cell with no required heading: a port's
  // outward heading points back out of the pipe we just drew into it.
  const layer = activeLayerOf(state);
  return commit(
    state,
    { ...state.scene, objects: [...state.scene.objects, ...placements.map((o) => withLayer(o, layer))] },
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
    return { ...state, notice: REROUTE_FAILED_NOTICE }; // closed loop: no replacement
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
  // holodeck#122: a reroute replaces every run member and rewrites the parts
  // hosted on it. If any of them is on a locked or hidden layer, refuse rather
  // than silently replacing it with an unlocked, visible copy.
  if (state.scene.objects.some((o) => (ids.has(o.id) || hosted.includes(o)) && !isPlacementEditable(state.scene, o))) {
    return { ...state, notice: REROUTE_LOCKED_NOTICE };
  }
  const retainedPipes = state.scene.objects.filter((o) => !ids.has(o.id) && isPipePlacement(o));
  // An onPipe attachment does not imply that this is the part's only
  // connection. Retained branches (including a second pipe passing through
  // the part) pin it in place; split the old chain there before routing.
  // Check the centre AND every declared port in world space. Keep exact
  // offsets: rounding a half-cell port would miss its retained branch.
  const fixed = hosted.filter((part) => {
    const def = state.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, part.object);
    const connections = [part, ...Object.values(def?.ports ?? {}).map((port) => {
      const off = rotateOffset(port.x, port.y, part.rotation);
      return { x: part.x + off.x, y: part.y + off.y };
    })];
    return connections.some((point) => pipeArmsAt(retainedPipes, point).length > 0
      || retainedPipes.some((pipe) => positionOnPipe(segOf(pipe), point.x, point.y) !== null));
  });
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
    if (route.placements.length === 0) return { ...state, notice: REROUTE_FAILED_NOTICE };
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
    // A failed plan (even one offering an obstructed L) must not replace a
    // working run; invalid resolved ports can also produce no geometry.
    if (route.noRoute) return { ...state, notice: REROUTE_FAILED_NOTICE };
    if (parts === null) return { ...state, notice: INLINE_PARTS_NO_ROUTE_NOTICE };
    placements.push(...route.placements);
    carried.push(...parts);
  }
  if (carried.length !== movable.length) return { ...state, notice: INLINE_PARTS_NO_ROUTE_NOTICE };
  const originals = state.scene.objects.filter((o) => ids.has(o.id));
  return commit(
    state,
    { ...state.scene, objects: [...rest, ...inheritRunFields(placements, originals), ...carried] },
    { selectedId: placements[0]?.id ?? null, notice: null },
  );
}

/** Fields a reroute recomputes; everything else on the old run belongs to the user and must survive. */
const ROUTE_OWNED_FIELDS = new Set(['id', 'object', 'x', 'y', 'toX', 'toY', 'rotation', 'onPipe', 'at', 'link']);
/**
 * Per-object data bags. Copying them onto every new segment would duplicate
 * metadata planes and live bindings, so they are merged (in run order) onto
 * the FIRST replacement of that kind instead.
 */
const ROUTE_IDENTITY_FIELDS = ['meta', 'metaHidden', 'bindings', 'extensions', 'animation'] as const;
/** Assignment fields an elbow takes from the run's pipes when the old run had no elbow. */
const ROUTE_SHARED_FIELDS = ['layer', 'group', 'opacity', 'z'] as const;

/**
 * Carry the old run's user fields onto its replacement (PR #114 review: a
 * reroute used to drop `layer` / `group`, silently moving pipes back to the
 * default layer and out of their groups). Each new pipe / elbow takes every
 * non-route field of the first old placement of the same part (`band`,
 * `params`, `layer`, `group`, `opacity`, `z`...); identity bags go to the
 * first replacement only; elbows with no old elbow take the pipes' layer,
 * group, opacity and z.
 */
export function inheritRunFields(replacements: readonly IsoPlacement[], originals: readonly IsoPlacement[]): IsoPlacement[] {
  const template = (kind: string): Record<string, unknown> | null => {
    const first = originals.find((o) => o.object === kind);
    if (!first) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(first)) {
      if (!ROUTE_OWNED_FIELDS.has(k) && !(ROUTE_IDENTITY_FIELDS as readonly string[]).includes(k)) out[k] = structuredClone(v);
    }
    return out;
  };
  const pipeTemplate = template('pipe');
  const templates = new Map<string, Record<string, unknown> | null>();
  const templateFor = (kind: string) => {
    if (!templates.has(kind)) {
      let t = template(kind);
      if (!t && pipeTemplate) {
        t = {};
        for (const k of ROUTE_SHARED_FIELDS) if (pipeTemplate[k] !== undefined) t[k] = pipeTemplate[k];
      }
      templates.set(kind, t);
    }
    return templates.get(kind) ?? null;
  };
  const seenKind = new Set<string>();
  return replacements.map((r) => {
    const t = templateFor(r.object);
    const next: Record<string, unknown> = t ? { ...t, ...r } : { ...r };
    // Values the router set (band from the run) win over the template except where it left them undefined.
    for (const [k, v] of Object.entries(t ?? {})) if (next[k] === undefined) next[k] = v;
    if (!seenKind.has(r.object)) {
      seenKind.add(r.object);
      for (const field of ROUTE_IDENTITY_FIELDS) {
        const merged = originals.filter((o) => o.object === r.object && o[field] !== undefined).map((o) => o[field]);
        if (merged.length === 0) continue;
        next[field] = merged.every((m) => typeof m === 'object' && m !== null)
          ? structuredClone(Object.assign({}, ...(merged as object[])))
          : merged[merged.length - 1];
      }
    }
    return next as unknown as IsoPlacement;
  });
}

function updateSelected(state: EditorState, fn: (o: IsoPlacement) => IsoPlacement): EditorState {
  if (!state.selectedId) {
    return state;
  }
  const objects = state.scene.objects.map((o) => (o.id === state.selectedId ? fn(o) : o));
  return commit(state, { ...state.scene, objects });
}

/** Merge `patch` onto a placement; `undefined` values remove the field (e.g. opacity back to 1). The id never changes. */
function applyPatch(o: IsoPlacement, patch: Partial<IsoPlacement>): IsoPlacement {
  const next: Record<string, unknown> = { ...o, ...patch, id: o.id };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  return next as unknown as IsoPlacement;
}

/** Apply `fn` to every selected placement for which `when` holds. One commit; none when nothing changed. */
function updateSelection(
  state: EditorState,
  fn: (o: IsoPlacement) => IsoPlacement,
  when: (o: IsoPlacement) => boolean = () => true,
): EditorState {
  const ids = new Set(state.selectedIds);
  if (ids.size === 0) return state;
  let changed = false;
  const objects = state.scene.objects.map((o) => {
    if (!ids.has(o.id) || !when(o)) return o;
    changed = true;
    return fn(o);
  });
  return changed ? commit(state, { ...state.scene, objects }) : state;
}

/** Commit `objects` only when the arrangement actually changed (align of already-aligned parts is a no-op). */
function commitObjects(state: EditorState, objects: IsoPlacement[], extra: Partial<EditorState> = {}): EditorState {
  return objects === state.scene.objects ? state : commit(state, { ...state.scene, objects }, extra);
}

/** Inline parts among `ids` re-attach to whatever pipe they now sit on (after a move of several parts). */
function reattach(objects: IsoPlacement[], ids: ReadonlySet<string>, registry: ContributionRegistry): IsoPlacement[] {
  return objects.map((o) => (ids.has(o.id) && isInlinePart(o, registry) ? withAttachment(o, objects) : o));
}

/** Active layer when it still exists (a removed / undone layer falls back to the default). */
function activeLayerOf(state: EditorState): string {
  return sceneLayers(state.scene).some((l) => l.id === state.activeLayer) ? state.activeLayer : DEFAULT_LAYER_ID;
}

/** May the user select / edit this placement? (run mode: anything visible) */
function selectable(state: EditorState, o: IsoPlacement): boolean {
  return state.readOnly ? !isPlacementHidden(state.scene, o) : isPlacementEditable(state.scene, o);
}

/** Selection fields for `ids` (primary = last). */
function selection(ids: readonly string[]): Pick<EditorState, 'selectedId' | 'selectedIds'> {
  return { selectedIds: [...ids], selectedId: ids[ids.length - 1] ?? null };
}

/** `select` reducer: replace with the clicked id's group, or toggle that group (`additive`). */
function selectClick(state: EditorState, id: string | null, additive: boolean): EditorState {
  const reset = { mode: 'select' as const, placing: null, pipeStart: null, linkStart: null };
  if (id === null) return { ...state, ...reset, ...(additive ? {} : selection([])) };
  const target = state.scene.objects.find((o) => o.id === id);
  // Unknown ids keep the old single-id behaviour (a host may select before the scene arrives).
  if (target && !selectable(state, target)) return { ...state, ...reset };
  const unit = target && !state.readOnly ? expandGroups(state.scene, [id]) : [id];
  if (!additive) {
    // Primary = the clicked id, so a controlled `selectedId` echo matches.
    return { ...state, ...reset, ...selection([...unit.filter((u) => u !== id), id]) };
  }
  const current = state.selectedIds;
  if (current.includes(id)) {
    const drop = new Set(unit);
    return { ...state, ...reset, ...selection(current.filter((c) => !drop.has(c))) };
  }
  return { ...state, ...reset, ...selection([...current.filter((c) => !unit.includes(c)), ...unit.filter((u) => u !== id), id]) };
}

function selectMany(state: EditorState, ids: readonly string[], additive: boolean): EditorState {
  const byId = new Map(state.scene.objects.map((o) => [o.id, o]));
  const ok = ids.filter((id) => {
    const o = byId.get(id);
    return o !== undefined && selectable(state, o);
  });
  const expanded = expandGroups(state.scene, ok);
  const base = additive ? state.selectedIds.filter((id) => !expanded.includes(id)) : [];
  return { ...state, mode: 'select', placing: null, pipeStart: null, linkStart: null, ...selection([...base, ...expanded]) };
}

/** Delete the selection: hosted parts detach, connector anchors to deleted parts become free points. */
function deleteSelection(state: EditorState): EditorState {
  if (state.selectedIds.length === 0) return state;
  const objects = removeObjects(state.scene.objects, new Set(state.selectedIds), state.registry);
  return commit(state, { ...state.scene, objects }, selection([]));
}

/** Shown when a paste skipped invalid clipboard records; the first reason is included. */
export const PASTE_REJECTED_PREFIX = 'Paste rejected';

/**
 * `layers: 'active'` (paste): everything lands on the active layer, the
 * default layer included (holodeck#121: passing nothing for Default used to
 * keep the copied part's layer). `'source'` (duplicate): a copy in place keeps
 * its own layer when the scene declares it.
 */
function pasteInto(state: EditorState, clip: readonly unknown[], layers: 'active' | 'source' = 'active'): EditorState {
  if (!Array.isArray(clip) || clip.length === 0) return state;
  const opts = layers === 'active' ? { layer: activeLayerOf(state) } : {};
  const { objects, ids, rejected, skipped } = pasteObjects(state.scene, clip, state.registry, opts);
  if (ids.length === 0) {
    return { ...state, notice: `${PASTE_REJECTED_PREFIX}: ${rejected[0] ?? 'nothing to paste'}` };
  }
  const notice = skipped > 0
    ? `Pasted ${ids.length} of ${ids.length + skipped} parts; skipped: ${rejected[0]}`
    : null;
  return commit(state, { ...state.scene, objects }, { ...selection(ids), mode: 'select', placing: null, pipeStart: null, linkStart: null, notice });
}

/** Connector tool click: first click picks the start, the second draws the line and starts over. */
function connectorClick(state: EditorState, click: GridPoint): EditorState {
  const anchor = anchorAt(state.scene, state.registry, click);
  if (!state.linkStart) return { ...state, linkStart: anchor };
  if (sameLinkEnd(state.linkStart, anchor)) return state;
  if (!state.registry.get(HOLODECK_KINDS.isoPart, 'connector')) return { ...state, notice: NO_CONNECTOR_PART_NOTICE };
  const id = nextId('connector', state.scene.objects);
  const built = buildConnector(stamp(state.registry, 'connector', click.x, click.y, id), state.scene, state.registry, state.linkStart, anchor);
  if (!built) return { ...state, linkStart: null };
  return commit(
    state,
    { ...state.scene, objects: [...state.scene.objects, withLayer(built, activeLayerOf(state))] },
    { ...selection([id]), linkStart: null },
  );
}

/** The placement `id` when it is a connector the user may edit (not on a locked / hidden layer). */
function editableConnector(state: EditorState, id: string): IsoPlacement | null {
  const connector = state.scene.objects.find((o) => o.id === id);
  if (!connector || !selectable(state, connector)) return null;
  return state.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, connector.object)?.connector ? connector : null;
}

function linkDragEnd(state: EditorState, cell: GridPoint | null): EditorState {
  const drag = state.linkDrag;
  if (!drag) return state;
  const connector = state.scene.objects.find((o) => o.id === drag.id);
  if (!connector || !cell) return { ...state, linkDrag: null };
  if (drag.end === 'via') {
    const moved = moveWaypoint(connector, drag.index, cell);
    const before = connector.link?.via?.[drag.index];
    if (moved === connector || (before && before.x === cell.x && before.y === cell.y)) return { ...state, linkDrag: null };
    const objects = state.scene.objects.map((o) => (o.id === connector.id ? moved : o));
    return commit(state, { ...state.scene, objects }, { linkDrag: null });
  }
  const anchor = anchorAt(state.scene, state.registry, cell, new Set([connector.id]));
  const current = connector.link?.[drag.end];
  const unchanged = current
    ? sameLinkEnd(current, anchor)
    : 'x' in anchor && (drag.end === 'from'
      ? connector.x === anchor.x && connector.y === anchor.y
      : connector.toX === anchor.x && connector.toY === anchor.y);
  if (unchanged) return { ...state, linkDrag: null };
  const next = reanchor(connector, drag.end, anchor);
  const objects = state.scene.objects.map((o) => (o.id === connector.id ? next : o));
  return commit(state, { ...state.scene, objects }, { linkDrag: null });
}

function zOrder(state: EditorState, to: 'forward' | 'backward' | 'front' | 'back'): EditorState {
  const clamp = (z: number) => Math.max(-MAX_Z, Math.min(MAX_Z, z));
  const selected = new Set(state.selectedIds);
  // Front / back are relative to the parts NOT being moved, so repeating "to front" is a no-op.
  const others = state.scene.objects.filter((o) => !selected.has(o.id)).map((o) => o.z ?? 0);
  const front = clamp(Math.max(0, ...others) + 1);
  const back = clamp(Math.min(0, ...others) - 1);
  const target = (z: number) =>
    to === 'forward' ? clamp(z + 1) : to === 'backward' ? clamp(z - 1) : to === 'front' ? Math.max(z, front) : Math.min(z, back);
  return updateSelection(state, (o) => {
    const next = target(o.z ?? 0);
    if (next === 0) {
      const { z: _z, ...rest } = o;
      return rest;
    }
    return { ...o, z: next };
  }, (o) => target(o.z ?? 0) !== (o.z ?? 0));
}

function setLayers(state: EditorState, layers: IsoLayer[], objects = state.scene.objects, extra: Partial<EditorState> = {}): EditorState {
  const scene: IsoSceneFile = { ...state.scene, objects };
  if (layers.length) scene.layers = layers;
  else delete scene.layers;
  return commit(state, scene, extra);
}

function updateLayer(state: EditorState, id: string, patch: Partial<Omit<IsoLayer, 'id'>>): EditorState {
  const known = sceneLayers(state.scene).find((l) => l.id === id);
  if (!known) return state;
  const merged: IsoLayer = { ...known, ...patch, id };
  // Store flags only when set, so a shown / unlocked layer round-trips without noise.
  if (!merged.hidden) delete merged.hidden;
  if (!merged.locked) delete merged.locked;
  if (JSON.stringify(merged) === JSON.stringify(known)) return state;
  const declared = state.scene.layers ?? [];
  const layers = declared.some((l) => l.id === id)
    ? declared.map((l) => (l.id === id ? merged : l))
    : [merged, ...declared];
  return setLayers(state, layers);
}

/** Does this part draw as a click-click run (the palette's pipe)? */
function isRunPart(state: EditorState, partId: string): boolean {
  return state.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId)?.draw === 'run';
}

/** Pointer/release actions keep notices visible; other actions dismiss old notices. */
const NOTICE_KEEPERS: ReadonlySet<EditorAction['type']> = new Set(['cursor', 'drag-move', 'drag-end', 'resize-move', 'resize-end', 'load', 'set-read-only', 'link-drag-end']);

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
  const out = reduceChecked(state, action);
  // Notices can quote untrusted input (clipboard records, validator messages): cap them (holodeck#119).
  return out.notice && out.notice.length > MAX_NOTICE_LENGTH ? { ...out, notice: capNotice(out.notice) } : out;
}

function reduceChecked(state: EditorState, action: EditorAction): EditorState {
  // Nothing may throw out of here: in ProcessEditor a throw inside useReducer
  // unmounts the editor and loses unsaved history (PR #114 review). Any
  // failure while reducing is reported like a rejected edit instead.
  let next: EditorState;
  try {
    next = reduce(state, action);
  } catch (error) {
    return { ...state, notice: `Edit rejected: ${error instanceof Error ? error.message : String(error)}` };
  }
  // Reject the whole edit, preserving scene, selection, history and revision.
  // Pointer previews only change one placement's geometry, never its id/type.
  // Validate that placement each frame; commits still validate the whole scene.
  if (next.scene !== state.scene || next.revision !== state.revision) {
    try {
      if (action.type === 'drag-move' || action.type === 'resize-move') {
        for (let i = 0; i < next.scene.objects.length; i += 1) {
          const placement = next.scene.objects[i]!;
          if (placement !== state.scene.objects[i]) {
            validatePlacementGeometry(placement, state.registry);
          }
        }
      } else {
        validateSceneGeometry(next.scene, state.registry);
        // History restores placements already admitted to this document. Other
        // edits (including controlled loads) must check new ids and part types,
        // while keeping existing placements usable after a pack is uninstalled.
        if (action.type !== 'undo' && action.type !== 'redo') {
          const previousParts = new Map(state.scene.objects.map((o) => [o.id, o.object]));
          for (const placement of next.scene.objects) {
            if (previousParts.get(placement.id) !== placement.object) {
              validatePlacementPart(placement, state.registry);
            }
          }
        }
      }
    } catch (error) {
      return { ...state, notice: `Edit rejected: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (next.pipeStart === null && next.pipeStartHeading !== null) {
    next = { ...next, pipeStartHeading: null };
  }
  // Pointer frames never add / remove placements or change layers: skip the O(n) selection pass.
  if (action.type !== 'cursor' && action.type !== 'drag-move' && action.type !== 'resize-move') {
    next = normalizeSelection(state, next);
  }
  if (next.placed !== null && next.placed === state.placed) {
    next = { ...next, placed: null };
  }
  const setsNotice = next.notice !== state.notice || action.type === 'floor-click' || action.type === 'reroute-selected';
  return next.notice && !setsNotice && !NOTICE_KEEPERS.has(action.type) ? { ...next, notice: null } : next;
}

/** Longest `notice` the editor shows; longer ones are cut with an ellipsis. */
export const MAX_NOTICE_LENGTH = 200;

export function capNotice(text: string): string {
  return text.length > MAX_NOTICE_LENGTH ? `${text.slice(0, MAX_NOTICE_LENGTH - 1)}…` : text;
}

/**
 * Keep `selectedId` / `selectedIds` consistent after any action. Code that
 * only sets `selectedId` (place, pipe, reroute, load...) gets a one-element
 * `selectedIds`; ids that no longer exist or are no longer selectable (layer
 * hidden / locked, undo removed them) drop out; the primary is the last id.
 */
function normalizeSelection(prev: EditorState, next: EditorState): EditorState {
  if (next.scene === prev.scene && next.selectedIds === prev.selectedIds && next.selectedId === prev.selectedId && next.readOnly === prev.readOnly) {
    return next;
  }
  let ids = next.selectedIds;
  if (ids === prev.selectedIds && next.selectedId !== prev.selectedId) {
    ids = next.selectedId ? [next.selectedId] : [];
  }
  const byId = new Map(next.scene.objects.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const kept = ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const o = byId.get(id);
    // Unknown ids survive only as a lone host selection (see selectClick).
    return o ? selectable(next, o) : ids.length === 1 && id === next.selectedId;
  });
  const primary = next.selectedId !== null && kept.includes(next.selectedId) ? next.selectedId : (kept[kept.length - 1] ?? null);
  const ordered = primary === null ? kept : [...kept.filter((id) => id !== primary), primary];
  if (primary === next.selectedId && ordered.length === next.selectedIds.length && ordered.every((id, i) => id === next.selectedIds[i])) {
    return next;
  }
  return { ...next, selectedIds: ordered, selectedId: primary };
}

function reduce(state: EditorState, action: EditorAction): EditorState {
  if (state.readOnly && !RUN_MODE_ACTIONS.has(action.type)) {
    return state;
  }
  switch (action.type) {
    case 'select-mode':
      return { ...state, mode: 'select', placing: null, pipeStart: null, linkStart: null, drag: null, resize: null };
    case 'place-mode':
      if (isRunPart(state, action.object)) {
        return { ...state, mode: 'draw-pipe', placing: null, pipeStart: null, pipeStartHeading: null, linkStart: null, ...selection([]), drag: null };
      }
      return { ...state, mode: 'place', placing: action.object, pipeStart: null, linkStart: null, ...selection([]), drag: null };
    case 'pipe-mode':
      return { ...state, mode: 'draw-pipe', placing: null, pipeStart: null, pipeStartHeading: null, linkStart: null, ...selection([]), drag: null };
    case 'connector-mode':
      return { ...state, mode: 'draw-connector', placing: null, pipeStart: null, linkStart: null, ...selection([]), drag: null, resize: null };
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
      if (state.mode === 'draw-connector') {
        return connectorClick({ ...state, cursor: pt }, pt);
      }
      return { ...state, ...selection([]), cursor: pt };
    }
    case 'select':
      return selectClick(state, action.id, action.additive === true);
    case 'select-many':
      return selectMany(state, action.ids, action.additive === true);
    case 'select-all':
      return selectMany(state, state.scene.objects.map((o) => o.id), false);
    case 'drag-start': {
      const obj = state.scene.objects.find((o) => o.id === action.id);
      if (!obj || !selectable(state, obj)) {
        return state;
      }
      // Pressing on part of the current selection drags all of it; anything else selects that part (and its group) first.
      const ids = state.selectedIds.includes(action.id)
        ? state.selectedIds
        : expandGroups(state.scene, [action.id]);
      const others = state.scene.objects
        .filter((o) => o.id !== action.id && ids.includes(o.id))
        .map((o) => ({ origin: structuredClone(o), inline: isInlinePart(o, state.registry) }));
      const keep = state.selectedIds.includes(action.id);
      return {
        ...state,
        ...(keep ? { selectedId: action.id, selectedIds: [...ids.filter((id) => id !== action.id), action.id] } : selection([...ids.filter((id) => id !== action.id), action.id])),
        mode: 'select',
        placing: null,
        pipeStart: null,
        linkStart: null,
        drag: { id: action.id, origin: structuredClone(obj), grab: { x: action.x, y: action.y }, inline: isInlinePart(obj, state.registry), others },
      };
    }
    case 'drag-move': {
      if (!state.drag) {
        return { ...state, cursor: { x: action.x, y: action.y } };
      }
      const drag = state.drag;
      const dx = action.x - drag.grab.x;
      const dy = action.y - drag.grab.y;
      if (drag.others.length === 0) {
        const objects = state.scene.objects.map((o) => {
          if (o.id !== drag.id) {
            return o;
          }
          const moved = moveBy(drag.origin, dx, dy);
          // Keep the pipe attachment in step with where the part is dropped.
          return drag.inline ? withAttachment(moved, state.scene.objects) : moved;
        });
        return { ...state, cursor: { x: action.x, y: action.y }, scene: { ...state.scene, objects } };
      }
      const origins = new Map([[drag.id, { origin: drag.origin, inline: drag.inline }], ...drag.others.map((o) => [o.origin.id, o] as const)]);
      const moved = state.scene.objects.map((o) => {
        const from = origins.get(o.id);
        return from ? moveBy(from.origin, dx, dy) : o;
      });
      // Inline parts re-attach against the moved pipes (a valve dragged with its pipe stays on it).
      const objects = moved.map((o) => (origins.get(o.id)?.inline ? withAttachment(o, moved) : o));
      return { ...state, cursor: { x: action.x, y: action.y }, scene: { ...state.scene, objects } };
    }
    case 'drag-end': {
      if (!state.drag) {
        return state;
      }
      const current = state.scene.objects.find((o) => o.id === state.drag?.id);
      const moved = current && (current.x !== state.drag.origin.x || current.y !== state.drag.origin.y);
      const allOrigins = new Map([state.drag.origin, ...state.drag.others.map((o) => o.origin)].map((o) => [o.id, o]));
      if (!moved) {
        // A drag out and back is a no-op, including attachment metadata.
        const origin = state.drag.origin;
        if (state.drag.others.length === 0 && current && JSON.stringify(current) === JSON.stringify(origin)) return { ...state, drag: null };
        const objects = state.scene.objects.map((o) => {
          const back = allOrigins.get(o.id);
          return back ? { ...back } : o;
        });
        return { ...state, scene: { ...state.scene, objects }, drag: null };
      }
      const before = cloneScene(state.scene);
      before.objects = before.objects.map((o) => {
        // Coordinates alone lose onPipe/at after withAttachment detaches it.
        const back = allOrigins.get(o.id);
        return back ? { ...back } : o;
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
      if (!resize) {
        return state;
      }
      if (!Number.isFinite(action.value)) {
        return { ...state, notice: 'Edit rejected: resize value must be finite' };
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
    case 'delete':
      return deleteSelection(state);
    case 'reroute-selected':
      return rerouteSelected(state);
    case 'rotate-selected':
      if (state.selectedIds.length > 1) {
        return commitObjects(state, rotateObjectsAbout(state.scene.objects, new Set(state.selectedIds), action.direction, state.registry));
      }
      return updateSelected(state, (o) => ({
        ...o,
        rotation: (o.rotation ?? 0) + action.direction * (Math.PI / 2),
      }));
    case 'set-param': {
      // Multi-edit: the inspector shows the primary's params; every selected placement of the same part gets the value.
      const kind = selectedObject(state)?.object;
      return updateSelection(
        state,
        (o) => ({ ...o, params: { ...o.params, [action.param]: action.value } }),
        (o) => o.object === kind,
      );
    }
    case 'patch-selected':
      return updateSelected(state, (o) => applyPatch(o, action.patch));
    case 'patch-selection':
      return updateSelection(state, (o) => applyPatch(o, action.patch));
    case 'copy':
      if (state.selectedIds.length === 0) return state;
      return { ...state, clipboard: copyObjects(state.scene, new Set(state.selectedIds), state.registry) };
    case 'cut': {
      if (state.selectedIds.length === 0) return state;
      const clipboard = copyObjects(state.scene, new Set(state.selectedIds), state.registry);
      return { ...deleteSelection(state), clipboard };
    }
    case 'paste':
      return pasteInto(state, action.objects ?? state.clipboard ?? []);
    case 'duplicate':
      return pasteInto(state, copyObjects(state.scene, new Set(state.selectedIds), state.registry), 'source');
    case 'nudge': {
      if (!Number.isFinite(action.dx) || !Number.isFinite(action.dy)) return state;
      const ids = new Set(state.selectedIds);
      const moved = moveObjects(state.scene.objects, ids, action.dx, action.dy);
      return commitObjects(state, moved === state.scene.objects ? moved : reattach(moved, ids, state.registry));
    }
    case 'align': {
      const ids = new Set(state.selectedIds);
      const moved = alignObjects(state.scene.objects, ids, action.edge, state.registry);
      return commitObjects(state, moved === state.scene.objects ? moved : reattach(moved, ids, state.registry));
    }
    case 'distribute': {
      const ids = new Set(state.selectedIds);
      const moved = distributeObjects(state.scene.objects, ids, action.axis, state.registry);
      return commitObjects(state, moved === state.scene.objects ? moved : reattach(moved, ids, state.registry));
    }
    case 'group-selected': {
      if (state.selectedIds.length < 2) return state;
      const group = nextFreeId('group', state.scene.objects.flatMap((o) => (o.group ? [o.group] : [])));
      return updateSelection(state, (o) => ({ ...o, group }));
    }
    case 'ungroup-selected':
      return updateSelection(state, (o) => {
        const { group: _group, ...rest } = o;
        return rest;
      }, (o) => o.group !== undefined);
    case 'z-order':
      return zOrder(state, action.to);
    case 'add-layer': {
      const layers = sceneLayers(state.scene);
      const id = nextFreeId('layer', layers.map((l) => l.id));
      const name = action.name?.trim() || `Layer ${layers.length + 1}`;
      return setLayers(state, [...(state.scene.layers ?? []), { id, name }], state.scene.objects, { activeLayer: id });
    }
    case 'update-layer':
      return updateLayer(state, action.id, action.patch);
    case 'remove-layer': {
      if (action.id === DEFAULT_LAYER_ID || !state.scene.layers?.some((l) => l.id === action.id)) return state;
      const objects = state.scene.objects.map((o) => (o.layer === action.id ? withLayer(o, DEFAULT_LAYER_ID) : o));
      return setLayers(state, state.scene.layers.filter((l) => l.id !== action.id), objects, {
        activeLayer: state.activeLayer === action.id ? DEFAULT_LAYER_ID : state.activeLayer,
      });
    }
    case 'assign-layer': {
      if (!sceneLayers(state.scene).some((l) => l.id === action.layer)) return state;
      return updateSelection(state, (o) => withLayer(o, action.layer), (o) => (o.layer ?? DEFAULT_LAYER_ID) !== action.layer);
    }
    case 'set-active-layer':
      return sceneLayers(state.scene).some((l) => l.id === action.id) ? { ...state, activeLayer: action.id } : state;
    case 'link-drag-start': {
      const connector = state.scene.objects.find((o) => o.id === action.id);
      if (!connector || !selectable(state, connector) || !state.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, connector.object)?.connector) {
        return state;
      }
      const linkDrag: EditorState['linkDrag'] = action.end === 'via' ? { id: action.id, end: 'via', index: action.index } : { id: action.id, end: action.end };
      if (linkDrag.end === 'via' && !connector.link?.via?.[linkDrag.index]) return state;
      return { ...state, ...selection([action.id]), mode: 'select', placing: null, pipeStart: null, linkStart: null, drag: null, resize: null, linkDrag };
    }
    case 'waypoint-insert':
    case 'waypoint-remove': {
      const connector = editableConnector(state, action.id);
      if (!connector) return state;
      let next: IsoPlacement;
      if (action.type === 'waypoint-insert') {
        if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return state;
        next = insertWaypoint(connector, action.index, { x: action.x, y: action.y });
      } else {
        next = removeWaypoint(connector, action.index);
      }
      if (next === connector) return state;
      const objects = state.scene.objects.map((o) => (o.id === connector.id ? next : o));
      return commit(state, { ...state.scene, objects }, { ...selection([connector.id]), linkDrag: null });
    }
    case 'link-drag-end': {
      const cell = action.x !== undefined && action.y !== undefined ? { x: action.x, y: action.y } : state.cursor;
      return linkDragEnd(state, cell);
    }
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
        ...selection([]),
        activeLayer: DEFAULT_LAYER_ID,
        linkStart: null,
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
        : { ...state, readOnly: action.readOnly, mode: 'select', placing: null, pipeStart: null, linkStart: null, linkDrag: null, drag: null, resize: null };
    case 'cancel':
      return {
        ...state,
        mode: 'select',
        placing: null,
        pipeStart: null,
        linkStart: null,
        linkDrag: null,
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
    // The clipboard survives so a copy in one document pastes into the next.
    return { ...fresh, scene, revision: state.revision, clipboard: state.clipboard };
  }
  const selectedId = scene.objects.some((o) => o.id === state.selectedId) ? state.selectedId : null;
  // normalizeSelection prunes selectedIds that the new scene no longer has.
  return { ...state, scene, selectedId, drag: null, resize: null, linkDrag: null };
}

export function selectedObject(state: EditorState): IsoPlacement | undefined {
  return state.scene.objects.find((o) => o.id === state.selectedId);
}

/** Every selected placement, in scene order. */
export function selectedObjects(state: Pick<EditorState, 'scene' | 'selectedIds'>): IsoPlacement[] {
  const ids = new Set(state.selectedIds);
  return state.scene.objects.filter((o) => ids.has(o.id));
}

export { DEFAULT_LAYER_ID, DEFAULT_LAYER_NAME };

/**
 * The scene to hand to `onChange` after `prev -> next`, or null when nothing
 * was committed (cursor moves, drag frames, selection, `load`). Pure so the
 * "emit after each committed action" contract is testable without React.
 */
export function committedScene(prev: EditorState, next: EditorState): IsoSceneFile | null {
  return next.revision !== prev.revision ? next.scene : null;
}
