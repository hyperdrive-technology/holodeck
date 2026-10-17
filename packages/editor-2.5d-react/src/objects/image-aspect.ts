/**
 * Loaded image aspect ratios (width / height) by URL, shared between the
 * renderer and the bounds code (holodeck#108). An `image` placement with
 * `height: 0` draws at `width / aspect`, but `extent` (fit-to-view,
 * `sceneBounds`) runs without the texture; until the image has loaded it
 * assumes a square, then `ImageMarkLoaded` records the real aspect here and
 * bumps the version so `ProcessEditor` can refit.
 *
 * A tiny external store (get / subscribe / version) rather than React state:
 * the extent function is called outside React. Bounded so a scene cycling
 * through thousands of generated data: URLs cannot grow it without limit.
 */

const MAX_ENTRIES = 512;
const aspects = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

export function imageAspect(src: string): number | undefined {
  return aspects.get(src);
}

/** Record a loaded image's aspect. No-op (no version bump) when unchanged or invalid. */
export function setImageAspect(src: string, aspect: number): void {
  if (!src || !Number.isFinite(aspect) || aspect <= 0) return;
  if (aspects.get(src) === aspect) return;
  if (!aspects.has(src) && aspects.size >= MAX_ENTRIES) {
    const oldest = aspects.keys().next().value;
    if (oldest !== undefined) aspects.delete(oldest);
  }
  aspects.set(src, aspect);
  version += 1;
  for (const l of listeners) l();
}

/** Bumped by every recorded change; use as a dependency to refit. */
export function imageAspectVersion(): number {
  return version;
}

export function subscribeImageAspects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
