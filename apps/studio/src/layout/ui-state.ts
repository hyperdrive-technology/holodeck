/**
 * Client UI state (TanStack Store, per the T3 digest's "persisted store"
 * recommendation instead of zustand): which side panels are open, and
 * transient notices. Panel visibility persists to localStorage under a
 * versioned key; a stored value of another version or shape is ignored.
 */

import { Store } from '@tanstack/react-store';

export interface PanelState {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
}

export const PANEL_STATE_KEY = 'holodeck-studio:panels:v1';
export const DEFAULT_PANEL_STATE: PanelState = { sidebarOpen: true, inspectorOpen: true };

export function parsePanelState(raw: string | null): PanelState {
  if (!raw) return DEFAULT_PANEL_STATE;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      return {
        sidebarOpen: typeof v.sidebarOpen === 'boolean' ? v.sidebarOpen : DEFAULT_PANEL_STATE.sidebarOpen,
        inspectorOpen: typeof v.inspectorOpen === 'boolean' ? v.inspectorOpen : DEFAULT_PANEL_STATE.inspectorOpen,
      };
    }
  } catch {
    // Corrupt value: defaults.
  }
  return DEFAULT_PANEL_STATE;
}

function loadPanelState(): PanelState {
  try {
    return parsePanelState(localStorage.getItem(PANEL_STATE_KEY));
  } catch {
    return DEFAULT_PANEL_STATE;
  }
}

export const panelStore = new Store<PanelState>(loadPanelState());
panelStore.subscribe((state) => {
  try {
    localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch {
    // Not persisting panel visibility is harmless.
  }
});

export const togglePanel = (panel: keyof PanelState) => panelStore.setState((s) => ({ ...s, [panel]: !s[panel] }));

// -----------------------------------------------------------------------------
// Notices: short status messages ("Imported plant.holodeck.json") and errors
// with details (every import problem). Rendered by <Notices />.
// -----------------------------------------------------------------------------

export interface Notice {
  id: number;
  tone: 'info' | 'error';
  title: string;
  details?: readonly string[];
}

export const noticeStore = new Store<readonly Notice[]>([]);
let noticeSeq = 0;
/** Most notices on screen at once; older ones drop off. */
export const MAX_NOTICES = 4;

export function notify(notice: Omit<Notice, 'id'>): number {
  noticeSeq += 1;
  const id = noticeSeq;
  noticeStore.setState((list) => [...list, { ...notice, id }].slice(-MAX_NOTICES));
  return id;
}

export function dismissNotice(id: number) {
  noticeStore.setState((list) => list.filter((n) => n.id !== id));
}
