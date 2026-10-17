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
import { HOLODECK_KINDS, type ContributionRegistry, type SignalBinding } from '@holodeck/sdk';
import { placementBindingProblems } from '../engine/bindings';
import type { IsoPartDefinition } from '../registry/types';
import { isRunPlacement } from '../registry/geometry';
import { MAX_GRID_COORD } from '../routing/grid';
import { footprintBounds, GeometryRangeError, isFloorPart, rotatedFootprint } from '../routing/occupancy';
import {
  appearanceProblems,
  isGridNumber,
  isRecord,
  layerGroupProblems,
  layersProblems,
  linkProblems,
  metaProblems,
  type IsoLayer,
  paramsProblems,
  type IsoLink,
  type IsoMetaValue,
} from '../objects/validate';

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
  /**
   * Inline parts (valve, pump...) drawn on the middle of a pipe: the id of
   * that pipe. Optional metadata; the part's own x,y is still what is drawn.
   * Reroute carries a part with a valid attachment to the new route
   * (routing/inline.ts). Absent = a free-standing part.
   */
  onPipe?: string;
  /** Position along `onPipe` from its (x, y) end (0) to its (toX, toY) end (1); informational, geometry wins. */
  at?: number;
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
  /**
   * param -> live signal (`{ connection, source, transform? }`, @holodeck/sdk).
   * `connection` names a `ProviderConnection` of the enclosing document;
   * `source` is the provider's own address and is never parsed here.
   */
  bindings?: Record<string, SignalBinding>;
  /** Host bags keyed by extension id (e.g. tag bindings); opaque to the editor. */
  extensions?: Record<string, unknown>;
  /**
   * 0..1, default 1. Placements below 1 render as unique meshes with their own
   * (cloned) materials, never through a shared instanced pool.
   */
  opacity?: number;
  /**
   * Draw order among overlapping objects: integer within +-1000, default 0.
   * Higher draws later (on top) when depth ties, e.g. labels over areas, an
   * area over another area. Applied as a three.js `renderOrder` offset.
   */
  z?: number;
  /**
   * Metadata plane: short key/value rows shown on the floor under the object
   * (Arcentry's "metadata"). Max 32 rows; values are scalars.
   */
  meta?: Record<string, IsoMetaValue>;
  /** Hide the metadata plane while keeping `meta` (default: shown when `meta` has rows). */
  metaHidden?: boolean;
  /** Connector anchors (`connector` part); see `IsoLink`. */
  link?: IsoLink;
  /** Editor layer id (`scene.layers`); absent = the default layer. */
  layer?: string;
  /**
   * Group id: placements sharing one select, move, copy and delete together
   * in the editor (one level, no nesting). Opaque; the editor allocates `group-N`.
   */
  group?: string;
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
  /** Editor layers (show / hide, lock); see `IsoLayer`. Absent = one implicit default layer. */
  layers?: IsoLayer[];
}

/** @deprecated use `IsoSceneFile` */
export type SceneFile = IsoSceneFile;
/** @deprecated use `IsoPlacement` */
export type ScenePlacement = IsoPlacement;

export function sceneBounds(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry = getDefaultIsoRegistry(),
): {
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
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, obj.object);
    if (isRunPlacement(obj, def)) {
      if (typeof obj.toX === 'number') {
        minX = Math.min(minX, obj.toX);
        maxX = Math.max(maxX, obj.toX);
      }
      if (typeof obj.toY === 'number') {
        minY = Math.min(minY, obj.toY);
        maxY = Math.max(maxY, obj.toY);
      }
    }
    if (typeof obj.width === 'number') {
      minX = Math.min(minX, obj.x - obj.width / 2);
      maxX = Math.max(maxX, obj.x + obj.width / 2);
    }
    if (typeof obj.height === 'number' && obj.object === 'area') {
      minY = Math.min(minY, obj.y - obj.height / 2);
      maxY = Math.max(maxY, obj.y + obj.height / 2);
    }
    const extent = def?.extent?.(obj);
    if (extent) {
      minX = Math.min(minX, extent.minX);
      minY = Math.min(minY, extent.minY);
      maxX = Math.max(maxX, extent.maxX);
      maxY = Math.max(maxY, extent.maxY);
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

/** Strict registry validation belongs at import and when introducing a part. */
export function validatePlacementPart(placement: IsoPlacement, registry: ContributionRegistry): IsoPartDefinition {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, placement.object);
  if (!def) {
    throw new Error(`unknown library object "${placement.object}" on ${placement.id}`);
  }
  return def;
}

/**
 * Validate one placement without enumerating cells. Missing parts use the
 * same 1x1 footprint as routing so uninstalling a pack still permits cleanup.
 * Registry membership is checked separately by validatePlacementPart.
 */
export function validatePlacementGeometry(raw: unknown, registry: ContributionRegistry): IsoPlacement {
  if (!isRecord(raw)) {
    throw new Error('scene.objects entries must be records');
  }
  if (typeof raw.id !== 'string' || typeof raw.object !== 'string') {
    // Never stringify the whole record: it can be untrusted and megabytes long (holodeck#119).
    const keys = Object.keys(raw).slice(0, 8).join(', ');
    throw new Error(`placement missing id/object (fields: ${keys.length > 120 ? `${keys.slice(0, 120)}…` : keys})`);
  }
  if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || Number.isNaN(raw.x) || Number.isNaN(raw.y)) {
    throw new Error(`placement ${raw.id} missing numeric x,y`);
  }
  for (const field of ['x', 'y', ...OPTIONAL_GRID_FIELDS] as const) {
    const v = raw[field];
    if ((field === 'x' || field === 'y' || v !== undefined) && !isGridNumber(v)) {
      throw new Error(`placement ${raw.id}: ${field} must be a finite number within +-${MAX_GRID_COORD}, got ${String(v)}`);
    }
  }
  for (const field of OPTIONAL_FINITE_FIELDS) {
    const v = raw[field];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
      throw new Error(`placement ${raw.id}: ${field} must be a finite number, got ${String(v)}`);
    }
  }
  if (raw.onPipe !== undefined && typeof raw.onPipe !== 'string') {
    throw new Error(`placement ${raw.id}: onPipe must be a pipe id string`);
  }
  if (raw.at !== undefined && (typeof raw.at !== 'number' || !Number.isFinite(raw.at) || raw.at < 0 || raw.at > 1)) {
    throw new Error(`placement ${raw.id}: at must be a number between 0 and 1`);
  }
  for (const bag of ['params', 'animation', 'extensions'] as const) {
    if (raw[bag] !== undefined && !isRecord(raw[bag])) {
      throw new Error(`placement ${raw.id}: ${bag} must be an object`);
    }
  }
  if (raw.metaHidden !== undefined && typeof raw.metaHidden !== 'boolean') {
    throw new Error(`placement ${raw.id}: metaHidden must be a boolean`);
  }
  // A parsed scene can go straight to ProviderHub.setBindings, which throws on malformed bindings.
  const bindingProblems = placementBindingProblems(raw.id, raw.bindings);
  if (bindingProblems.length) throw new Error(bindingProblems.join('; '));
  const objectProblems = [
    ...appearanceProblems(raw.id, raw),
    ...metaProblems(raw.id, raw.meta),
    ...linkProblems(raw.id, raw.link),
    ...layerGroupProblems(raw.id, raw),
  ];
  if (objectProblems.length) throw new Error(objectProblems.join('; '));
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, raw.object);
  const placement = def ? migrateLegacyPlacement(def, raw) : raw as unknown as IsoPlacement;
  // Param values against the installed part's specs (finite, in range, enum
  // member, hex colour...). Missing parts skip this: nothing to check against.
  if (def && placement.params) {
    const problems = paramsProblems(placement.id, def.params, placement.params);
    if (problems.length) throw new Error(problems.join('; '));
  }
  const isRun = isRunPlacement(placement, def);
  if (!isFloorPart(placement.object, def) && !isRun) {
    try {
      const { w, h } = rotatedFootprint(def, placement.rotation, placement);
      footprintBounds(placement.x, placement.y, w, h);
    } catch (err) {
      if (!(err instanceof GeometryRangeError)) throw err;
      throw new Error(`placement ${placement.id}: ${err.message}`);
    }
  }
  return placement;
}

/** Full structural/geometry validation for commits, without requiring installed parts. */
export function validateSceneGeometry(raw: unknown, registry: ContributionRegistry): IsoSceneFile {
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
  const layerProblems = layersProblems(file.layers);
  if (layerProblems.length) {
    throw new Error(layerProblems.join('; '));
  }
  if (
    file.gridCellSize !== undefined &&
    (typeof file.gridCellSize !== 'number' || !Number.isFinite(file.gridCellSize) || file.gridCellSize <= 0)
  ) {
    throw new Error(`scene.gridCellSize must be a finite number > 0, got ${String(file.gridCellSize)}`);
  }
  const objects: IsoPlacement[] = [];
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const obj of file.objects) {
    const placement = validatePlacementGeometry(obj, registry);
    if (ids.has(placement.id)) duplicates.push(placement.id);
    ids.add(placement.id);
    objects.push(placement);
  }
  if (duplicates.length) {
    throw new Error(`duplicate placement ids: ${duplicates.join(', ')}`);
  }
  return { ...file, objects };
}

/** Import validation: all geometry must be safe and every part must be installed. */
export function validateSceneFile(raw: unknown, registry: ContributionRegistry): IsoSceneFile {
  const file = validateSceneGeometry(raw, registry);
  for (const placement of file.objects) validatePlacementPart(placement, registry);
  return file;
}
