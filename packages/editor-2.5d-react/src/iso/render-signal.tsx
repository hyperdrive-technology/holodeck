/**
 * Deterministic "rendered" signal for the iso canvas (holodeck#34).
 *
 * Tests, screenshot loops (core's `pnpm ui:loop`, this package's visual test)
 * and hosts need to know when the pixels on screen reflect the current scene,
 * without sleeping. The signal is a monotonically increasing **revision**:
 *
 *   - the host (or IsoCanvas itself) bumps the revision whenever anything that
 *     changes the picture changes (scene, metrics, zoom, look-at, pose, size);
 *   - inside the R3F tree, `RenderSignal` commits that revision and, once no
 *     render hold is active (GLBs still loading, a camera animation running,
 *     the host's fit not applied yet), waits `settleFrames` animation frames
 *     and reports it: `onRendered(revision)`.
 *
 * "Settle frames" because R3F's `useFrame` runs *before* the frame renders:
 * frame k observes "nothing pending" and then draws the complete scene; frame
 * k+1 observing the same state proves frame k was submitted. Two frames is the
 * minimum that guarantees a presented frame contains the revision.
 *
 * Holds are counted, not flagged, so any number of loaders can overlap.
 * HolodeckModel wraps its suspending body in its own boundary and holds from
 * its own (committed) mount until the body mounts, so even a host's
 * `Suspense fallback={null}` waits for GLBs, and removing the model while it
 * loads releases the hold. A fallback that mounts `<PendingAsset />` holds until
 * its boundary commits.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

/** Counts active render holds. One per IsoCanvas; shared with the R3F tree by context. */
export interface RenderTracker {
  /** Active holds. The signal reports only while this is 0. */
  readonly pending: number;
  /** Adds a hold; call the returned function (once) to release it. */
  hold(): () => void;
}

export function createRenderTracker(): RenderTracker {
  let pending = 0;
  return {
    get pending() {
      return pending;
    },
    hold() {
      pending += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pending -= 1;
      };
    },
  };
}

/** Null outside an IsoCanvas: holds are then no-ops (parts can render in any canvas). */
export const RenderTrackerContext = createContext<RenderTracker | null>(null);

// Suspended mounts have no effects/ref state to clean up. Own these holds by
// the cached loader promise instead, and deduplicate React retries and models
// sharing that promise separately for each canvas.
const pendingAssets = new WeakMap<RenderTracker, WeakSet<PromiseLike<unknown>>>();

/**
 * Holds `tracker` until `promise` settles (success or failure). This covers
 * the REQUEST only. It does not know whether anything will mount afterwards,
 * so callers that can be removed or retried must pair it with a committed
 * component hold: a `PendingAsset` fallback, or `useMountHold` (HolodeckModel).
 */
export function holdPendingAsset(tracker: RenderTracker, promise: PromiseLike<unknown>): void {
  let assets = pendingAssets.get(tracker);
  if (!assets) {
    assets = new WeakSet();
    pendingAssets.set(tracker, assets);
  }
  if (assets.has(promise)) return;
  assets.add(promise);
  const release = tracker.hold();
  Promise.resolve(promise).then(release, release);
}

/**
 * How long a mounted-but-not-yet-loaded model may hold before we warn. It is a
 * diagnostic only: the hold is NOT released (holodeck#63) because reporting
 * ready without the model would be a lie. A model that is removed or fails
 * releases through its own unmount instead (holodeck#58).
 */
export const MOUNT_WARN_MS = 15_000;

/**
 * Holds `tracker` until the returned function is called, warning once if that
 * takes longer than `MOUNT_WARN_MS`. Idempotent. Plain function (no React) so
 * the timing is unit-tested; `useMountHold` ties it to a component lifecycle.
 */
export function holdUntilMounted(tracker: RenderTracker, label: string, warn: (message: string) => void = console.warn): () => void {
  const release = tracker.hold();
  const timer = setTimeout(
    () => warn(`holodeck: ${label} is still not mounted after ${MOUNT_WARN_MS / 1000}s; the canvas stays not-ready until it loads or is removed`),
    MOUNT_WARN_MS,
  );
  return () => {
    clearTimeout(timer);
    release();
  };
}

/**
 * Holds the rendered signal from the commit of the calling component until
 * `mountedKey === key` (its content committed) or the component unmounts.
 * The caller must itself sit OUTSIDE the Suspense boundary it waits on: a
 * component whose child suspends commits its own effects at once, while a
 * suspending component never does. That is what lets removal during a load
 * (or a failed load, which unmounts through the error boundary) release.
 */
export function useMountHold(key: string, mountedKey: string | null): void {
  const tracker = useContext(RenderTrackerContext);
  useLayoutEffect(
    () => (tracker && mountedKey !== key ? holdUntilMounted(tracker, key) : undefined),
    [tracker, key, mountedKey],
  );
}

/** Holds the rendered signal while `active` (inside an IsoCanvas). */
export function useRenderHold(active = true): void {
  const tracker = useContext(RenderTrackerContext);
  useLayoutEffect(() => (active && tracker ? tracker.hold() : undefined), [active, tracker]);
}

/** Suspense fallback that holds the rendered signal until its boundary resolves. */
export function PendingAsset() {
  useRenderHold(true);
  return null;
}

/**
 * Frame-level state machine behind `RenderSignal`. Pure (no React, no three),
 * so the timing rules are unit-tested in render-signal.test.ts.
 */
export class RenderGate {
  private committed: number | null = null;
  private committedKey = '';
  private stable = 0;
  private reported: { revision: number; key: string } | null = null;

  constructor(private readonly settleFrames = 2) {
    if (!Number.isInteger(settleFrames) || settleFrames < 1) {
      throw new Error(`settleFrames must be a positive integer, got ${settleFrames}`);
    }
  }

  /**
   * The canvas tree now shows `revision`. `key` carries extra inputs that change
   * the picture without a new revision (the drawing-buffer size): a new key
   * restarts settling and allows the same revision to be reported again.
   */
  commit(revision: number, key = ''): void {
    if (revision === this.committed && key === this.committedKey) return;
    this.committed = revision;
    this.committedKey = key;
    this.stable = 0;
  }

  /** Call once per frame, before it renders. Returns the revision to report, or null. */
  frame(pending: number): number | null {
    if (this.committed === null) return null;
    if (pending > 0) {
      this.stable = 0;
      return null;
    }
    this.stable += 1;
    if (this.stable < this.settleFrames) return null;
    if (this.reported && this.reported.revision === this.committed && this.reported.key === this.committedKey) {
      return null;
    }
    this.reported = { revision: this.committed, key: this.committedKey };
    return this.committed;
  }
}

/**
 * Returns a number that increases by one whenever any of `deps` changes
 * (`Object.is`, like effect deps). Computed during render so the new revision
 * is visible in the same commit as the change that caused it: a test that
 * reads `data-render-state` right after an action never sees a stale "ready".
 */
export function useRevision(deps: readonly unknown[]): number {
  const state = useRef<{ revision: number; deps: readonly unknown[] } | null>(null);
  state.current = nextRevision(state.current, deps);
  return state.current.revision;
}

/** Pure step behind `useRevision`. */
export function nextRevision(
  prev: { revision: number; deps: readonly unknown[] } | null,
  deps: readonly unknown[],
): { revision: number; deps: readonly unknown[] } {
  if (!prev) return { revision: 1, deps };
  const same = prev.deps.length === deps.length && prev.deps.every((d, i) => Object.is(d, deps[i]));
  return same ? prev : { revision: prev.revision + 1, deps };
}

/** What a canvas root shows in `data-render-state`. */
export type RenderState = 'pending' | 'ready' | 'unsupported';

export function renderState(revision: number, rendered: number | null, supported = true): RenderState {
  if (!supported) return 'unsupported';
  return rendered === revision ? 'ready' : 'pending';
}

/**
 * Mount inside the R3F Canvas (IsoCanvas does). Reports `revision` through
 * `onRendered` once a settled frame shows it.
 */
export function RenderSignal({
  revision,
  hold = false,
  settleFrames = 2,
  onRendered,
  dimensions,
  onDimensions,
}: {
  revision: number;
  /** Host-side hold (e.g. the fit-to-scene has not been applied yet). */
  hold?: boolean;
  settleFrames?: number;
  onRendered: (revision: number) => void;
  /** Host readiness must use the same dimensions as the R3F drawing tree. */
  dimensions?: string;
  onDimensions?: (dimensions: string) => void;
}) {
  const tracker = useContext(RenderTrackerContext);
  const [gate] = useState(() => new RenderGate(settleFrames));
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const sizeKey = `${size.width}x${size.height}@${dpr}`;
  // R3F has its own root. Keep the gate held until its measured size has been
  // incorporated into the host's identity, so resize cannot report an old one.
  useRenderHold(hold || (dimensions !== undefined && dimensions !== sizeKey));
  useLayoutEffect(() => {
    onDimensions?.(sizeKey);
  }, [onDimensions, sizeKey]);
  // Layout effect: runs in the same commit that put `revision` into this tree,
  // so the gate never pairs a revision with an older tree.
  useLayoutEffect(() => {
    gate.commit(revision, sizeKey);
  }, [gate, revision, sizeKey]);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  useFrame(() => {
    const done = gate.frame(tracker?.pending ?? 0);
    if (done !== null) onRenderedRef.current(done);
  });
  return null;
}
