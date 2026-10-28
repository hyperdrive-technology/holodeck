/**
 * Keyboard shortcuts for ProcessEditor (lane E3, holodeck#37): ONE table
 * drives both the key handler and the help overlay (`ShortcutHelp`), so the
 * overlay cannot list a key that does nothing.
 *
 * Why not TanStack Hotkeys: `@tanstack/react-hotkeys` was 0.14 (pre-1.0,
 * minor bumps every few days) when this landed and pulls in
 * `@tanstack/store`; this package ships to hosts with a deliberately small
 * dependency set (see the `@tanstack/pacer` note in EditorLayer.tsx). The
 * table is the same idea (declarative bindings + display formatting) in ~150
 * lines. Revisit once Hotkeys reaches 1.0; `ShortcutDef.keys` already uses
 * its `Mod+Shift+Z` notation.
 *
 * Key notation: `Mod` = Cmd on macOS, Ctrl elsewhere. A token is matched
 * against `KeyboardEvent.key` (case-insensitive) or `KeyboardEvent.code`
 * (`BracketLeft`, so Shift+[ still matches on layouts where it types `{`).
 * `?` matches regardless of Shift (it needs Shift on most layouts).
 */

export type ShortcutId =
  | 'select-tool'
  | 'pipe-tool'
  | 'connector-tool'
  | 'cancel'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'select-all'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'group'
  | 'ungroup'
  | 'rotate-left'
  | 'rotate-right'
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up'
  | 'nudge-down'
  | 'nudge-left-5'
  | 'nudge-right-5'
  | 'nudge-up-5'
  | 'nudge-down-5'
  | 'bring-forward'
  | 'send-backward'
  | 'bring-to-front'
  | 'send-to-back'
  | 'reroute'
  | 'view-rotate-left'
  | 'view-rotate-right'
  | 'toggle-2d'
  | 'fit'
  | 'help';

export type ShortcutGroup = 'Tools' | 'Edit' | 'Arrange' | 'View';

export interface ShortcutDef {
  id: ShortcutId;
  /** Alternative bindings, e.g. `['Mod+Shift+Z', 'Mod+Y']`. */
  keys: readonly string[];
  label: string;
  group: ShortcutGroup;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'select-tool', keys: ['V'], label: 'Select tool', group: 'Tools' },
  { id: 'pipe-tool', keys: ['P'], label: 'Pipe tool', group: 'Tools' },
  { id: 'connector-tool', keys: ['C'], label: 'Connector tool (click a part or port, then another)', group: 'Tools' },
  { id: 'cancel', keys: ['Escape'], label: 'Cancel the tool or a move in progress / clear the selection', group: 'Tools' },
  { id: 'undo', keys: ['Mod+Z'], label: 'Undo', group: 'Edit' },
  { id: 'redo', keys: ['Mod+Shift+Z', 'Mod+Y'], label: 'Redo', group: 'Edit' },
  { id: 'delete', keys: ['Delete', 'Backspace'], label: 'Delete the selection', group: 'Edit' },
  { id: 'select-all', keys: ['Mod+A'], label: 'Select all (unlocked, visible)', group: 'Edit' },
  { id: 'copy', keys: ['Mod+C'], label: 'Copy', group: 'Edit' },
  { id: 'cut', keys: ['Mod+X'], label: 'Cut', group: 'Edit' },
  { id: 'paste', keys: ['Mod+V'], label: 'Paste', group: 'Edit' },
  { id: 'duplicate', keys: ['Mod+D'], label: 'Duplicate', group: 'Edit' },
  { id: 'group', keys: ['Mod+G'], label: 'Group the selection', group: 'Edit' },
  { id: 'ungroup', keys: ['Mod+Shift+G'], label: 'Ungroup', group: 'Edit' },
  { id: 'rotate-left', keys: ['BracketLeft'], label: 'Rotate the selection left 90°', group: 'Arrange' },
  { id: 'rotate-right', keys: ['BracketRight'], label: 'Rotate the selection right 90°', group: 'Arrange' },
  { id: 'nudge-left', keys: ['ArrowLeft'], label: 'Move the selection 1 cell (-x); attached pipes follow', group: 'Arrange' },
  { id: 'nudge-right', keys: ['ArrowRight'], label: 'Move the selection 1 cell (+x)', group: 'Arrange' },
  { id: 'nudge-up', keys: ['ArrowUp'], label: 'Move the selection 1 cell (-y)', group: 'Arrange' },
  { id: 'nudge-down', keys: ['ArrowDown'], label: 'Move the selection 1 cell (+y)', group: 'Arrange' },
  { id: 'nudge-left-5', keys: ['Shift+ArrowLeft'], label: 'Move 5 cells (-x)', group: 'Arrange' },
  { id: 'nudge-right-5', keys: ['Shift+ArrowRight'], label: 'Move 5 cells (+x)', group: 'Arrange' },
  { id: 'nudge-up-5', keys: ['Shift+ArrowUp'], label: 'Move 5 cells (-y)', group: 'Arrange' },
  { id: 'nudge-down-5', keys: ['Shift+ArrowDown'], label: 'Move 5 cells (+y)', group: 'Arrange' },
  { id: 'bring-forward', keys: ['Mod+BracketRight'], label: 'Bring forward (z + 1)', group: 'Arrange' },
  { id: 'send-backward', keys: ['Mod+BracketLeft'], label: 'Send backward (z - 1)', group: 'Arrange' },
  { id: 'bring-to-front', keys: ['Mod+Shift+BracketRight'], label: 'Bring to front', group: 'Arrange' },
  { id: 'send-to-back', keys: ['Mod+Shift+BracketLeft'], label: 'Send to back', group: 'Arrange' },
  { id: 'reroute', keys: ['R'], label: 'Reroute the selected pipe run', group: 'Arrange' },
  { id: 'view-rotate-left', keys: ['Q'], label: 'Rotate the view left', group: 'View' },
  { id: 'view-rotate-right', keys: ['E'], label: 'Rotate the view right', group: 'View' },
  { id: 'toggle-2d', keys: ['X'], label: 'Toggle 2D / 2.5D', group: 'View' },
  { id: 'fit', keys: ['F'], label: 'Fit the scene', group: 'View' },
  { id: 'help', keys: ['?'], label: 'Show / hide this help', group: 'View' },
];

/** Pointer gestures, listed in the help overlay only (handled by EditorLayer / IsoCanvas). */
export const POINTER_GESTURES: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: 'Click', label: 'Select a part (selects its whole group)' },
  { keys: 'Shift+Click', label: 'Add / remove a part from the selection' },
  { keys: 'Shift+Drag', label: 'Marquee select on empty floor' },
  { keys: 'Drag', label: 'Move the selection (attached pipes follow) / pan on empty floor' },
  { keys: 'Alt+Drag', label: 'Move parts without their pipes (detaches them)' },
  { keys: 'Esc while dragging', label: 'Cancel the move (everything goes back)' },
  { keys: 'Space+Drag', label: 'Pan' },
  { keys: 'Wheel', label: 'Zoom' },
];

interface Combo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(spec: string): Combo {
  const parts = spec.split('+');
  // A literal '+' key would split oddly; none of our bindings use it.
  const key = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  return { mod: mods.has('mod'), shift: mods.has('shift'), alt: mods.has('alt'), key };
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;

export function comboMatches(spec: string, event: KeyLike): boolean {
  const c = parse(spec);
  const mod = event.metaKey || event.ctrlKey;
  if (mod !== c.mod || event.altKey !== c.alt) return false;
  if (c.key === '?') return event.key === '?';
  if (event.shiftKey !== c.shift) return false;
  return event.code === c.key || event.key.toLowerCase() === c.key.toLowerCase();
}

/** The shortcut an event triggers, or null. First match in table order wins. */
export function matchShortcut(event: KeyLike, table: readonly ShortcutDef[] = SHORTCUTS): ShortcutDef | null {
  for (const def of table) {
    if (def.keys.some((spec) => comboMatches(spec, event))) return def;
  }
  return null;
}

const KEY_LABELS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: 'Del',
};

/** Display form of a binding: `⌘ ⇧ Z` on macOS, `Ctrl Shift Z` elsewhere. */
export function formatCombo(spec: string, mac: boolean): string[] {
  return spec.split('+').map((token) => {
    if (token === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (token === 'Shift') return mac ? '⇧' : 'Shift';
    if (token === 'Alt') return mac ? '⌥' : 'Alt';
    return KEY_LABELS[token] ?? token;
  });
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(platform);
}
