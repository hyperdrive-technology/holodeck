/**
 * Drag a library item onto the canvas (drag-and-drop building).
 *
 * Duplicates, on purpose, the engine palette's `usePaletteDrag`
 * (packages/editor-2.5d-react/src/editor/Palette.tsx), which the package does
 * not export: the studio has its own library panel (`chrome="canvas"`) and
 * consumes the BUILT editor, so exporting it would mean a package release for
 * ~40 lines. Keep the two in step; when the engine exports a drag helper,
 * switch to it.
 *
 * Pointer events, not HTML5 drag and drop: during a native drag the browser
 * stops sending pointer moves to the canvas, so the editor's own ghost (grid
 * snap, port snap) could not follow the pointer. Past the threshold the item
 * is armed (`onStart`, the same as a click); on release `onDrop` gets the
 * element under the pointer (null when cancelled) and the workspace decides
 * whether that is its canvas. A press that never moves stays a click.
 */

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Pointer travel (px) that turns a press on a library item into a drag. Same as the engine's PALETTE_DRAG_THRESHOLD. */
export const LIBRARY_DRAG_THRESHOLD = 4;

export interface LibraryDragHandlers {
  onStart: (kind: string, itemId: string) => void;
  onDrop: (kind: string, itemId: string, target: Element | null) => void;
}

/**
 * Returns the `onPointerDown` handler for a library item. After a real drag
 * the click that follows the release is swallowed (`wasDrag`), so the item is
 * not armed again by the click.
 */
export function useLibraryDrag(handlers: LibraryDragHandlers | null): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, kind: string, itemId: string) => void;
  /** True right after a drag ended: the trailing click must not count as a click. */
  wasDrag: () => boolean;
} {
  const cleanup = useRef<(() => void) | null>(null);
  const dragged = useRef(false);
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => () => cleanup.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, kind: string, itemId: string) => {
    if (event.button !== 0 || !latest.current) return;
    cleanup.current?.();
    dragged.current = false;
    // Touch / pen capture the pointer to the pressed element implicitly; release
    // it so moves reach the canvas under the finger.
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    let active = false;
    const move = (e: PointerEvent) => {
      if (active || Math.hypot(e.clientX - start.x, e.clientY - start.y) < LIBRARY_DRAG_THRESHOLD) return;
      active = true;
      dragged.current = true;
      latest.current?.onStart(kind, itemId);
    };
    const up = (e: PointerEvent) => {
      cleanup.current?.();
      if (!active) return;
      latest.current?.onDrop(kind, itemId, document.elementFromPoint(e.clientX, e.clientY));
    };
    const cancel = () => {
      cleanup.current?.();
      if (active) latest.current?.onDrop(kind, itemId, null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      cleanup.current = null;
    };
  };

  const wasDrag = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };

  return { onPointerDown, wasDrag };
}
