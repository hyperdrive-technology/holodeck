/**
 * Controlled camera for ProcessEditor (holodeck#100): the host stores the
 * view per document and hands it back on reopen. Shape matches Studio's
 * `StudioCamera` (apps/studio/src/documents/db.ts) so it can be stored as is.
 */
import type { Vector3Tuple } from 'three';
import type { IsoPose } from '../iso/pose';
import { clampZoom } from '../iso/pan';

export interface EditorCamera {
  /** Orthographic zoom (px per world unit), clamped to the editor's zoom range. */
  zoom: number;
  /** Look-at point in world space. */
  target: [number, number, number];
  /** View yaw in radians (default: the home iso yaw). */
  yaw?: number;
  /** Top-down 2D view instead of 2.5D. */
  topDown?: boolean;
}

/** How long the view must be still before `onCameraChange` fires (one call per gesture, not per frame). */
export const CAMERA_CHANGE_DEBOUNCE_MS = 200;

export function isValidCamera(c: unknown): c is EditorCamera {
  if (!c || typeof c !== 'object') return false;
  const cam = c as EditorCamera;
  return (
    typeof cam.zoom === 'number' && Number.isFinite(cam.zoom) && cam.zoom > 0 &&
    Array.isArray(cam.target) && cam.target.length === 3 && cam.target.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    (cam.yaw === undefined || (typeof cam.yaw === 'number' && Number.isFinite(cam.yaw))) &&
    (cam.topDown === undefined || typeof cam.topDown === 'boolean')
  );
}

export function cameraFromView(zoom: number, target: Vector3Tuple, pose: IsoPose): EditorCamera {
  return { zoom, target: [target[0], target[1], target[2]], yaw: pose.yaw, topDown: pose.radius < 1e-3 };
}

/** Pose for a stored camera: yaw from the camera, radius from home (0 when top-down). */
export function poseFromCamera(camera: EditorCamera, home: IsoPose): IsoPose {
  return { yaw: camera.yaw ?? home.yaw, radius: camera.topDown ? 0 : home.radius, height: home.height };
}

export function clampCamera(camera: EditorCamera): EditorCamera {
  return { ...camera, zoom: clampZoom(camera.zoom) };
}

const EPS = 1e-6;

export function sameCamera(a: EditorCamera | null | undefined, b: EditorCamera | null | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.zoom - b.zoom) < EPS &&
    a.target.every((v, i) => Math.abs(v - b.target[i]!) < EPS) &&
    Math.abs((a.yaw ?? 0) - (b.yaw ?? 0)) < EPS &&
    Boolean(a.topDown) === Boolean(b.topDown)
  );
}
