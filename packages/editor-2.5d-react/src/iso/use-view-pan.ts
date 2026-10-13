/**
 * DOM-level pan / zoom gestures for IsoCanvas (math in pan.ts).
 *
 * Why DOM listeners and not R3F mesh handlers: R3F `onPointerMove` only fires
 * while the ray hits a mesh, and an older version panned by re-raycasting the
 * floor each move while the camera itself was moving under the pointer. Here
 * a press on the canvas wrapper records screen coordinates and window-level
 * move/up listeners turn pixel deltas into target deltas, so the pan is
 * exact, works off-canvas and is independent of what is under the cursor.
 *
 * Who wins a left press: R3F's own listener sits on a descendant of the
 * wrapper, so object/floor handlers run before the wrapper sees the
 * pointerdown in the bubble phase. A handler that owns the press (Edit-mode
 * object drag, placing a part, drawing a pipe) calls `claimPointer(native)`;
 * the wrapper then leaves that press alone. Right and middle presses always
 * pan, as does any press while `forcePan` (Space held) is on.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Vector3Tuple } from 'three';
import type { IsoPose } from './pose';
import { classifyWheel, panTarget, PAN_DRAG_THRESHOLD_PX, wheelZoomFactor, zoomAtScreenPoint } from './pan';

const claimed = new WeakSet<Event>();

/** Mark a native pointerdown as handled by a scene handler so it does not start a pan. */
export function claimPointer(event: Event): void {
  claimed.add(event);
}

export function isPointerClaimed(event: Event): boolean {
  return claimed.has(event);
}

export interface ViewPanOptions {
  zoom: number;
  target: Vector3Tuple;
  pose: IsoPose;
  /** Pan is enabled only when the host listens for target changes. */
  onTargetChange?: (target: Vector3Tuple) => void;
  onZoomChange?: (zoom: number) => void;
  /** Pan with any button regardless of claims (Space held). */
  forcePan?: boolean;
}

export function useViewPan(
  container: RefObject<HTMLDivElement | null>,
  { zoom, target, pose, onTargetChange, onZoomChange, forcePan = false }: ViewPanOptions,
) {
  // Latest view in a ref: the window listeners and the non-passive wheel
  // listener are installed once and must not read stale React state.
  const view = useRef({ zoom, target, pose, onTargetChange, onZoomChange, forcePan });
  view.current = { zoom, target, pose, onTargetChange, onZoomChange, forcePan };
  const [panning, setPanning] = useState(false);
  // Pending pixel delta, flushed once per animation frame. Each flush
  // re-renders the whole editor tree, so coalescing pointermove bursts
  // (often > 60 Hz) matters. `@tanstack/pacer` is not a dependency of this
  // package (same note as useGhostRoute in EditorLayer), hence rAF.
  const pending = useRef({ dx: 0, dy: 0, frame: 0 });
  const session = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null);

  const flush = useCallback(() => {
    const p = pending.current;
    p.frame = 0;
    const v = view.current;
    if (!v.onTargetChange || (p.dx === 0 && p.dy === 0)) return;
    const next = panTarget(v.target, v.pose, v.zoom, p.dx, p.dy);
    p.dx = 0;
    p.dy = 0;
    // Advance the ref now so a second flush before React re-renders composes.
    view.current = { ...v, target: next };
    v.onTargetChange(next);
  }, []);

  const queue = useCallback(
    (dx: number, dy: number) => {
      const p = pending.current;
      p.dx += dx;
      p.dy += dy;
      if (!p.frame) p.frame = requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(
    () => () => {
      if (pending.current.frame) cancelAnimationFrame(pending.current.frame);
    },
    [],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const v = view.current;
      if (!v.onTargetChange || session.current) return;
      // Buttons/toolbar overlaid on the canvas are not pan surfaces.
      if ((event.target as HTMLElement).closest?.('button, input, select, textarea')) return;
      const native = event.nativeEvent;
      const alwaysPans = event.button === 1 || event.button === 2 || v.forcePan;
      if (!alwaysPans && (event.button !== 0 || isPointerClaimed(native))) return;
      session.current = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      if (event.button === 1) event.preventDefault(); // no autoscroll widget

      const move = (e: PointerEvent) => {
        const s = session.current;
        if (!s || e.pointerId !== s.id) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (!s.active) {
          if (Math.hypot(dx, dy) < PAN_DRAG_THRESHOLD_PX) return;
          s.active = true;
          setPanning(true);
        }
        s.x = e.clientX;
        s.y = e.clientY;
        queue(dx, dy);
      };
      const end = (e: PointerEvent) => {
        const s = session.current;
        if (!s || e.pointerId !== s.id) return;
        session.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (pending.current.frame) {
          cancelAnimationFrame(pending.current.frame);
          flush();
        }
        setPanning(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    [flush, queue],
  );

  // React registers `wheel` as a passive listener, so `preventDefault()` in a
  // JSX `onWheel` is ignored: Ctrl+wheel (trackpad pinch) then zooms the whole
  // browser page. A native non-passive listener is the only way to keep it.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = view.current;
      if (!v.onZoomChange && !v.onTargetChange) return;
      const intent = classifyWheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY,
      });
      if (intent === 'pan') {
        if (!v.onTargetChange) return;
        e.preventDefault();
        // Shift + mouse wheel scrolls sideways; some browsers already swap it into deltaX.
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
        // Scrolling down moves the view down the plant = content moves up.
        queue(-dx, -dy);
        return;
      }
      if (!v.onZoomChange) return;
      e.preventDefault();
      const next = v.zoom * wheelZoomFactor(intent, e.deltaY);
      if (v.onTargetChange) {
        const rect = el.getBoundingClientRect();
        const z = zoomAtScreenPoint(
          v.target,
          v.pose,
          v.zoom,
          next,
          e.clientX - (rect.left + rect.width / 2),
          e.clientY - (rect.top + rect.height / 2),
        );
        if (z.zoom === v.zoom) return;
        view.current = { ...v, zoom: z.zoom, target: z.target };
        v.onZoomChange(z.zoom);
        v.onTargetChange(z.target);
      } else {
        const z = zoomAtScreenPoint(v.target, v.pose, v.zoom, next, 0, 0);
        if (z.zoom !== v.zoom) {
          view.current = { ...v, zoom: z.zoom };
          v.onZoomChange(z.zoom);
        }
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [container, queue]);

  return { onPointerDown, panning };
}
