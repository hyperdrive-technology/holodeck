/**
 * Studio keyboard shortcuts (bound with TanStack Hotkeys in <StudioHotkeys />)
 * and the canvas shortcuts the iso engine handles itself, for the help dialog.
 *
 * Chosen to avoid browser-reserved chords (Chrome does not let pages take
 * Mod+N, Mod+Shift+N, Mod+T, Mod+W, Mod+Alt+I) and every key the engine's
 * canvas binds (its `SHORTCUTS` table; shortcuts.test.ts checks with the
 * engine's own `matchShortcut`).
 */

import { SHORTCUTS } from '@holodeck/editor-2.5d-react';
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
  { command: 'document.export', hotkey: 'Mod+Shift+E', label: 'Export (document, components CSV, PNG, embed)' },
  { command: 'document.save', hotkey: 'Mod+S', label: 'Save (documents also save automatically)' },
  { command: 'library.search', hotkey: 'Mod+K', label: 'Search the library' },
  { command: 'panel.sidebar', hotkey: 'Mod+B', label: 'Toggle sidebar' },
  { command: 'panel.inspector', hotkey: 'Mod+I', label: 'Toggle inspector' },
  { command: 'help.shortcuts', hotkey: 'Mod+/', label: 'Keyboard shortcuts' },
];

/**
 * Handled by the iso engine's canvas (not rebindable here). Read from the
 * engine's own table so the help dialog and the conflict test follow it.
 */
export const CANVAS_SHORTCUTS: ReadonlyArray<{ keys: readonly string[]; label: string }> = SHORTCUTS.map((s) => ({ keys: s.keys, label: s.label }));
