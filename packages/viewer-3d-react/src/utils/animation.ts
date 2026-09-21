import type { Animation, AnimationTrack, Keyframe } from '@holodeck/sdk';
import type { Object3D } from 'three';

/**
 * Apply CSS-like easing to a normalized [0, 1] progress value.
 */
export function applyEasing(
  t: number,
  easing: Keyframe['easing'] = 'linear'
): number {
  const x = Math.min(1, Math.max(0, t));
  switch (easing) {
    case 'ease-in':
      return x * x;
    case 'ease-out':
      return x * (2 - x);
    case 'ease-in-out':
      return x < 0.5 ? 2 * x * x : -1 + (4 - 2 * x) * x;
    case 'linear':
    default:
      return x;
  }
}

/**
 * Interpolate a sorted keyframe track at `time` (seconds).
 * Numeric values lerp; everything else steps at the midpoint.
 */
export function interpolateKeyframes(
  keyframes: Keyframe[],
  time: number
): unknown {
  if (keyframes.length === 0) {
    return undefined;
  }

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sorted[0].time) {
    return sorted[0].value;
  }
  if (time >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }

  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1].time < time) {
    i += 1;
  }

  const a = sorted[i];
  const b = sorted[i + 1];
  const span = b.time - a.time;
  const rawT = span === 0 ? 1 : (time - a.time) / span;
  const t = applyEasing(rawT, b.easing ?? a.easing ?? 'linear');

  if (typeof a.value === 'number' && typeof b.value === 'number') {
    return a.value + (b.value - a.value) * t;
  }

  return t < 1 ? a.value : b.value;
}

/**
 * Resolve local animation clock, honouring `loop`.
 */
export function animationLocalTime(
  animation: Animation,
  elapsedSeconds: number
): number {
  if (animation.duration <= 0) {
    return 0;
  }
  if (animation.loop) {
    return elapsedSeconds % animation.duration;
  }
  return Math.min(elapsedSeconds, animation.duration);
}

/**
 * Evaluate every track on an animation at the given elapsed time.
 * Returns property-path → value entries ready to apply to an Object3D.
 */
export function evaluateAnimation(
  animation: Animation,
  elapsedSeconds: number
): Array<{ property: string; value: unknown }> {
  const local = animationLocalTime(animation, elapsedSeconds);
  return animation.tracks.map((track: AnimationTrack) => ({
    property: track.property,
    value: interpolateKeyframes(track.keyframes, local),
  }));
}

/**
 * Apply a dotted property path onto a Three.js Object3D.
 * Supports `transform.position|rotation|scale.[xyz]`, `visible`, and nested paths.
 */
export function applyPropertyPath(
  object: Object3D,
  property: string,
  value: unknown
): void {
  if (value === undefined) {
    return;
  }

  const path = property.startsWith('transform.')
    ? property.slice('transform.'.length)
    : property;

  if (path === 'visible' && typeof value === 'boolean') {
    object.visible = value;
    return;
  }

  const parts = path.split('.');
  if (parts.length === 2) {
    const [channel, axis] = parts;
    if (
      (channel === 'position' ||
        channel === 'rotation' ||
        channel === 'scale') &&
      (axis === 'x' || axis === 'y' || axis === 'z') &&
      typeof value === 'number'
    ) {
      object[channel][axis] = value;
      return;
    }
  }

  // Generic nested walk for any remaining dotted path on the object.
  let target: unknown = object;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (target == null || typeof target !== 'object') {
      return;
    }
    target = (target as Record<string, unknown>)[parts[i]];
  }
  if (target != null && typeof target === 'object') {
    (target as Record<string, unknown>)[parts[parts.length - 1]] = value;
  }
}
