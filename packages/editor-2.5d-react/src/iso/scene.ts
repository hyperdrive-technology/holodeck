/**
 * Scene JSON: placements of library objects at grid (x, y).
 *
 * World X = x * gridCellSize + cell/2
 * World Z = y * gridCellSize + cell/2
 * Grid Y maps to Three.js Z.
 *
 * Origin is the holding-tank center. A tank occupies a 2×2 footprint, so
 * pipes attach at the edge (±1 cell), not through the center.
 * +X is toward ingredient B (screen down-right).
 * +Y is toward packaging / steam (screen down-left). Pipes are axis-aligned.
 */

import { GRID_CELL_SIZE, gridToWorld, worldToGrid } from './grid';
import { getDefaultIsoRegistry } from '../registry/default';
import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPartDefinition } from '../registry/types';
import { MAX_GRID_COORD } from '../routing/grid';
import { footprintBounds, GeometryRangeError, NON_OBSTACLE_PARTS, rotatedFootprint } from '../routing/occupancy';

export { GRID_CELL_SIZE, gridToWorld, worldToGrid };

/** Part id. Open string: any installed `holodeck.iso.part` is valid. */
export type LibraryObject = string;

export interface IsoPlacement {
  id: string;
  /** Part id (`holodeck.iso.part` contribution) to instance. */
  object: LibraryObject;
  x: number;
  y: number;
  rotation?: number;
  toX?: number;
  toY?: number;
  fillColor?: string;
  height?: number;
  width?: number;
  handwheel?: string;
  band?: string;
  color?: string;
  size?: number;
  /** Static param values (edit-mode sliders). Live `metrics` override these. */
  params?: Record<string, unknown>;
  /** param -> animator override (`holodeck.iso.animator` id + settings). */
  animation?: Record<string, { animator: string; settings?: Record<string, unknown> }>;
  /** Host bags keyed by extension id (e.g. tag bindings); opaque to the editor. */
  extensions?: Record<string, unknown>;
  /** Screen-space px on the frozen 760×540 snapshot (CSS translate). */
  nudgeX?: number;
  nudgeY?: number;
  /** Visual center on reference-canvas.png (760×540); used when SnapshotLabelLock is on. */
  screenX?: number;
  screenY?: number;
}

export interface IsoSceneFile {
  id: string;
  name: string;
  gridCellSize: number;
  objects: IsoPlacement[];
  /** `holodeck.iso.theme` id; absent = the default Holodeck look. */
  theme?: string;
  /** Host bags keyed by extension id; opaque to the editor. */
  extensions?: Record<string, unknown>;
}

/** @deprecated use `IsoSceneFile` */
export type SceneFile = IsoSceneFile;
/** @deprecated use `IsoPlacement` */
export type ScenePlacement = IsoPlacement;

export function sceneBounds(objects: readonly IsoPlacement[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x);
    maxY = Math.max(maxY, obj.y);
    if (typeof obj.toX === 'number') {
      minX = Math.min(minX, obj.toX);
      maxX = Math.max(maxX, obj.toX);
    }
    if (typeof obj.toY === 'number') {
      minY = Math.min(minY, obj.toY);
      maxY = Math.max(maxY, obj.toY);
    }
    if (typeof obj.width === 'number') {
      minX = Math.min(minX, obj.x - obj.width / 2);
      maxX = Math.max(maxX, obj.x + obj.width / 2);
    }
    if (typeof obj.height === 'number' && obj.object === 'area') {
      minY = Math.min(minY, obj.y - obj.height / 2);
      maxY = Math.max(maxY, obj.y + obj.height / 2);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Fields that older scene files stored on the placement and that are now part params. */
const LEGACY_PARAM_FIELDS: Record<string, string> = { fill: 'level', text: 'text' };

/**
 * Move pre-registry fields (`fill`, `text`) into `params` when the part
 * declares a matching param, so old scene files keep loading. `bind` was
 * replaced by host-side bindings and is dropped. Returns a copy.
 */
function migrateLegacyPlacement(def: IsoPartDefinition, raw: Record<string, unknown>): IsoPlacement {
  const next: Record<string, unknown> = { ...raw };
  for (const [field, param] of Object.entries(LEGACY_PARAM_FIELDS)) {
    if (field in next && param in def.params) {
      const params = { ...((next.params as Record<string, unknown> | undefined) ?? {}) };
      if (!(param in params)) params[param] = next[field];
      next.params = params;
      delete next[field];
    }
  }
  delete next.bind;
  return next as unknown as IsoPlacement;
}

/**
 * Grid-space placement fields that must be finite and within +-MAX_GRID_COORD
 * when present. JSON can't spell Infinity, but `1e400` parses to it, and an
 * infinite coordinate hung the router's cell loops (holodeck#8).
 */
const OPTIONAL_GRID_FIELDS = ['toX', 'toY', 'width', 'height', 'size'] as const;
/** Other numeric placement fields: only need to be finite when present. */
const OPTIONAL_FINITE_FIELDS = ['rotation', 'nudgeX', 'nudgeY', 'screenX', 'screenY'] as const;

function isGridNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_GRID_COORD;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate a scene file. Every `object` must name a part installed in
 * `registry` (default: the built-in parts). Throws on the first problem.
 * Does not mutate `raw`.
 */
export function parseSceneFile(
  raw: unknown,
  registry: ContributionRegistry = getDefaultIsoRegistry(),
): IsoSceneFile {
  return validateSceneFile(raw, registry);
}

/**
 * Shared persisted-scene validation for parsing and editor mutations. Checks
 * numeric fields and effective (rotated, param-sized) footprints without
 * enumerating cells. The editor rejects edits that fail these same limits.
 */
export function validateSceneFile(raw: unknown, registry: ContributionRegistry): IsoSceneFile {
  if (!isRecord(raw)) {
    throw new Error('scene must be an object');
  }
  const file = raw as unknown as IsoSceneFile;
  if (!Array.isArray(file.objects)) {
    throw new Error('scene.objects must be an array');
  }
  if (file.theme !== undefined && typeof file.theme !== 'string') {
    throw new Error('scene.theme must be a string');
  }
  if (file.extensions !== undefined && !isRecord(file.extensions)) {
    throw new Error('scene.extensions must be an object');
  }
  if (
    file.gridCellSize !== undefined &&
    (typeof file.gridCellSize !== 'number' || !Number.isFinite(file.gridCellSize) || file.gridCellSize <= 0)
  ) {
    throw new Error(`scene.gridCellSize must be a finite number > 0, got ${String(file.gridCellSize)}`);
  }
  const objects: IsoPlacement[] = [];
  for (const obj of file.objects) {
    if (!isRecord(obj)) {
      throw new Error('scene.objects entries must be records');
    }
    if (typeof obj.id !== 'string' || typeof obj.object !== 'string') {
      throw new Error(`placement missing id/object: ${JSON.stringify(obj)}`);
    }
    if (typeof obj.x !== 'number' || typeof obj.y !== 'number' || Number.isNaN(obj.x) || Number.isNaN(obj.y)) {
      throw new Error(`placement ${obj.id} missing numeric x,y`);
    }
    for (const field of ['x', 'y', ...OPTIONAL_GRID_FIELDS] as const) {
      const v = obj[field];
      if ((field === 'x' || field === 'y' || v !== undefined) && !isGridNumber(v)) {
        throw new Error(`placement ${obj.id}: ${field} must be a finite number within +-${MAX_GRID_COORD}, got ${String(v)}`);
      }
    }
    for (const field of OPTIONAL_FINITE_FIELDS) {
      const v = obj[field];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
        throw new Error(`placement ${obj.id}: ${field} must be a finite number, got ${String(v)}`);
      }
    }
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, obj.object);
    if (!def) {
      throw new Error(`unknown library object "${obj.object}" on ${obj.id}`);
    }
    for (const bag of ['params', 'animation', 'extensions'] as const) {
      if (obj[bag] !== undefined && !isRecord(obj[bag])) {
        throw new Error(`placement ${obj.id}: ${bag} must be an object`);
      }
    }
    const placement = migrateLegacyPlacement(def, obj);
    const isRun = def.draw === 'run' || (typeof placement.toX === 'number' && typeof placement.toY === 'number');
    if (!NON_OBSTACLE_PARTS.has(placement.object) && !isRun) {
      try {
        const { w, h } = rotatedFootprint(def, placement.rotation, placement);
        footprintBounds(placement.x, placement.y, w, h);
      } catch (err) {
        if (!(err instanceof GeometryRangeError)) throw err;
        throw new Error(`placement ${placement.id}: ${err.message}`);
      }
    }
    objects.push(placement);
  }
  const ids = objects.map((o) => o.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) {
    throw new Error(`duplicate placement ids: ${dup.join(', ')}`);
  }
  return { ...file, objects };
}
