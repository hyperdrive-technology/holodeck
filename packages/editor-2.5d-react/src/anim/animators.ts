import type { Mesh, Vector3 } from 'three';
import type { IsoAnimator } from '../registry/types';

/**
 * Built-in animators. Each `apply` is pure over (node, value, dt, elapsed,
 * settings) so it can be tested on a dummy Object3D with no renderer.
 *
 * Animators must be restoring: when the value goes falsy / out of range the
 * node returns to its authored pose, otherwise a stopped agitator or a
 * silenced alarm would freeze mid-animation.
 */

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Rotate about an axis at `value` rpm * `rpmScale`. */
export const SPIN_ANIMATOR: IsoAnimator = {
  id: 'spin',
  label: 'Spin',
  param: 'rpm',
  settings: {
    axis: { type: 'enum', label: 'Axis', default: 'y', options: ['x', 'y', 'z'] },
    rpmScale: { type: 'number', label: 'RPM scale', default: 1, min: 0, max: 100, step: 0.1 },
  },
  apply({ node, value, dt, settings }) {
    const rpm = num(value, 0) * num(settings.rpmScale, 1);
    const axis = settings.axis === 'x' || settings.axis === 'z' ? settings.axis : 'y';
    node.rotation[axis] += (rpm * Math.PI * 2 * dt) / 60;
  },
};

/**
 * Scale Y to the 0..1 value (or 0..`scale` when the `scale` setting is set,
 * e.g. `scale: 100` for a percent param). Matches the GLB liquid convention: the node's
 * origin sits at the liquid bottom, so scaling Y grows it upward.
 * Floors at 0.001: a zero scale makes a singular matrix (NaN normals, and
 * the node cannot be raycast). An empty (0) value hides the node instead.
 */
export const FILL_ANIMATOR: IsoAnimator = {
  id: 'fill',
  label: 'Fill level',
  param: 'level',
  settings: {
    // Full-scale value. 1 = a 0..1 fraction; 100 = a percent from a PLC REAL.
    scale: { type: 'number', label: 'Full-scale value', default: 1, min: 0.001, max: 100000, step: 1 },
  },
  apply({ node, value, settings }) {
    const full = num(settings?.scale, 1);
    // A non-positive full scale would divide by zero; treat it as the default.
    const fraction = clamp01(num(value, 0) / (full > 0 ? full : 1));
    node.scale.y = Math.max(0.001, fraction);
    // Empty = no liquid: the 0.001 sliver read as a disc on the vessel floor (round 5, 2026-10-30).
    node.visible = fraction > 0;
  },
};

const BOB_BASE = 'hdBobBase';

/** Small sinusoidal Y offset while the value is truthy; rests at the authored Y otherwise. */
export const BOB_ANIMATOR: IsoAnimator = {
  id: 'bob',
  label: 'Bob',
  param: 'running',
  settings: {
    amplitude: { type: 'number', label: 'Amplitude', default: 0.05, min: 0, max: 1, step: 0.01 },
    speed: { type: 'number', label: 'Speed (rad/s)', default: 3, min: 0, max: 20, step: 0.1 },
  },
  apply({ node, value, elapsed, settings }) {
    const base = (node.userData[BOB_BASE] ??= node.position.y) as number;
    node.position.y = value ? base + Math.sin(elapsed * num(settings.speed, 3)) * num(settings.amplitude, 0.05) : base;
  },
};

/** `node.visible = !!value`. */
export const VISIBLE_ANIMATOR: IsoAnimator = {
  id: 'visible',
  label: 'Visible',
  param: 'visible',
  apply({ node, value }) {
    node.visible = !!value;
  },
};

const PULSE_BASE = 'hdPulseBase';

/**
 * Scale pulse (and emissive intensity where a material has one) while truthy.
 * The code-built materials are unlit MeshBasicNodeMaterial with no emissive,
 * so scale is the effect that always shows.
 */
export const PULSE_ANIMATOR: IsoAnimator = {
  id: 'pulse',
  label: 'Pulse',
  param: 'alarm',
  settings: {
    amount: { type: 'number', label: 'Amount', default: 0.08, min: 0, max: 1, step: 0.01 },
    speed: { type: 'number', label: 'Speed (rad/s)', default: 6, min: 0, max: 30, step: 0.5 },
  },
  apply({ node, value, elapsed, settings }) {
    const base = (node.userData[PULSE_BASE] ??= node.scale.clone()) as Vector3;
    const wave = value ? (Math.sin(elapsed * num(settings.speed, 6)) + 1) / 2 : 0;
    node.scale.copy(base).multiplyScalar(1 + wave * num(settings.amount, 0.08));
    node.traverse((child) => {
      const material = (child as Mesh).material as { emissiveIntensity?: number } | undefined;
      if (material && typeof material.emissiveIntensity === 'number') material.emissiveIntensity = wave;
    });
  },
};

export const BUILTIN_ISO_ANIMATORS: readonly IsoAnimator[] = [
  SPIN_ANIMATOR,
  FILL_ANIMATOR,
  BOB_ANIMATOR,
  VISIBLE_ANIMATOR,
  PULSE_ANIMATOR,
];
