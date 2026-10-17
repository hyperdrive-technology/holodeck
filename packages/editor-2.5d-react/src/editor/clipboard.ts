/**
 * Copy / paste / duplicate / delete for a set of placements (lane E3,
 * holodeck#37 and the connector delete rule from holodeck#91). Pure.
 *
 * COPY (`copyObjects`): deep copies of the selection, in scene order. A
 * connector end anchored to a placement that is NOT copied is converted to a
 * free point where it was drawn, so a pasted copy keeps its shape instead of
 * tying itself to the original's neighbours (or to ids that do not exist in
 * another document).
 *
 * PASTE (`pasteObjects`): fresh ids (`<part>-N`, like the palette), fresh
 * group ids, internal references remapped (connector anchors, `onPipe`),
 * layers kept only when the target scene declares them, then the whole set is
 * offset by (k, k) for the smallest k >= 0 where no pasted placement lands on
 * an identical part at the same cell, so repeated pastes cascade.
 *
 * DELETE (`removeObjects`): parts hosted on a removed pipe lose their
 * attachment, and connector ends anchored to a removed placement are detached
 * to a free point where the anchor was (Arcentry keeps the dangling line;
 * holodeck#91 asked for "delete-cascade or detach", detach loses nothing).
 */
import type { ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { resolveLinkEnd } from '../objects/connector';
import type { IsoLink, IsoLinkEnd } from '../objects/validate';
import { detachFrom, withAttachment } from '../routing/inline';
import { isInlinePart } from '../routing/run';
import { moveBy } from './arrange';
import { DEFAULT_LAYER_ID, nextFreeId } from './layers';

/** Largest cascade offset tried before pasting on top anyway. */
const MAX_PASTE_OFFSET = 64;

function linkFallback(placement: IsoPlacement, end: 'from' | 'to') {
  return end === 'from'
    ? { x: placement.x, y: placement.y }
    : { x: placement.toX ?? placement.x + 3, y: placement.toY ?? placement.y };
}

/**
 * `link` with every end anchored to an id in `gone` replaced by a free point
 * at the anchor's resolved position (`byId` must still contain the gone
 * placements). Unresolvable ends are dropped (the end then falls back to the
 * placement's own x/y or toX/toY). Returns the same object when untouched.
 */
function detachLink(
  placement: IsoPlacement,
  gone: (id: string) => boolean,
  byId: ReadonlyMap<string, IsoPlacement>,
  registry: ContributionRegistry,
): IsoPlacement {
  const link = placement.link;
  if (!link) return placement;
  let next: IsoLink | null = null;
  for (const end of ['from', 'to'] as const) {
    const anchor = link[end];
    if (!anchor || !('object' in anchor) || !gone(anchor.object)) continue;
    next ??= { ...link };
    const resolved = resolveLinkEnd(anchor, linkFallback(placement, end), byId, registry);
    if (resolved) next[end] = { x: resolved.point.x, y: resolved.point.y };
    else delete next[end];
  }
  return next ? { ...placement, link: next } : placement;
}

/** Deep copies of `ids` (scene order), anchors outside the set detached. */
export function copyObjects(
  scene: Pick<IsoSceneFile, 'objects'>,
  ids: ReadonlySet<string>,
  registry: ContributionRegistry,
): IsoPlacement[] {
  const byId = new Map(scene.objects.map((o) => [o.id, o]));
  return scene.objects
    .filter((o) => ids.has(o.id))
    .map((o) => structuredClone(detachLink(o, (id) => !ids.has(id), byId, registry)));
}

/** Remove `ids` from the scene: hosted parts detach, anchored connector ends become free points. */
export function removeObjects(
  objects: readonly IsoPlacement[],
  ids: ReadonlySet<string>,
  registry: ContributionRegistry,
): IsoPlacement[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  let rest: IsoPlacement[] = objects.filter((o) => !ids.has(o.id));
  for (const id of ids) rest = detachFrom(rest, id);
  return rest.map((o) => detachLink(o, (id) => ids.has(id), byId, registry));
}

export interface PasteResult {
  objects: IsoPlacement[];
  /** Ids of the pasted placements, in clipboard order. */
  ids: string[];
}

/**
 * Append `clip` to `scene.objects` with fresh ids. `layer`: put every pasted
 * placement on this layer (the editor's active layer) instead of keeping the
 * copied one; omit to keep layers the scene declares.
 */
export function pasteObjects(
  scene: Pick<IsoSceneFile, 'objects' | 'layers'>,
  clip: readonly IsoPlacement[],
  registry: ContributionRegistry,
  opts: { layer?: string } = {},
): PasteResult {
  if (clip.length === 0) return { objects: scene.objects, ids: [] };
  const taken = new Set(scene.objects.map((o) => o.id));
  const idMap = new Map<string, string>();
  for (const o of clip) {
    // nextId over `taken` (mutated as we go) so two pasted tanks get tank-3, tank-4.
    let n = 1;
    while (taken.has(`${o.object}-${n}`)) n += 1;
    const id = `${o.object}-${n}`;
    taken.add(id);
    idMap.set(o.id, id);
  }
  const groupsTaken = new Set(scene.objects.flatMap((o) => (o.group ? [o.group] : [])));
  const groupMap = new Map<string, string>();
  for (const o of clip) {
    if (!o.group || groupMap.has(o.group)) continue;
    const g = nextFreeId('group', groupsTaken);
    groupsTaken.add(g);
    groupMap.set(o.group, g);
  }
  const declared = new Set((scene.layers ?? []).map((l) => l.id));
  const remapEnd = (end: IsoLinkEnd | undefined): IsoLinkEnd | undefined =>
    end && 'object' in end && idMap.has(end.object) ? { ...end, object: idMap.get(end.object)! } : end;

  const offset = cascadeOffset(scene.objects, clip);
  const fresh = clip.map((src) => {
    const o: IsoPlacement = moveBy(structuredClone(src), offset, offset);
    o.id = idMap.get(src.id)!;
    if (src.group) o.group = groupMap.get(src.group)!;
    const layer = opts.layer ?? src.layer;
    if (layer && layer !== DEFAULT_LAYER_ID && declared.has(layer)) o.layer = layer;
    else delete o.layer;
    if (o.link) {
      o.link = { ...o.link };
      if (o.link.from) o.link.from = remapEnd(o.link.from);
      if (o.link.to) o.link.to = remapEnd(o.link.to);
    }
    if (src.onPipe !== undefined) {
      if (idMap.has(src.onPipe)) o.onPipe = idMap.get(src.onPipe)!;
      else {
        delete o.onPipe;
        delete o.at;
      }
    }
    return o;
  });
  // Inline parts pasted without their pipe may land on another pipe: attach like a palette drop.
  const objects = [...scene.objects, ...fresh];
  const settled = fresh.map((o) =>
    o.onPipe === undefined && isInlinePart(o, registry) ? withAttachment(o, objects) : o,
  );
  return { objects: [...scene.objects, ...settled], ids: settled.map((o) => o.id) };
}

function cascadeOffset(existing: readonly IsoPlacement[], clip: readonly IsoPlacement[]): number {
  const occupied = new Set(existing.map((o) => `${o.object}@${o.x},${o.y}`));
  // k = 0 first: a cut-and-paste (original gone) lands back in place.
  for (let k = 0; k <= MAX_PASTE_OFFSET; k += 1) {
    if (!clip.some((o) => occupied.has(`${o.object}@${o.x + k},${o.y + k}`))) return k;
  }
  return 1;
}

/** Marker of the editor's system-clipboard text, so pasting unrelated text never creates parts. */
export const CLIPBOARD_FORMAT = 'holodeck.iso.clipboard.v1';
/** Most placements accepted from one system-clipboard paste. */
export const MAX_CLIPBOARD_OBJECTS = 5000;

/** System-clipboard text for copied placements (JSON with a format marker). */
export function serializeClipboard(objects: readonly IsoPlacement[]): string {
  return JSON.stringify({ format: CLIPBOARD_FORMAT, objects });
}

/**
 * Placements from system-clipboard text, or null when the text is not ours.
 * Only the envelope is checked here (records with string id / object); the
 * reducer validates geometry, params and installed parts on paste like any edit.
 */
export function parseClipboard(text: string): IsoPlacement[] | null {
  if (!text || text.length > 50_000_000 || !text.includes(CLIPBOARD_FORMAT)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const { format, objects } = raw as { format?: unknown; objects?: unknown };
  if (format !== CLIPBOARD_FORMAT || !Array.isArray(objects) || objects.length === 0 || objects.length > MAX_CLIPBOARD_OBJECTS) return null;
  const ok = objects.every(
    (o) => !!o && typeof o === 'object' && !Array.isArray(o) && typeof (o as IsoPlacement).id === 'string' && typeof (o as IsoPlacement).object === 'string',
  );
  return ok ? (objects as IsoPlacement[]) : null;
}
