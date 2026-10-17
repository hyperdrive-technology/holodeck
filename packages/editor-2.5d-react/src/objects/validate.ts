/**
 * Validation for the Arcentry-parity object model (lane E2, holodeck#36):
 * param values against their spec, per-placement metadata, opacity / z-order,
 * connector links and asset URLs. Pure, no three / React imports.
 *
 * Every rule here has a twin in the JSON Schema
 * (schema/holodeck-iso-scene.v1.schema.json); `scene-schema.test.ts` runs the
 * same good / bad fixtures through both so they cannot drift apart. Rules
 * JSON Schema cannot express (a param value checked against the installed
 * part's spec) live only here.
 *
 * Same stance as holodeck#19: reject non-finite and unbounded input at the
 * door instead of letting a renderer loop or allocate on it.
 */

import { MAX_GRID_COORD } from '../routing/grid';
import type { IsoPartParamSpec } from '../registry/types';

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_COLOR.test(v);
}

/** Longest string param value unless the spec sets `maxLength`. */
export const MAX_PARAM_STRING = 4096;
/** Metadata rows per placement, key length, string value length. */
export const MAX_META_ENTRIES = 32;
export const MAX_META_KEY = 64;
export const MAX_META_VALUE = 256;
/** z-order is an integer in +-MAX_Z (it becomes a three.js renderOrder offset). */
export const MAX_Z = 1000;
/** Waypoints on one connector. */
export const MAX_LINK_VIA = 64;
/** Longest asset URL (data: URLs for small SVG logos included). */
export const MAX_URL_LENGTH = 65_536;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function isGridNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_GRID_COORD;
}

/**
 * Asset URL accepted for logos and images: relative paths, http(s), blob: and
 * `data:image/...`. Anything else (`javascript:`, `file:`, ...) is rejected:
 * scene files are shareable documents and must not smuggle other schemes in.
 */
export function assetUrlProblem(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return 'must be a non-empty URL string';
  if (v.length > MAX_URL_LENGTH) return `must be at most ${MAX_URL_LENGTH} characters`;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(v)?.[1]?.toLowerCase();
  if (scheme === undefined) return null; // relative path
  if (scheme === 'http' || scheme === 'https' || scheme === 'blob') return null;
  if (scheme === 'data' && /^data:image\//i.test(v)) return null;
  return `scheme "${scheme}:" is not allowed (http, https, blob, data:image or a relative path)`;
}

/**
 * Why `value` is not acceptable for `spec`, or null when it is. `null` and
 * `undefined` are always accepted: they mean "no value" (resolveParams falls
 * back to the spec default for undefined; null is a host's "no reading").
 */
export function paramValueProblem(spec: IsoPartParamSpec, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  switch (spec.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `must be a finite number, got ${String(value)}`;
      if (spec.min !== undefined && value < spec.min) return `must be >= ${spec.min}, got ${value}`;
      if (spec.max !== undefined && value > spec.max) return `must be <= ${spec.max}, got ${value}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `must be a boolean, got ${JSON.stringify(value)}`;
    case 'enum':
      return typeof value === 'string' && (spec.options ?? []).includes(value)
        ? null
        : `must be one of ${(spec.options ?? []).join(', ')}, got ${JSON.stringify(value)}`;
    case 'color':
      return value === '' || isHexColor(value) ? null : `must be a hex colour (#rgb, #rrggbb, #rrggbbaa) or "", got ${JSON.stringify(value)}`;
    case 'string': {
      // Hidden string params may be object-valued in scene files (label `labels`: {"0": "Idle"}).
      if (spec.hidden && isRecord(value)) return jsonValueProblem(value, 0);
      if (typeof value !== 'string') return `must be a string, got ${JSON.stringify(value)}`;
      const max = spec.format === 'url' ? MAX_URL_LENGTH : (spec.maxLength ?? MAX_PARAM_STRING);
      if (value.length > max) return `must be at most ${max} characters`;
      return spec.format === 'url' && value !== '' ? assetUrlProblem(value) : null;
    }
    default:
      return null;
  }
}

/** Plain JSON data with finite numbers, bounded depth: what an undeclared param may hold. */
export function jsonValueProblem(value: unknown, depth: number): string | null {
  if (depth > 8) return 'is nested too deeply';
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : `must be finite, got ${String(value)}`;
  if (typeof value === 'string') return value.length <= MAX_PARAM_STRING ? null : `must be at most ${MAX_PARAM_STRING} characters`;
  if (Array.isArray(value)) {
    for (const item of value) {
      const p = jsonValueProblem(item, depth + 1);
      if (p) return p;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const p = jsonValueProblem(item, depth + 1);
      if (p) return p;
    }
    return null;
  }
  return `must be JSON data, got ${typeof value}`;
}

/**
 * Problems with `params` against a part's specs. Declared params are checked
 * against their spec; undeclared ones (hosts may drive GLB `animNodes` params
 * the part did not declare) only need to be finite JSON data.
 */
export function paramsProblems(
  placementId: string,
  specs: Record<string, IsoPartParamSpec>,
  params: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(params)) {
    const spec = Object.prototype.hasOwnProperty.call(specs, name) ? specs[name] : undefined;
    const problem = spec ? paramValueProblem(spec, value) : jsonValueProblem(value, 0);
    if (problem) out.push(`placement ${placementId}: params.${name} ${problem}`);
  }
  return out;
}

/** Metadata shown on the metadata plane under a component: short key -> scalar rows. */
export type IsoMetaValue = string | number | boolean;

export function metaProblems(placementId: string, meta: unknown): string[] {
  if (meta === undefined) return [];
  if (!isRecord(meta)) return [`placement ${placementId}: meta must be an object of key -> string | number | boolean`];
  const entries = Object.entries(meta);
  const out: string[] = [];
  if (entries.length > MAX_META_ENTRIES) out.push(`placement ${placementId}: meta has ${entries.length} entries (max ${MAX_META_ENTRIES})`);
  for (const [key, value] of entries.slice(0, MAX_META_ENTRIES + 1)) {
    if (key.length === 0 || key.length > MAX_META_KEY) {
      out.push(`placement ${placementId}: meta key ${JSON.stringify(key.slice(0, 80))} must be 1..${MAX_META_KEY} characters`);
    }
    const ok =
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= MAX_META_VALUE);
    if (!ok) {
      out.push(`placement ${placementId}: meta.${key.slice(0, 80)} must be a finite number, a boolean or a string of at most ${MAX_META_VALUE} characters`);
    }
  }
  return out;
}

/** One end of a connector: a scene object (optionally one of its ports) or a free grid point. */
export type IsoLinkEnd = { object: string; port?: string } | { x: number; y: number };

/**
 * Connector anchors (`placement.link`). Free ends default to the placement's
 * own `x, y` (from) and `toX, toY` (to), so a free-floating line needs no
 * `link` at all. `via` waypoints make the line a fixed polyline (no routing).
 */
export interface IsoLink {
  from?: IsoLinkEnd;
  to?: IsoLinkEnd;
  via?: Array<{ x: number; y: number }>;
}

function linkEndProblem(v: unknown): string | null {
  if (!isRecord(v)) return 'must be { object, port? } or { x, y }';
  const keys = Object.keys(v);
  if ('object' in v) {
    if (typeof v.object !== 'string' || v.object.length === 0) return 'object must be a placement id';
    if (v.port !== undefined && (typeof v.port !== 'string' || v.port.length === 0)) return 'port must be a port name';
    const extra = keys.filter((k) => k !== 'object' && k !== 'port');
    return extra.length ? `unknown field(s) ${extra.join(', ')}` : null;
  }
  if (!isGridNumber(v.x) || !isGridNumber(v.y)) return `x and y must be finite numbers within +-${MAX_GRID_COORD}`;
  const extra = keys.filter((k) => k !== 'x' && k !== 'y');
  return extra.length ? `unknown field(s) ${extra.join(', ')}` : null;
}

export function linkProblems(placementId: string, link: unknown): string[] {
  if (link === undefined) return [];
  if (!isRecord(link)) return [`placement ${placementId}: link must be an object`];
  const out: string[] = [];
  for (const key of Object.keys(link)) {
    if (key !== 'from' && key !== 'to' && key !== 'via') out.push(`placement ${placementId}: link.${key} is not a link field`);
  }
  for (const end of ['from', 'to'] as const) {
    if (link[end] === undefined) continue;
    const p = linkEndProblem(link[end]);
    if (p) out.push(`placement ${placementId}: link.${end} ${p}`);
  }
  if (link.via !== undefined) {
    if (!Array.isArray(link.via) || link.via.length > MAX_LINK_VIA) {
      out.push(`placement ${placementId}: link.via must be an array of at most ${MAX_LINK_VIA} points`);
    } else {
      link.via.forEach((pt, i) => {
        if (!isRecord(pt) || !isGridNumber(pt.x) || !isGridNumber(pt.y) || Object.keys(pt).length !== 2) {
          out.push(`placement ${placementId}: link.via[${i}] must be { x, y } within +-${MAX_GRID_COORD}`);
        }
      });
    }
  }
  return out;
}

/** opacity (0..1) and z (integer, +-MAX_Z) on any placement. */
export function appearanceProblems(placementId: string, raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  const { opacity, z } = raw;
  if (opacity !== undefined && (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)) {
    out.push(`placement ${placementId}: opacity must be a number between 0 and 1, got ${String(opacity)}`);
  }
  if (z !== undefined && (typeof z !== 'number' || !Number.isInteger(z) || Math.abs(z) > MAX_Z)) {
    out.push(`placement ${placementId}: z must be an integer within +-${MAX_Z}, got ${String(z)}`);
  }
  return out;
}
