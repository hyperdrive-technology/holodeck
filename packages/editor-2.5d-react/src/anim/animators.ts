import type { Euler, Mesh, Vector3 } from 'three';
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
type Axis = 'x' | 'y' | 'z';
/** `settings.axis` as an axis; anything else is `fallback`. */
const axisOf = (v: unknown, fallback: Axis = 'y'): Axis => (v === 'x' || v === 'y' || v === 'z' ? v : fallback);

/**
 * 0..1 fraction of a param value against a full-scale `scale` setting:
 * `true` = 1 and `false` = 0 (an on/off valve), a number is `value / scale`
 * clamped to 0..1 (`scale: 100` for a percent), and anything else (absent,
 * NaN, a string) is 0, so the node shows its value-0 pose rather than
 * freezing wherever it was. A non-positive scale falls back to 1.
 */
export function fractionOf(value: unknown, scale: unknown): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const full = num(scale, 1);
  return clamp01(value / (full > 0 ? full : 1));
}

/**
 * `settings.enableParam` gate shared by `spin` and `travel`: open when the
 * setting is empty / not a string, else while that resolved param is truthy.
 */
export function gateOpen(settings: Record<string, unknown>, params: Readonly<Record<string, unknown>> | undefined): boolean {
  const gate = settings.enableParam;
  return typeof gate !== 'string' || gate === '' || !!params?.[gate];
}

/**
 * Rotate about an axis at `value` rpm * `rpmScale`. With `enableParam` set
 * (e.g. `running`), the node only turns while that param is truthy, so a
 * motor whose speed reference stays at 100 % stops when it is switched off.
 */
export const SPIN_ANIMATOR: IsoAnimator = {
  id: 'spin',
  label: 'Spin',
  param: 'rpm',
  settings: {
    axis: { type: 'enum', label: 'Axis', default: 'y', options: ['x', 'y', 'z'] },
    rpmScale: { type: 'number', label: 'RPM scale', default: 1, min: 0, max: 100, step: 0.1 },
    // '' = always on. Read from the placement's resolved params (IsoAnimatorContext.params).
    enableParam: { type: 'string', label: 'Only while param is on', default: '' },
  },
  apply({ node, value, dt, settings, params }) {
    if (!gateOpen(settings, params)) return;
    const rpm = num(value, 0) * num(settings.rpmScale, 1);
    node.rotation[axisOf(settings.axis)] += (rpm * Math.PI * 2 * dt) / 60;
  },
};

const TRAVEL_BASE = 'hdTravelBase';

/**
 * Linear travel: the node moves `distance` world units (in its parent's
 * frame, along `axis`) times the value's fraction of `scale`, from its
 * authored position. A control-valve stem modelled closed rises by its
 * stroke as `position` goes 0 -> 100 % (`scale: 100`). Restoring: value 0,
 * `false` or garbage puts the node back where it was authored.
 *
 * Reciprocating (`cycleHz` > 0): the node strokes out and back at that
 * rate, `distance * fraction` at the far end (a metering-pump plunger whose
 * `stroke` param sets the length), smoothly from the authored position:
 * offset = full * (1 - cos(2 pi f t)) / 2. With `enableParam` set (e.g.
 * `running`) it only moves while that param is truthy and rests at the
 * authored position otherwise; the gate applies to the static mode too.
 */
export const TRAVEL_ANIMATOR: IsoAnimator = {
  id: 'travel',
  label: 'Linear travel',
  param: 'position',
  settings: {
    axis: { type: 'enum', label: 'Axis', default: 'y', options: ['x', 'y', 'z'] },
    distance: { type: 'number', label: 'Travel at full scale', default: 0.1, min: -10, max: 10, step: 0.01, unit: 'cells' },
    scale: { type: 'number', label: 'Full-scale value', default: 1, min: 0.001, max: 100000, step: 1 },
    // 0 = follow the value (a valve stem); > 0 = stroke out and back this many times a second.
    cycleHz: { type: 'number', label: 'Strokes per second', default: 0, min: 0, max: 20, step: 0.1, unit: 'Hz' },
    enableParam: { type: 'string', label: 'Only while param is on', default: '' },
  },
  apply({ node, value, elapsed, settings, params }) {
    const base = (node.userData[TRAVEL_BASE] ??= node.position.clone()) as Vector3;
    const axis = axisOf(settings.axis);
    node.position.copy(base);
    if (!gateOpen(settings, params)) return;
    const full = fractionOf(value, settings.scale) * num(settings.distance, 0.1);
    const hz = num(settings.cycleHz, 0);
    node.position[axis] += hz > 0 ? (full * (1 - Math.cos(2 * Math.PI * hz * elapsed))) / 2 : full;
  },
};

const TURN_BASE = 'hdTurnBase';

/**
 * Turn to an angle between `fromDeg` (value 0) and `toDeg` (full scale)
 * about `axis`, added to the authored rotation. A ball valve modelled open
 * with a quarter-turn lever uses `fromDeg: 90, toDeg: 0` (closed = turned
 * 90 degrees, open = as authored); a gauge needle sweeps -135 .. 135.
 * Absolute, not accumulating like `spin`, so it is restoring by construction.
 */
export const TURN_ANIMATOR: IsoAnimator = {
  id: 'turn',
  label: 'Turn to angle',
  param: 'open',
  settings: {
    axis: { type: 'enum', label: 'Axis', default: 'y', options: ['x', 'y', 'z'] },
    fromDeg: { type: 'number', label: 'Angle at 0', default: 0, min: -360, max: 360, step: 1, unit: '°' },
    toDeg: { type: 'number', label: 'Angle at full scale', default: 90, min: -360, max: 360, step: 1, unit: '°' },
    scale: { type: 'number', label: 'Full-scale value', default: 1, min: 0.001, max: 100000, step: 1 },
  },
  apply({ node, value, settings }) {
    const base = (node.userData[TURN_BASE] ??= node.rotation.clone()) as Euler;
    const axis = axisOf(settings.axis);
    const from = num(settings.fromDeg, 0);
    const to = num(settings.toDeg, 90);
    const deg = from + (to - from) * fractionOf(value, settings.scale);
    node.rotation.copy(base);
    node.rotation[axis] += (deg * Math.PI) / 180;
  },
};

/**
 * Scale Y to the 0..1 value (or 0..`scale` when the `scale` setting is set,
 * e.g. `scale: 100` for a percent param). Matches the GLB liquid convention: the node's
 * origin sits at the liquid bottom, so scaling Y grows it upward.
 * Floors at 0.001: a zero scale makes a singular matrix (NaN normals, and
 * the node cannot be raycast).
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
    node.scale.y = Math.max(0.001, clamp01(num(value, 0) / (full > 0 ? full : 1)));
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
  TRAVEL_ANIMATOR,
  TURN_ANIMATOR,
];
