/**
 * Pure rules behind the studio inspector: reading effective param values and
 * turning what the user typed into a valid value (or a reason it is not).
 */

import type { IsoPartParamSpec, IsoPlacement } from '@holodeck/editor-2.5d-react';

/** Radians -> whole degrees in [0, 360). */
export function rotationDegrees(rotation: number | undefined): number {
  const deg = Math.round((((rotation ?? 0) * 180) / Math.PI) % 360);
  return deg < 0 ? deg + 360 : deg === 360 ? 0 : deg;
}

/** Quarter-turn a rotation (radians), normalised to [0, 2π) so it never drifts. */
export function rotateQuarter(rotation: number | undefined, direction: 1 | -1): number {
  const quarters = Math.round(((rotation ?? 0) / (Math.PI / 2)) % 4) + direction;
  return (((quarters % 4) + 4) % 4) * (Math.PI / 2);
}

/** The value the part renders with: the placement's own, else the spec default. */
export function paramValue(placement: IsoPlacement, name: string, spec: IsoPartParamSpec): unknown {
  const own = placement.params?.[name];
  return own === undefined ? spec.default : own;
}

export type Coerced = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Typed input -> param value. Numbers must be finite and are clamped to
 * `min`/`max`; enums must be one of `options`; booleans pass through.
 */
export function coerceParam(spec: IsoPartParamSpec, input: string | boolean): Coerced {
  switch (spec.type) {
    case 'boolean':
      return typeof input === 'boolean' ? { ok: true, value: input } : { ok: false, reason: 'expected on/off' };
    case 'number': {
      if (typeof input !== 'string' || input.trim() === '') return { ok: false, reason: 'enter a number' };
      const n = Number(input);
      if (!Number.isFinite(n)) return { ok: false, reason: 'enter a finite number' };
      let value = n;
      if (spec.min !== undefined) value = Math.max(spec.min, value);
      if (spec.max !== undefined) value = Math.min(spec.max, value);
      return { ok: true, value };
    }
    case 'enum': {
      const options = spec.options ?? [];
      return typeof input === 'string' && options.includes(input)
        ? { ok: true, value: input }
        : { ok: false, reason: `choose one of ${options.join(', ')}` };
    }
    case 'string':
      return typeof input === 'string' ? { ok: true, value: input } : { ok: false, reason: 'expected text' };
  }
}

/** A grid coordinate typed by the user: finite, rounded to 2 decimals (the grid is cell-based). */
export function coerceCoordinate(input: string): Coerced {
  if (input.trim() === '') return { ok: false, reason: 'enter a number' };
  const n = Number(input);
  if (!Number.isFinite(n)) return { ok: false, reason: 'enter a finite number' };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Params the inspector shows: declared, not `hidden`, in declaration order. */
export function visibleParams(params: Record<string, IsoPartParamSpec>): Array<[string, IsoPartParamSpec]> {
  return Object.entries(params).filter(([, spec]) => !spec.hidden);
}
