/**
 * Width of a side panel resized by a drag handle and persisted to
 * localStorage (T3 Code `useResizableWidth`): pointer capture on the handle,
 * the live width written straight to a CSS variable on the panel each move
 * (no React render per frame), state + storage committed once on release.
 * Arrow keys on the focused handle resize in 16 px steps (accessible
 * `role="separator"`).
 */

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampWidth, dragWidth, parseStoredWidth, type PanelBounds } from './panel-width.logic';

export const PANEL_WIDTH_VAR = '--panel-width';
const KEY_STEP = 16;

function readStored(key: string, bounds: PanelBounds): number {
  try {
    return parseStoredWidth(localStorage.getItem(key), bounds);
  } catch {
    // Storage can be unavailable (privacy mode); fall back to the default.
    return bounds.defaultWidth;
  }
}

function writeStored(key: string, width: number) {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    // Not persisting a width is harmless.
  }
}

export interface ResizeHandleProps {
  role: 'separator';
  'aria-orientation': 'vertical';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  tabIndex: number;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

export function useResizableWidth(storageKey: string, bounds: PanelBounds, edge: 'left' | 'right') {
  const [stored, setStored] = useState(() => readStored(storageKey, bounds));
  const width = clampWidth(stored, bounds);
  const drag = useRef<{ startX: number; startWidth: number; current: number; panel: HTMLElement | null } | null>(null);

  const commit = useCallback(
    (next: number) => {
      const clamped = clampWidth(next, bounds);
      setStored(clamped);
      writeStored(storageKey, clamped);
    },
    [bounds, storageKey],
  );

  const end = (event: PointerEvent<HTMLElement>, keep: boolean) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    state.panel?.style.removeProperty(PANEL_WIDTH_VAR);
    document.body.style.removeProperty('cursor');
    if (keep) commit(state.current);
  };

  const handleProps: ResizeHandleProps = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuenow': width,
    'aria-valuemin': bounds.minWidth,
    'aria-valuemax': bounds.maxWidth,
    tabIndex: 0,
    onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startWidth: width, current: width, panel: event.currentTarget.parentElement };
      document.body.style.setProperty('cursor', 'col-resize');
    },
    onPointerMove(event) {
      const state = drag.current;
      if (!state) return;
      state.current = dragWidth(state.startWidth, state.startX, event.clientX, edge, bounds);
      state.panel?.style.setProperty(PANEL_WIDTH_VAR, `${state.current}px`);
    },
    onPointerUp: (event) => end(event, true),
    onPointerCancel: (event) => end(event, false),
    onKeyDown(event) {
      const grow = edge === 'right' ? 'ArrowRight' : 'ArrowLeft';
      const shrink = edge === 'right' ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === grow) commit(width + KEY_STEP);
      else if (event.key === shrink) commit(width - KEY_STEP);
      else return;
      event.preventDefault();
    },
    onDoubleClick: () => commit(bounds.defaultWidth),
  };

  return { width, handleProps };
}
