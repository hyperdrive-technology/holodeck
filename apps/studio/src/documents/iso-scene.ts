/**
 * Small studio-side helpers over an iso body (`IsoSceneFile`). Edits
 * themselves (placing, inspector changes, deleting) go through the editor
 * (`ProcessEditorHandle.dispatch`), so they share its undo history and its
 * rules (palette stamp, inline-part attachment, connector anchors on delete).
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { sceneBounds, type IsoSceneFile } from '@holodeck/editor-2.5d-react';

/** Gap, in grid cells, between the scene's right edge and a part added from the library. */
export const LIBRARY_PLACE_GAP = 3;

/**
 * Where "Add to document" puts a part: the origin in an empty scene,
 * otherwise `LIBRARY_PLACE_GAP` cells right of the scene, level with its top
 * row, so it never lands on top of existing content.
 */
export function libraryDropPoint(scene: IsoSceneFile, registry: ContributionRegistry): { x: number; y: number } {
  if (scene.objects.length === 0) return { x: 0, y: 0 };
  const b = sceneBounds(scene.objects, registry);
  if (![b.minY, b.maxX].every(Number.isFinite)) return { x: 0, y: 0 };
  return { x: Math.round(b.maxX) + LIBRARY_PLACE_GAP, y: Math.round(b.minY) };
}

/** `[kind, id]` of every part the scene places (for `requiresFor`). */
export function usedIsoContributions(scene: IsoSceneFile): Array<readonly [string, string]> {
  return [...new Set(scene.objects.map((o) => o.object))].map((id) => [HOLODECK_KINDS.isoPart, id] as const);
}
