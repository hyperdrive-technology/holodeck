/**
 * Studio-side edits to an iso body (`IsoSceneFile`) for actions that start
 * outside the canvas: placing a part from the library sidebar, editing a
 * field in the studio inspector, deleting from the inspector. Pure: each
 * returns a new scene and never mutates its input.
 *
 * `stampPart` mirrors the editor's own palette stamp (editor-state.ts
 * `stamp`: part `defaults`, deep-copied, under the position; run-drawn parts
 * start two cells long). The editor does not export it.
 * TODO(holodeck#100): export a `stampPlacement` helper from
 * @holodeck/editor-2.5d-react so hosts cannot drift from the palette.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { sceneBounds, type IsoPartDefinition, type IsoPlacement, type IsoSceneFile } from '@holodeck/editor-2.5d-react';

/** `${prefix}-${n}` with the smallest n >= 1 not used by any placement. Prefix: the part id without namespace punctuation. */
export function nextPlacementId(partId: string, objects: readonly IsoPlacement[]): string {
  const prefix = partId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'object';
  const taken = new Set(objects.map((o) => o.id));
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

export function stampPart(registry: ContributionRegistry, partId: string, x: number, y: number, id: string): IsoPlacement {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId);
  const defaults = def?.defaults ? structuredClone(def.defaults) : {};
  const run = def?.draw === 'run' ? { toX: x + 2, toY: y } : {};
  return { ...defaults, ...run, id, object: partId, x, y };
}

/** Gap, in grid cells, between the scene's right edge and a part placed from the library. */
export const LIBRARY_PLACE_GAP = 3;

/**
 * Where a part placed from the library lands: the origin in an empty scene,
 * otherwise `LIBRARY_PLACE_GAP` cells right of the scene, level with its top
 * row, so it never lands on top of existing content.
 */
export function libraryDropPoint(scene: IsoSceneFile, registry: ContributionRegistry): { x: number; y: number } {
  if (scene.objects.length === 0) return { x: 0, y: 0 };
  const b = sceneBounds(scene.objects, registry);
  if (![b.minY, b.maxX].every(Number.isFinite)) return { x: 0, y: 0 };
  return { x: Math.round(b.maxX) + LIBRARY_PLACE_GAP, y: Math.round(b.minY) };
}

/** Throws for a part the registry does not have: a placement of it would make the document invalid. */
export function addPart(
  scene: IsoSceneFile,
  registry: ContributionRegistry,
  partId: string,
  at: { x: number; y: number } = libraryDropPoint(scene, registry),
): { scene: IsoSceneFile; id: string } {
  if (!registry.get(HOLODECK_KINDS.isoPart, partId)) throw new Error(`part "${partId}" is not installed`);
  const id = nextPlacementId(partId, scene.objects);
  const placement = stampPart(registry, partId, at.x, at.y, id);
  return { scene: { ...scene, objects: [...scene.objects, placement] }, id };
}

/** Merge `patch` onto placement `id`; `params` merge key by key. Unknown id: scene unchanged. */
export function updatePlacement(
  scene: IsoSceneFile,
  id: string,
  patch: Partial<Omit<IsoPlacement, 'id' | 'object'>>,
): IsoSceneFile {
  let found = false;
  const objects = scene.objects.map((o) => {
    if (o.id !== id) return o;
    found = true;
    const next: IsoPlacement = { ...o, ...patch };
    if (patch.params) next.params = { ...o.params, ...patch.params };
    return next;
  });
  return found ? { ...scene, objects } : scene;
}

export function removePlacement(scene: IsoSceneFile, id: string): IsoSceneFile {
  const objects = scene.objects.filter((o) => o.id !== id);
  return objects.length === scene.objects.length ? scene : { ...scene, objects };
}

/** `[kind, id]` of every part the scene places (for `requiresFor`). */
export function usedIsoContributions(scene: IsoSceneFile): Array<readonly [string, string]> {
  return [...new Set(scene.objects.map((o) => o.object))].map((id) => [HOLODECK_KINDS.isoPart, id] as const);
}
