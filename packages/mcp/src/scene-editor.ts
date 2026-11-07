/**
 * Scene edits run through the editor's own reducer (`editorReducer`, the one
 * the canvas dispatches to), never by patching JSON: placing a part stamps
 * the palette defaults, a pipe is routed around obstacles and records the
 * ports it joins, a moved vessel drags its attached pipes along, deleting a
 * part frees the pipe ends on it. Each tool call is one `SceneEditor`: the
 * actions a user would perform, then the committed scene.
 *
 * Action sequences mirror the studio's (`apps/studio/src/features/editor-commands.ts`:
 * `libraryAddActions`, `inspectorActions`); that file is not imported because
 * it type-depends on React components.
 */

import { HOLODECK_KINDS, type ContributionRegistry, type SignalBinding } from '@holodeck/sdk';
import {
  createEditorState,
  EDIT_REJECTED_PREFIX,
  editorReducer,
  PASTE_REJECTED_PREFIX,
  type EditorAction,
  type EditorState,
  type IsoPartDefinition,
  type IsoPlacement,
  type IsoSceneFile,
} from '@holodeck/editor-2.5d-react';
import { ToolError } from './errors';
import { libraryDropPoint } from './studio';

/** Length, in cells, of a run part (pipe) added without an end point: the studio's LIBRARY_RUN_LENGTH. */
export const LIBRARY_RUN_LENGTH = 2;

/** Placement fields `scene_update_params` may not set through `fields` (they have their own tools). */
export const PROTECTED_FIELDS: ReadonlySet<string> = new Set(['id', 'object', 'x', 'y', 'toX', 'toY', 'rotation', 'bindings', 'params', 'onPipe', 'at', 'attach', 'link', 'group']);

export type PointEnd = { x: number; y: number };
export type PortEnd = { id: string; port: string };
export type ConnectEnd = PointEnd | PortEnd;

const isPortEnd = (end: ConnectEnd): end is PortEnd => typeof (end as PortEnd).id === 'string';
const QUARTER = Math.PI / 2;

export class SceneEditor {
  state: EditorState;
  /** Every distinct editor notice raised during this call (routing fallbacks, cancelled follows...). */
  readonly notices: string[] = [];

  constructor(scene: IsoSceneFile, readonly registry: ContributionRegistry) {
    this.state = createEditorState(scene, { registry });
  }

  get scene(): IsoSceneFile {
    return this.state.scene;
  }

  /** Did any action commit (the editor's `revision` moved)? */
  get changed(): boolean {
    return this.state.revision !== 0;
  }

  /**
   * One editor action. The reducer never throws: an edit it refuses (a param
   * out of range, geometry it cannot place...) comes back unchanged with an
   * "Edit rejected: ..." notice. Here that aborts the whole tool call, so a
   * call is applied completely or not at all (no half-configured object).
   */
  dispatch(action: EditorAction): EditorState {
    const prev = this.state;
    const next = editorReducer(prev, action);
    const notice = next.notice;
    if (notice && notice !== prev.notice) {
      if (notice.startsWith(EDIT_REJECTED_PREFIX) || notice.startsWith(PASTE_REJECTED_PREFIX)) {
        throw new ToolError('the editor rejected the edit; nothing was written', [notice], 'invalid_edit');
      }
      if (!this.notices.includes(notice)) this.notices.push(notice);
    }
    this.state = next;
    return next;
  }

  part(id: string): IsoPartDefinition | undefined {
    return this.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, id);
  }

  object(id: string): IsoPlacement {
    const found = this.scene.objects.find((o) => o.id === id);
    if (found) return found;
    const ids = this.scene.objects.map((o) => o.id);
    const near = ids.filter((other) => other.includes(id) || id.includes(other)).slice(0, 10);
    throw new ToolError(`no object "${id}" in the scene`, near.length ? [`did you mean: ${near.join(', ')}`] : [`the scene has ${ids.length} objects; scene_get lists them`], 'not_found');
  }

  /** Make `id` the primary selection, as an inspector edit does. Locked / hidden objects refuse. */
  select(id: string): void {
    this.object(id);
    this.dispatch({ type: 'select', id });
    if (this.state.selectedId !== id) throw new ToolError(`object "${id}" cannot be edited (its layer is locked or hidden)`, [], 'locked');
  }

  private newIds(before: ReadonlySet<string>): string[] {
    return this.scene.objects.filter((o) => !before.has(o.id)).map((o) => o.id);
  }

  /** Library add: `place-mode` + floor click(s) + `select-mode` (a run part is drawn click-click). */
  add(partId: string, at?: PointEnd, to?: PointEnd): string[] {
    const def = this.part(partId);
    if (!def) throw new ToolError(`no part "${partId}" is installed`, ['parts_list shows the installed parts'], 'not_found');
    if (to && def.draw !== 'run') throw new ToolError(`"to" is only for run-drawn parts (pipes); "${partId}" is placed at one point`);
    const point = at ?? libraryDropPoint(this.scene, this.registry);
    const before = new Set(this.scene.objects.map((o) => o.id));
    this.dispatch({ type: 'place-mode', object: partId });
    if (def.draw === 'run') {
      const end = to ?? { x: point.x + LIBRARY_RUN_LENGTH, y: point.y };
      this.dispatch({ type: 'floor-click', x: point.x, y: point.y });
      this.dispatch({ type: 'floor-click', x: end.x, y: end.y });
    } else {
      this.dispatch({ type: 'floor-click', x: point.x, y: point.y });
    }
    this.dispatch({ type: 'select-mode' });
    const added = this.newIds(before);
    if (added.length === 0) throw new ToolError(`could not place "${partId}" at (${point.x}, ${point.y})`, this.notices, 'not_placed');
    return added;
  }

  /** Merge params onto one object (`null` removes a param, so it falls back to the part default). */
  setParams(id: string, params: Record<string, unknown>): void {
    const obj = this.object(id);
    this.select(id);
    const next: Record<string, unknown> = { ...obj.params };
    for (const [key, value] of Object.entries(params)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    this.dispatch({ type: 'patch-selected', patch: { params: Object.keys(next).length ? next : undefined } as Partial<IsoPlacement> });
  }

  /** Merge top-level placement fields (fillColor, label size, opacity, meta...); `null` removes one. */
  setFields(id: string, fields: Record<string, unknown>): void {
    const blocked = Object.keys(fields).filter((k) => PROTECTED_FIELDS.has(k));
    if (blocked.length) throw new ToolError(`these fields have their own tools: ${blocked.join(', ')}`, ['position/rotation: scene_move; params: params; bindings: scene_bind']);
    this.select(id);
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) patch[key] = value === null ? undefined : value;
    this.dispatch({ type: 'patch-selected', patch: patch as Partial<IsoPlacement> });
  }

  /** Move like a canvas drag (attached pipes follow; `detach` = Alt-drag). Grouped objects move with their group. */
  move(id: string, to: PointEnd, detach = false): void {
    const obj = this.object(id);
    if (obj.x === to.x && obj.y === to.y) return;
    this.dispatch({ type: 'drag-start', id, x: obj.x, y: obj.y });
    if (!this.state.drag) throw new ToolError(`object "${id}" cannot be moved (its layer is locked or hidden)`, [], 'locked');
    this.dispatch({ type: 'drag-move', x: to.x, y: to.y, detach });
    this.dispatch({ type: 'drag-end' });
  }

  /** Rotate to `degrees` (a multiple of 90) in quarter turns, as the rotate shortcut does. */
  rotate(id: string, degrees: number): void {
    if (!Number.isFinite(degrees) || degrees % 90 !== 0) throw new ToolError('rotationDegrees must be a multiple of 90');
    const obj = this.object(id);
    const current = Math.round((obj.rotation ?? 0) / QUARTER);
    const steps = (((Math.round(degrees / 90) - current) % 4) + 4) % 4;
    if (steps === 0) return;
    this.select(id);
    if (steps === 3) this.dispatch({ type: 'rotate-selected', direction: -1 });
    else for (let i = 0; i < steps; i += 1) this.dispatch({ type: 'rotate-selected', direction: 1 });
  }

  /** The grid cell a port snaps to (routing/ports.ts `resolveRouteEnd`, rounded the same way). */
  portCell(end: PortEnd): PointEnd {
    const obj = this.object(end.id);
    const def = this.part(obj.object);
    const port = def?.ports?.[end.port];
    if (!port) {
      const names = Object.keys(def?.ports ?? {});
      throw new ToolError(`object "${end.id}" (${obj.object}) has no port "${end.port}"`, [names.length ? `its ports: ${names.join(', ')}` : 'it has no ports; connect to a point {x, y} instead'], 'not_found');
    }
    const turns = ((Math.round((obj.rotation ?? 0) / QUARTER) % 4) + 4) % 4;
    let { x, y } = port;
    // Same quarter-turn rotation as routing/grid.ts rotateOffset (three.js yaw, grid y = world z).
    for (let i = 0; i < turns; i += 1) [x, y] = [y, -x];
    return { x: Math.round(obj.x + x), y: Math.round(obj.y + y) };
  }

  /**
   * Draw a pipe between two ends with the pipe tool (two floor clicks): the
   * editor routes it around obstacles and records which ports it joins.
   * Returns the new placements and whether each end attached to the port asked for.
   */
  connect(from: ConnectEnd, to: ConnectEnd): { added: string[]; attached: { from: boolean; to: boolean } } {
    const a = isPortEnd(from) ? this.portCell(from) : from;
    const b = isPortEnd(to) ? this.portCell(to) : to;
    if (a.x === b.x && a.y === b.y) throw new ToolError('both ends are the same cell; nothing to connect');
    const before = new Set(this.scene.objects.map((o) => o.id));
    this.dispatch({ type: 'pipe-mode' });
    this.dispatch({ type: 'floor-click', x: a.x, y: a.y });
    this.dispatch({ type: 'floor-click', x: b.x, y: b.y });
    this.dispatch({ type: 'select-mode' });
    const added = this.newIds(before);
    if (added.length === 0) throw new ToolError('no pipe could be drawn between those ends', this.notices, 'no_route');
    const pipes = this.scene.objects.filter((o) => added.includes(o.id) && o.object === 'pipe');
    const attach = (o: IsoPlacement | undefined) => (o as { attach?: { from?: { object: string; port?: string }; to?: { object: string; port?: string } } } | undefined)?.attach;
    const matches = (rec: { object: string; port?: string } | undefined, end: ConnectEnd) => !isPortEnd(end) || (rec?.object === end.id && rec.port === end.port);
    return {
      added,
      attached: { from: matches(attach(pipes[0])?.from, from), to: matches(attach(pipes[pipes.length - 1])?.to, to) },
    };
  }

  /** Delete exactly `ids`. A grouped object would take its whole group, so that is refused unless the group is listed. */
  remove(ids: readonly string[]): void {
    for (const id of ids) this.object(id);
    this.dispatch({ type: 'select-many', ids });
    const selected = new Set(this.state.selectedIds);
    const extra = [...selected].filter((id) => !ids.includes(id));
    const skipped = ids.filter((id) => !selected.has(id));
    if (skipped.length) throw new ToolError(`cannot remove ${skipped.join(', ')} (locked or hidden layer)`, [], 'locked');
    if (extra.length) throw new ToolError('those objects are grouped with others; removing one removes its group', [`list these too: ${extra.join(', ')}`], 'grouped');
    this.dispatch({ type: 'delete' });
  }

  /** Bind (or, `null`, unbind) one param to a provider signal, as the inspector's binding dialog does. */
  bind(id: string, param: string, binding: SignalBinding | null): void {
    const obj = this.object(id);
    const def = this.part(obj.object);
    if (def && !(param in def.params)) {
      throw new ToolError(`part "${obj.object}" has no param "${param}"`, [`its params: ${Object.keys(def.params).join(', ') || '(none)'}`], 'not_found');
    }
    this.select(id);
    const next = { ...obj.bindings };
    if (binding) next[param] = binding;
    else delete next[param];
    this.dispatch({ type: 'patch-selected', patch: { bindings: Object.keys(next).length ? next : undefined } as Partial<IsoPlacement> });
  }
}
