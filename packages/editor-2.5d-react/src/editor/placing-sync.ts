/**
 * Controlled `placing` prop <-> editor tool state (holodeck#100, #133).
 *
 * The editor's own state says which part the place tool holds in
 * `state.placing`, but a run part (pipe, `draw: 'run'`) arms `draw-pipe`
 * instead and keeps `state.placing: null`. So the host-facing "armed part" is
 * not simply `state.placing`:
 *
 * - `armedPart` is what the editor reports through `onPlacingChange`: its
 *   own placed part, or the host's run part while draw-pipe is the tool the
 *   host armed. Without that, entering draw-pipe for a host-armed Pipe
 *   reported `null`, the host echoed `null` back, and the echo looked like a
 *   disarm (review of holodeck#140: Tank -> Pipe cancelled the pipe tool).
 * - `hostPlacingAction` is what a new host `placing` value asks the editor
 *   to do. `null` leaves the place tool, or draw-pipe when the host armed a
 *   run part, but not a draw-pipe the user picked inside the editor.
 *
 * Pure so the transitions are unit-tested (editor-followups.test.ts); the
 * wiring lives in ProcessEditor.
 */
import type { EditorAction, EditorMode } from './editor-state';

export interface PlacingToolState {
  mode: EditorMode;
  placing: string | null;
}

/** True for run parts (drawn as a pipe run, not stamped). */
export type IsRunPart = (partId: string) => boolean;

/**
 * The armed part as the host should see it: `state.placing`, or the host's
 * `placing` when it is a run part and the editor is in draw-pipe.
 */
export function armedPart(state: PlacingToolState, hostPlacing: string | null | undefined, isRun: IsRunPart): string | null {
  if (state.placing !== null) return state.placing;
  if (state.mode === 'draw-pipe' && hostPlacing && isRun(hostPlacing)) return hostPlacing;
  return null;
}

/**
 * The editor action for a host `placing` change from `prev` to `next`, or
 * null for none. `undefined` (uncontrolled) never acts.
 */
export function hostPlacingAction(
  prev: string | null | undefined,
  next: string | null | undefined,
  state: PlacingToolState,
  isRun: IsRunPart,
): EditorAction | null {
  if (next === undefined) return null;
  if (next === null) {
    if (state.placing !== null) return { type: 'select-mode' };
    // Only a draw-pipe the host armed (its previous value was a run part).
    const hostArmedRun = state.mode === 'draw-pipe' && typeof prev === 'string' && isRun(prev);
    return hostArmedRun ? { type: 'select-mode' } : null;
  }
  if (next === armedPart(state, prev, isRun)) return null;
  return { type: 'place-mode', object: next };
}
