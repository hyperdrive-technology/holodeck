import { describe, expect, it, vi } from 'vitest';
import { confirmAssetMounted, createRenderTracker, holdPendingAsset, MOUNT_HANDOFF_TIMEOUT_MS, holdUntilMounted, MOUNT_WARN_MS, nextRevision, RenderGate, renderState } from './render-signal';

describe('createRenderTracker', () => {
  it('counts overlapping holds and releases each once', () => {
    const t = createRenderTracker();
    expect(t.pending).toBe(0);
    const a = t.hold();
    const b = t.hold();
    expect(t.pending).toBe(2);
    a();
    a(); // double release is a no-op, not a negative count
    expect(t.pending).toBe(1);
    b();
    expect(t.pending).toBe(0);
  });
});

describe('holdPendingAsset', () => {
  it('deduplicates retries and shared loads within each canvas', async () => {
    const a = createRenderTracker();
    const b = createRenderTracker();
    let resolve!: () => void;
    const load = new Promise<void>((done) => { resolve = done; });
    holdPendingAsset(a, load);
    holdPendingAsset(a, load);
    holdPendingAsset(b, load);
    expect(a.pending).toBe(1);
    expect(b.pending).toBe(1);
    resolve();
    await load;
    expect(a.pending).toBe(0);
    expect(b.pending).toBe(0);
  });

  it('keeps overlapping loads held until all have settled', async () => {
    const tracker = createRenderTracker();
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<void>((done) => { finishFirst = done; });
    const second = new Promise<void>((done) => { finishSecond = done; });
    holdPendingAsset(tracker, first);
    holdPendingAsset(tracker, second);
    expect(tracker.pending).toBe(2);
    finishFirst();
    await first;
    expect(tracker.pending).toBe(1);
    finishSecond();
    await second;
    expect(tracker.pending).toBe(0);
  });

  it('releases rejected loads without requiring a suspended component to mount', async () => {
    const tracker = createRenderTracker();
    let fail!: (reason: Error) => void;
    const load = new Promise<void>((_, reject) => { fail = reject; });
    holdPendingAsset(tracker, load);
    expect(tracker.pending).toBe(1);
    fail(new Error('GLB failed'));
    await expect(load).rejects.toThrow('GLB failed');
    expect(tracker.pending).toBe(0);
  });
});

describe('holdPendingAsset mount handoff (keyed)', () => {
  it('keeps the hold after a successful load until the model mounts', async () => {
    const tracker = createRenderTracker();
    const load = Promise.resolve();
    holdPendingAsset(tracker, load, 'a.glb');
    await load;
    expect(tracker.pending).toBe(1);
    confirmAssetMounted(tracker, 'other.glb');
    expect(tracker.pending).toBe(1);
    confirmAssetMounted(tracker, 'a.glb');
    expect(tracker.pending).toBe(0);
    confirmAssetMounted(tracker, 'a.glb'); // idempotent
    expect(tracker.pending).toBe(0);
  });

  it('a committed owner can take the hold over while the request is still pending', () => {
    const tracker = createRenderTracker();
    holdPendingAsset(tracker, new Promise(() => {}), 'a.glb');
    expect(tracker.pending).toBe(1);
    const owner = tracker.hold(); // the owner's own hold first, then the takeover: never 0 in between
    confirmAssetMounted(tracker, 'a.glb');
    expect(tracker.pending).toBe(1);
    owner();
    expect(tracker.pending).toBe(0);
  });

  it('releases a failed load immediately', async () => {
    const tracker = createRenderTracker();
    const load = Promise.reject(new Error('GLB failed'));
    holdPendingAsset(tracker, load, 'a.glb');
    await load.catch(() => undefined);
    expect(tracker.pending).toBe(0);
  });

  it('warns and releases an unowned model that never mounts, only after the load settled', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tracker = createRenderTracker();
      let finish!: () => void;
      const load = new Promise<void>((done) => { finish = done; });
      holdPendingAsset(tracker, load, 'a.glb');
      vi.advanceTimersByTime(MOUNT_HANDOFF_TIMEOUT_MS * 5); // a slow request is never timed out
      expect(tracker.pending).toBe(1);
      finish();
      await load;
      vi.advanceTimersByTime(MOUNT_HANDOFF_TIMEOUT_MS);
      expect(tracker.pending).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('a.glb'));
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('holdUntilMounted (holodeck#58, #63)', () => {
  it('holds until released, once, and releasing twice is a no-op', () => {
    const tracker = createRenderTracker();
    const release = holdUntilMounted(tracker, 'a.glb', () => {});
    expect(tracker.pending).toBe(1);
    release();
    release();
    expect(tracker.pending).toBe(0);
  });

  it('never reports ready on its own: past the timeout it warns and keeps holding', () => {
    vi.useFakeTimers();
    try {
      const tracker = createRenderTracker();
      const warn = vi.fn();
      const release = holdUntilMounted(tracker, 'a.glb', warn);
      vi.advanceTimersByTime(MOUNT_WARN_MS - 1);
      expect(warn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain('a.glb');
      expect(tracker.pending).toBe(1);
      vi.advanceTimersByTime(MOUNT_WARN_MS * 10);
      expect(tracker.pending).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      release(); // removal / mount still releases a long-held model
      expect(tracker.pending).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('release cancels the pending warning', () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      holdUntilMounted(createRenderTracker(), 'a.glb', warn)();
      vi.advanceTimersByTime(MOUNT_WARN_MS * 2);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RenderGate', () => {
  it('reports nothing before a revision is committed', () => {
    const g = new RenderGate();
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBeNull();
  });

  it('reports a committed revision on the second idle frame, exactly once', () => {
    const g = new RenderGate();
    g.commit(1);
    expect(g.frame(0)).toBeNull(); // frame k: idle, draws the full scene
    expect(g.frame(0)).toBe(1); // frame k+1: proves frame k was submitted
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBeNull();
  });

  it('honours a custom settle count', () => {
    const g = new RenderGate(3);
    g.commit(7);
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBe(7);
  });

  it('rejects a non-positive settle count', () => {
    expect(() => new RenderGate(0)).toThrow(/settleFrames/);
    expect(() => new RenderGate(1.5)).toThrow(/settleFrames/);
  });

  it('waits while anything holds (GLB loading, camera animation, host fit)', () => {
    const g = new RenderGate();
    g.commit(1);
    expect(g.frame(1)).toBeNull();
    expect(g.frame(2)).toBeNull();
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBe(1);
  });

  it('restarts settling when a hold appears between idle frames', () => {
    const g = new RenderGate();
    g.commit(1);
    expect(g.frame(0)).toBeNull();
    expect(g.frame(1)).toBeNull(); // a GLB started loading after the first idle frame
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBe(1);
  });

  it('a new revision restarts settling, and an un-reported one is skipped', () => {
    const g = new RenderGate();
    g.commit(1);
    expect(g.frame(0)).toBeNull();
    g.commit(2); // revision 1 never settled: it is never reported
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBe(2);
  });

  it('re-committing the same revision and key does not restart settling', () => {
    const g = new RenderGate();
    g.commit(1, '760x540@1');
    expect(g.frame(0)).toBeNull();
    g.commit(1, '760x540@1');
    expect(g.frame(0)).toBe(1);
  });

  it('a new key (canvas resize) re-settles and re-reports the same revision', () => {
    const g = new RenderGate();
    g.commit(1, '760x540@1');
    g.frame(0);
    expect(g.frame(0)).toBe(1);
    g.commit(1, '800x600@1');
    expect(g.frame(0)).toBeNull();
    expect(g.frame(0)).toBe(1);
    expect(g.frame(0)).toBeNull();
  });
});

describe('nextRevision', () => {
  it('starts at 1 and only increases when a dep changes (Object.is)', () => {
    const scene = { id: 'a' };
    let r = nextRevision(null, [scene, 20]);
    expect(r.revision).toBe(1);
    r = nextRevision(r, [scene, 20]);
    expect(r.revision).toBe(1);
    r = nextRevision(r, [{ id: 'a' }, 20]); // new object, same content: still a change
    expect(r.revision).toBe(2);
    r = nextRevision(r, [r.deps[0], 21]);
    expect(r.revision).toBe(3);
    r = nextRevision(r, [r.deps[0], 21, 'extra']); // dep list length change
    expect(r.revision).toBe(4);
  });

  it('treats NaN as equal to itself (Object.is), so it cannot churn', () => {
    let r = nextRevision(null, [Number.NaN]);
    r = nextRevision(r, [Number.NaN]);
    expect(r.revision).toBe(1);
  });
});

describe('renderState', () => {
  it('is ready only when the rendered revision is the current one', () => {
    expect(renderState(3, null)).toBe('pending');
    expect(renderState(3, 2)).toBe('pending');
    expect(renderState(3, 3)).toBe('ready');
    expect(renderState(3, 3, false)).toBe('unsupported');
  });
});
