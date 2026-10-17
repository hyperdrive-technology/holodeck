/**
 * Studio keyboard shortcuts (bound with TanStack Hotkeys in <StudioHotkeys />)
 * and the canvas shortcuts the iso engine handles itself, for the help dialog.
 *
 * Chosen to avoid browser-reserved chords (Chrome does not let pages take
 * Mod+N, Mod+Shift+N, Mod+T, Mod+W, Mod+Alt+I) and the engine's own keys
 * (V, P, R, Q, E, X, Delete/Backspace, Mod+Z, Space, Escape:
 * packages/editor-2.5d-react/src/editor/ProcessEditor.tsx).
 */

import type { HotkeyChord } from '@tanstack/react-hotkeys';

export type StudioCommand =
  | 'document.new'
  | 'document.import'
  | 'document.export'
  | 'document.save'
  | 'library.search'
  | 'panel.sidebar'
  | 'panel.inspector'
  | 'help.shortcuts';

export interface ShortcutSpec {
  command: StudioCommand;
  /** TanStack Hotkeys chord (type-checked); `Mod` is Cmd on macOS, Ctrl elsewhere. */
  hotkey: HotkeyChord;
  label: string;
}

export const STUDIO_SHORTCUTS: readonly ShortcutSpec[] = [
  { command: 'document.new', hotkey: 'Mod+Alt+N', label: 'New document' },
  { command: 'document.import', hotkey: 'Mod+O', label: 'Import document file' },
  { command: 'document.export', hotkey: 'Mod+Shift+E', label: 'Export document file' },
  { command: 'document.save', hotkey: 'Mod+S', label: 'Save (documents also save automatically)' },
  { command: 'library.search', hotkey: 'Mod+K', label: 'Search the library' },
  { command: 'panel.sidebar', hotkey: 'Mod+B', label: 'Toggle sidebar' },
  { command: 'panel.inspector', hotkey: 'Mod+I', label: 'Toggle inspector' },
  { command: 'help.shortcuts', hotkey: 'Mod+/', label: 'Keyboard shortcuts' },
];

/** Handled by the iso engine's canvas (not rebindable here). */
export const CANVAS_SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: 'V', label: 'Select tool' },
  { keys: 'P', label: 'Pipe tool' },
  { keys: 'R', label: 'Reroute selected pipe' },
  { keys: 'Q / E', label: 'Rotate view' },
  { keys: 'X', label: 'Toggle 2D (top-down) view' },
  { keys: 'Delete', label: 'Delete selection' },
  { keys: 'Mod+Z', label: 'Undo' },
  { keys: 'Mod+Shift+Z', label: 'Redo' },
  { keys: 'Space (hold)', label: 'Pan' },
  { keys: 'Escape', label: 'Cancel the current tool' },
];
