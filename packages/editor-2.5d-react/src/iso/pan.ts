/**
 * Screen-space view math for the orthographic iso camera: pan, zoom about a
 * screen point, and wheel-event classification. Pure (no three / React), so
 * every yaw snap and the 2D top-down pose can be unit-tested directly.
 *
 * Ortho model (see IsoCanvas / IsoRig): the camera sits at
 * `target + posePosition(pose)` looking at `target`, and R3F sizes the
 * frustum in CSS pixels, so `zoom` is "CSS pixels per world unit". Moving the
 * target by a world vector moves every world point by the same amount on
 * screen (orthographic = no perspective), so a pan is exact for objects at
 * any height, not only for the ground.
 */
import type { Vector3Tuple } from 'three';
import { posePosition, type IsoPose } from './pose';

/** Zoom range for the wheel, pinch, toolbar buttons and fit-to-scene. */
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 80;

/** Pointer travel (CSS px) before a press turns into a pan. Below this it stays a click. */
export const PAN_DRAG_THRESHOLD_PX = 3;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export interface CameraBasis {
  /** Unit view direction (camera -> target). */
  forward: Vector3Tuple;
  /** Unit screen-right, always horizontal (y = 0). */
  right: Vector3Tuple;
  /** Unit screen-up (tilted for the iso pose, horizontal in 2D). */
  up: Vector3Tuple;
}

/** Smallest ground radius the camera ever uses (see `cameraOffset`). */
export const MIN_CAMERA_RADIUS = 1e-3;

/**
 * Camera position relative to the target. A 2D pose has radius 0, i.e. the
 * camera straight above the target; `camera.lookAt` is then degenerate (view
 * parallel to `camera.up`) and three.js falls back to a fixed orientation
 * that ignores yaw, so rotating in 2D did nothing on screen and pan / fit
 * could not know which way was up. Nudging the radius to 1e-3 (a 5e-5 rad
 * tilt at the 18-unit view distance, invisible) keeps the yaw meaningful.
 * IsoRig and `cameraBasis` both go through here so render, pan and fit agree.
 */
export function cameraOffset(pose: IsoPose): Vector3Tuple {
  return posePosition({ ...pose, radius: Math.max(pose.radius, MIN_CAMERA_RADIUS) });
}

/** Camera axes for `pose` (the frame IsoRig's `lookAt` produces). */
export function cameraBasis(pose: IsoPose): CameraBasis {
  const [px, py, pz] = cameraOffset(pose);
  const len = Math.hypot(px, py, pz);
  const f: Vector3Tuple = [-px / len, -py / len, -pz / len];
  // right = f x (0,1,0) = (-f.z, 0, f.x); up = right x f.
  const rl = Math.hypot(f[2], f[0]);
  const r: Vector3Tuple = [-f[2] / rl, 0, f[0] / rl];
  const u: Vector3Tuple = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  return { forward: f, right: r, up: u };
}

/**
 * Horizontal world vector that moves exactly one world unit "up" on screen
 * and zero to the right. It is the ground projection of screen-up, stretched
 * by 1 / |up_horizontal| (for the iso pose |up_h| = sin(35.26 deg) ~ 0.577,
 * so the ground step is ~1.73 units per screen unit; in 2D it is 1).
 */
function groundUp(basis: CameraBasis): Vector3Tuple {
  const [ux, , uz] = basis.up;
  const h = Math.hypot(ux, uz);
  // Only a horizontal camera (never produced by IsoPose) has no ground projection.
  if (h < 1e-9) return [0, 0, 0];
  return [ux / (h * h), 0, uz / (h * h)];
}

/**
 * World offset (y always 0) that a camera target must move by so the scene
 * follows a pointer moved `dxPx` right and `dyPx` down (DOM convention: +y is
 * down). Dragging right moves content right, so the target moves left.
 */
export function screenDeltaToTargetDelta(
  pose: IsoPose,
  zoom: number,
  dxPx: number,
  dyPx: number,
): Vector3Tuple {
  const basis = cameraBasis(pose);
  const g = groundUp(basis);
  const sx = dxPx / zoom;
  const sy = dyPx / zoom;
  // target -= right * sx (content follows to the right)
  // target += groundUp * sy (content follows downward = camera moves screen-up)
  return [-basis.right[0] * sx + g[0] * sy, 0, -basis.right[2] * sx + g[2] * sy];
}

/** `target` panned by a screen drag. Target height (y) never changes. */
export function panTarget(
  target: Vector3Tuple,
  pose: IsoPose,
  zoom: number,
  dxPx: number,
  dyPx: number,
): Vector3Tuple {
  const d = screenDeltaToTargetDelta(pose, zoom, dxPx, dyPx);
  return [target[0] + d[0], target[1], target[2] + d[2]];
}

/**
 * Zoom about a screen point (map / CAD convention: what is under the cursor
 * stays under the cursor). `offsetX/Y` are CSS px from the canvas centre
 * (+y down). The zoom is clamped first, so hitting the limit does not drift
 * the target.
 */
export function zoomAtScreenPoint(
  target: Vector3Tuple,
  pose: IsoPose,
  zoom: number,
  nextZoom: number,
  offsetX: number,
  offsetY: number,
): { zoom: number; target: Vector3Tuple } {
  const z = clampZoom(nextZoom);
  if (z === zoom) return { zoom, target };
  // The world point under the cursor sits at target - delta(offset) at the old
  // zoom (a pan by -offset brings it to the centre). Keep it fixed:
  // t' = t + delta(offset at zoom') - delta(offset at zoom), with delta linear in 1/zoom.
  const before = screenDeltaToTargetDelta(pose, zoom, offsetX, offsetY);
  const after = screenDeltaToTargetDelta(pose, z, offsetX, offsetY);
  return {
    zoom: z,
    target: [target[0] + after[0] - before[0], target[1], target[2] + after[2] - before[2]],
  };
}

export type WheelIntent = 'pinch' | 'zoom' | 'pan';

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages. */
  deltaMode: number;
  ctrlKey: boolean;
  shiftKey?: boolean;
  /** Legacy Chromium/WebKit field; undefined in Firefox. */
  wheelDeltaY?: number;
}

/**
 * Map a wheel event onto the common map / CAD convention (Figma, Miro,
 * tldraw):
 * - `pinch`: trackpad pinch. Browsers report it as a wheel event with
 *   `ctrlKey` set (also Ctrl + mouse wheel, which reads as zoom too).
 * - `pan`: two-finger trackpad scroll, or Shift + wheel.
 * - `zoom`: a mouse wheel notch.
 *
 * Telling a mouse wheel from a trackpad scroll is a heuristic: browsers do
 * not expose the device. Line/page deltaMode (Firefox mouse) is a wheel. Any
 * deltaX is a trackpad (mice only scroll Y). In Chromium/WebKit a trackpad
 * reports `wheelDeltaY === -3 * deltaY`; a mouse reports wheelDeltaY in
 * +/-120 steps that do not follow that ratio.
 * NOTE for later agents: this was written without trackpad/mouse hardware in
 * the loop (headless only). If a real mouse pans instead of zooming on some
 * OS/browser, log `deltaY`/`wheelDeltaY`/`deltaMode` there and extend the
 * `isMouseWheel` branch; the pinch and Shift paths do not depend on it.
 */
export function classifyWheel(e: WheelLike): WheelIntent {
  if (e.ctrlKey) return 'pinch';
  if (e.shiftKey) return 'pan';
  if (e.deltaMode !== 0) return 'zoom';
  if (e.deltaX !== 0) return 'pan';
  if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0) {
    return e.wheelDeltaY === -3 * e.deltaY ? 'pan' : 'zoom';
  }
  // No legacy field (Firefox, pixel mode): a large integer step is a notch.
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 ? 'zoom' : 'pan';
}

/** Mouse wheel notch factor (unchanged from the original wheel handler). */
export const WHEEL_ZOOM_STEP = 1.2;
/** Pinch sensitivity: zoom *= exp(-deltaY * PINCH_ZOOM_RATE). */
export const PINCH_ZOOM_RATE = 0.01;

/** Next zoom (unclamped) for a `zoom` or `pinch` wheel event. */
export function wheelZoomFactor(intent: Exclude<WheelIntent, 'pan'>, deltaY: number): number {
  if (deltaY === 0) return 1;
  if (intent === 'pinch') return Math.exp(-deltaY * PINCH_ZOOM_RATE);
  return deltaY > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;
}
