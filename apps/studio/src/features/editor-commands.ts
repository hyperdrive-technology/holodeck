/**
 * Editor action sequences for studio commands that start outside the canvas
 * (library "+", inspector edits). Pure: they return the actions, the
 * workspace dispatches them through `ProcessEditorHandle.dispatch`, so every
 * command is one undoable editor step with the editor's own rules.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { EditorAction, EditorState, IsoPartDefinition } from '@holodeck/editor-2.5d-react';
import type { InspectorEdit } from './Inspector';

/** Length, in cells, of a run part (pipe) added from the library: what the palette stamp used to give. */
export const LIBRARY_RUN_LENGTH = 2;

/**
 * Add `partId` at `at` through the editor's place tool, then return to
 * select. A run-drawn part (`draw: 'run'`, e.g. pipe) is drawn like a user
 * would: `place-mode` enters pipe drawing, the first floor click sets the
 * start, the second (LIBRARY_RUN_LENGTH cells to +x) routes and commits it.
 * A single click there would only record the start and `select-mode` would
 * cancel it (review of holodeck#128).
 */
export function libraryAddActions(registry: ContributionRegistry, partId: string, at: { x: number; y: number }): EditorAction[] {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId);
  const clicks: EditorAction[] =
    def?.draw === 'run'
      ? [
          { type: 'floor-click', x: at.x, y: at.y },
          { type: 'floor-click', x: at.x + LIBRARY_RUN_LENGTH, y: at.y },
        ]
      : [{ type: 'floor-click', x: at.x, y: at.y }];
  return [{ type: 'place-mode', object: partId }, ...clicks, { type: 'select-mode' }];
}

/**
 * Release of a library drag (features/library-drag.ts), given the editor's
 * state at that moment. Mirrors the engine palette's own drop
 * (ProcessEditor `dropFromPalette`):
 *  - a run part (pipe) only arms its tool: a pipe is drawn click-click, so
 *    the tool stays armed and nothing is dispatched;
 *  - the place tool no longer holds this part (Escape, another tool): nothing;
 *  - released over this canvas with a ghost cell: one `palette-drop` (place +
 *    select, one undo step, the host's `onPlaced` fires);
 *  - released anywhere else (or cancelled): back to the select tool.
 */
export function libraryDropActions(
  registry: ContributionRegistry,
  state: Pick<EditorState, 'mode' | 'placing' | 'cursor'>,
  partId: string,
  overCanvas: boolean,
): EditorAction[] {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId);
  if (def?.draw === 'run' || state.mode === 'draw-pipe') return [];
  if (state.mode !== 'place' || state.placing !== partId) return [];
  if (overCanvas && state.cursor) return [{ type: 'palette-drop', object: partId, x: state.cursor.x, y: state.cursor.y }];
  return [{ type: 'select-mode' }];
}

/**
 * An inspector edit of object `id`. The inspector shows one object, so the
 * editor's selection is first narrowed to it (a non-additive `select`)
 * whenever it is anything else, e.g. a canvas multi-selection that merely
 * has `id` as its primary: otherwise delete / rotate / param edits applied
 * to every selected object (holodeck#129). A grouped object still selects
 * its whole group, as a canvas click does; the inspector says so.
 */
export function inspectorActions(selectedIds: readonly string[], id: string, edit: InspectorEdit | { kind: 'delete' }): EditorAction[] {
  const narrow: EditorAction[] = selectedIds.length === 1 && selectedIds[0] === id ? [] : [{ type: 'select', id }];
  switch (edit.kind) {
    case 'move':
      return [...narrow, { type: 'patch-selected', patch: edit.patch }];
    case 'rotate':
      return [...narrow, { type: 'rotate-selected', direction: edit.direction }];
    case 'param':
      return [...narrow, { type: 'set-param', param: edit.name, value: edit.value }];
    case 'bindings':
      // `patch-selected` is primary-only, and an undefined field is removed (no bindings left).
      return [...narrow, { type: 'patch-selected', patch: { bindings: edit.bindings } }];
    case 'delete':
      return [...narrow, { type: 'delete' }];
  }
}
