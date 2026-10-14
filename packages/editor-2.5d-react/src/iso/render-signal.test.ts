import { describe, expect, it } from 'vitest';
import { createRenderTracker, nextRevision, RenderGate, renderState } from './render-signal';

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
