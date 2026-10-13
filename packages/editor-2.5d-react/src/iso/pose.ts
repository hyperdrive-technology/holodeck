/**
 * Orthographic isometric pose: camera on the space diagonal so X and Z
 * foreshorten equally and vertical edges stay vertical. Zoom changes the
 * frustum; Y stays fixed. Top-down collapses the ground-plane radius.
 */

export const ISO_VIEW_DISTANCE = 1500;

export interface IsoPose {
  /** Radians around Y (0 = +X). */
  yaw: number;
  /** Distance from the look-at point on the XZ plane. */
  radius: number;
  /** Camera Y. Distance is determined by zoom, not this. */
  height: number;
}

export function initialIsoPose(distance = ISO_VIEW_DISTANCE): IsoPose {
  return {
    yaw: Math.PI / 4,
    radius: Math.hypot(distance, distance),
    height: distance,
  };
}

export function posePosition(pose: IsoPose): [number, number, number] {
  return [
    pose.radius * Math.cos(pose.yaw),
    pose.height,
    pose.radius * Math.sin(pose.yaw),
  ];
}

/** ±90° around the current center. `direction` is +1 (left) or -1 (right). */
export function rotatePose(pose: IsoPose, direction: 1 | -1): IsoPose {
  return { ...pose, yaw: pose.yaw + direction * (Math.PI / 2) };
}

/**
 * 2.5D ↔ 2D. Entering top-down adds π/4 and zeroes the radius.
 * Leaving restores the previous isometric radius and subtracts π/4.
 */
export function toggleTopDown(pose: IsoPose, isometricRadius: number): IsoPose {
  const topDown = pose.radius < 1e-3;
  if (topDown) {
    return {
      yaw: pose.yaw - Math.PI / 4,
      radius: isometricRadius,
      height: pose.height,
    };
  }
  return {
    yaw: pose.yaw + Math.PI / 4,
    radius: 0,
    height: pose.height,
  };
}

export function lerpPose(from: IsoPose, to: IsoPose, t: number): IsoPose {
  const u = Math.min(1, Math.max(0, t));
  return {
    yaw: from.yaw + (to.yaw - from.yaw) * u,
    radius: from.radius + (to.radius - from.radius) * u,
    height: from.height + (to.height - from.height) * u,
  };
}

