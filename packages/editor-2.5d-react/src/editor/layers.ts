/**
 * Editor layers and groups (lane E3, holodeck#37). Pure helpers over the
 * scene: which layer a placement is on, whether it is visible / editable,
 * and group membership. The reducer (editor-state.ts) owns the actions.
 *
 * Model (`IsoLayer` in objects/validate.ts):
 * - `scene.layers` is optional. A placement with no `layer`, or naming a
 *   layer that is not declared, is on the default layer.
 * - The default layer (`DEFAULT_LAYER_ID`) always exists; declaring an entry
 *   with that id only renames / hides / locks it.
 * - Hidden layers are not drawn (editor and run mode). Hidden or locked
 *   placements cannot be selected, moved or edited, but they stay obstacles
 *   for pipe routing: the geometry is still there.
 */
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import type { IsoLayer } from '../objects/validate';

export const DEFAULT_LAYER_ID = 'default';
export const DEFAULT_LAYER_NAME = 'Default';

/** Layers in panel order: the default layer first, then declared layers. */
export function sceneLayers(scene: Pick<IsoSceneFile, 'layers'>): IsoLayer[] {
  const declared = scene.layers ?? [];
  const base = declared.find((l) => l.id === DEFAULT_LAYER_ID) ?? { id: DEFAULT_LAYER_ID, name: DEFAULT_LAYER_NAME };
  return [base, ...declared.filter((l) => l.id !== DEFAULT_LAYER_ID)];
}

/** Effective layer id of a placement (undeclared ids fall back to the default layer). */
export function layerIdOf(scene: Pick<IsoSceneFile, 'layers'>, placement: Pick<IsoPlacement, 'layer'>): string {
  const id = placement.layer;
  if (!id || id === DEFAULT_LAYER_ID) return DEFAULT_LAYER_ID;
  return scene.layers?.some((l) => l.id === id) ? id : DEFAULT_LAYER_ID;
}

function layerFlags(scene: Pick<IsoSceneFile, 'layers'>, layerId: string): { hidden: boolean; locked: boolean } {
  const layer = scene.layers?.find((l) => l.id === layerId);
  return { hidden: layer?.hidden === true, locked: layer?.locked === true };
}

export function isPlacementHidden(scene: Pick<IsoSceneFile, 'layers'>, placement: Pick<IsoPlacement, 'layer'>): boolean {
  return layerFlags(scene, layerIdOf(scene, placement)).hidden;
}

/** Selectable and editable: on a layer that is neither hidden nor locked. */
export function isPlacementEditable(scene: Pick<IsoSceneFile, 'layers'>, placement: Pick<IsoPlacement, 'layer'>): boolean {
  const flags = layerFlags(scene, layerIdOf(scene, placement));
  return !flags.hidden && !flags.locked;
}

/**
 * Placements to draw: hidden layers filtered out. Returns `scene.objects`
 * itself when nothing is hidden, so memoised consumers see a stable array.
 */
export function visibleObjects(scene: Pick<IsoSceneFile, 'layers' | 'objects'>): IsoPlacement[] {
  if (!scene.layers?.some((l) => l.hidden)) return scene.objects;
  return scene.objects.filter((o) => !isPlacementHidden(scene, o));
}

/** The layer field for a placement put on `layerId` (absent for the default layer). */
export function withLayer(placement: IsoPlacement, layerId: string): IsoPlacement {
  if (layerId === DEFAULT_LAYER_ID) {
    if (placement.layer === undefined) return placement;
    const { layer: _layer, ...rest } = placement;
    return rest;
  }
  return { ...placement, layer: layerId };
}

/**
 * Ids of `ids` plus every editable placement sharing a group with one of
 * them, in scene order. Selecting one member of a group selects the group.
 */
export function expandGroups(scene: Pick<IsoSceneFile, 'objects' | 'layers'>, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set<string>();
  for (const o of scene.objects) if (wanted.has(o.id) && o.group) groups.add(o.group);
  if (groups.size === 0) return [...ids];
  const out = new Set(ids);
  for (const o of scene.objects) {
    if (o.group && groups.has(o.group) && isPlacementEditable(scene, o)) out.add(o.id);
  }
  return scene.objects.filter((o) => out.has(o.id)).map((o) => o.id);
}

/** Next free `layer-N` / `group-N` style id among `taken`. */
export function nextFreeId(prefix: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  let n = 1;
  while (set.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}
