/**
 * Loaded image aspect ratios (width / height) by URL, shared between the
 * renderer and the bounds code (holodeck#108). An `image` placement with
 * `height: 0` draws at `width / aspect`, but `extent` (fit-to-view,
 * `sceneBounds`) runs without the texture; until the image has loaded it
 * assumes a square, then `ImageMarkLoaded` records the real aspect here.
 *
 * A tiny external store (get / subscribe) rather than React state: the
 * extent function is called outside React.
 *
 * Refits are per editor, not global (holodeck#127): an editor derives its
 * refit trigger from `imageAspectsKey(srcs)` over the image URLs that were in
 * its scene when it last fitted, so an image loading in another editor on the
 * page, or one the user just placed, never moves a view.
 *
 * Bounded so a scene cycling through thousands of generated data: URLs
 * cannot grow it without limit, but only entries no mounted image uses are
 * evicted (holodeck#132): `ImageMarkLoaded` holds a reference via
 * `retainImageAspect` for as long as it is mounted, so a still-visible
 * portrait never reverts to the square guess.
 */

export const MAX_IMAGE_ASPECT_ENTRIES = 512;
/** Insertion order doubles as eviction order (oldest first). */
const aspects = new Map<string, number>();
/** Mounted users per URL; entries with users are never evicted. */
const users = new Map<string, number>();
const listeners = new Set<() => void>();

export function imageAspect(src: string): number | undefined {
  return aspects.get(src);
}

/** Drop the oldest unused entries until there is room for one more. Retained entries may push it over the cap. */
function evictForInsert(): void {
  if (aspects.size < MAX_IMAGE_ASPECT_ENTRIES) return;
  for (const key of aspects.keys()) {
    if (aspects.size < MAX_IMAGE_ASPECT_ENTRIES) return;
    if (!users.has(key)) aspects.delete(key);
  }
}

/** Record a loaded image's aspect. No-op (no notification) when unchanged or invalid. */
export function setImageAspect(src: string, aspect: number): void {
  if (!src || !Number.isFinite(aspect) || aspect <= 0) return;
  if (aspects.get(src) === aspect) return;
  if (!aspects.has(src)) evictForInsert();
  aspects.set(src, aspect);
  for (const l of listeners) l();
}

/**
 * Mark `src` as in use by a mounted image so its aspect is never evicted.
 * Returns the release function (safe to call more than once); shaped to be
 * returned straight from a `useEffect`.
 */
export function retainImageAspect(src: string): () => void {
  if (!src) return () => undefined;
  users.set(src, (users.get(src) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (users.get(src) ?? 0) - 1;
    if (n > 0) users.set(src, n);
    else users.delete(src);
  };
}

/** Number of mounted users of `src` (tests / diagnostics). */
export function imageAspectUsers(src: string): number {
  return users.get(src) ?? 0;
}

/**
 * A value that changes exactly when the known aspect of one of `srcs`
 * changes: the per-editor refit trigger (holodeck#127). Stable string, so it
 * works as a `useSyncExternalStore` snapshot and an effect dependency.
 */
export function imageAspectsKey(srcs: readonly string[]): string {
  return srcs.map((s) => aspects.get(s) ?? '').join('|');
}

/** Image URLs a scene's bounds depend on: `image` placements with a `src` (sorted, unique). */
export function sceneImageSrcs(objects: readonly { object: string; params?: Record<string, unknown> }[]): string[] {
  const out = new Set<string>();
  for (const o of objects) {
    const src = o.object === 'image' ? o.params?.src : undefined;
    if (typeof src === 'string' && src) out.add(src);
  }
  return [...out].sort();
}

export function subscribeImageAspects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
