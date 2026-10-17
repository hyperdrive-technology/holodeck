/**
 * Pure sizing rules for the studio's side panels (T3 Code idiom:
 * `threadSidebarWidth.ts` + `useResizableWidth.ts`, kept React-free so it is
 * unit-tested without a DOM).
 */

export interface PanelBounds {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export const SIDEBAR_BOUNDS: PanelBounds = { defaultWidth: 272, minWidth: 208, maxWidth: 480 };
export const INSPECTOR_BOUNDS: PanelBounds = { defaultWidth: 300, minWidth: 240, maxWidth: 520 };

export const SIDEBAR_WIDTH_KEY = 'holodeck-studio:sidebar-width';
export const INSPECTOR_WIDTH_KEY = 'holodeck-studio:inspector-width';

/** Clamp to bounds; non-finite input yields the default. */
export function clampWidth(value: number, bounds: PanelBounds): number {
  if (!Number.isFinite(value)) return bounds.defaultWidth;
  return Math.round(Math.max(bounds.minWidth, Math.min(bounds.maxWidth, value)));
}

/**
 * Width while dragging: `edge` is the side of the panel the handle is on.
 * A right-edge handle (left panel) grows with +dx; a left-edge handle (right
 * panel) grows with -dx.
 */
export function dragWidth(startWidth: number, startX: number, currentX: number, edge: 'left' | 'right', bounds: PanelBounds): number {
  const dx = currentX - startX;
  return clampWidth(edge === 'right' ? startWidth + dx : startWidth - dx, bounds);
}

/** Read a stored width; anything unparsable becomes the default. */
export function parseStoredWidth(raw: string | null, bounds: PanelBounds): number {
  if (raw === null || raw.trim() === '') return bounds.defaultWidth;
  return clampWidth(Number(raw), bounds);
}
