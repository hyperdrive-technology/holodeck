import { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { Group } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderTracker, RenderTrackerContext, type RenderTracker } from '../../src/iso/render-signal';
import { HolodeckModel, useTrackedGLTF } from './HolodeckModel';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@react-three/fiber', () => ({ useLoader: load }));
afterEach(() => { load.mockReset(); });

function renderModel(tracker: RenderTracker | null) {
  return renderToString(
    <RenderTrackerContext.Provider value={tracker}>
      <Suspense fallback={null}>
        <HolodeckModel url="/slow.glb" />
      </Suspense>
    </RenderTrackerContext.Provider>,
  );
}

function Reader({ holdRequest }: { holdRequest?: boolean }) {
  useTrackedGLTF('/slow.glb', holdRequest === undefined ? {} : { holdRequest });
  return null;
}

function renderReader(tracker: RenderTracker, holdRequest?: boolean) {
  return renderToString(
    <RenderTrackerContext.Provider value={tracker}>
      <Suspense fallback={null}>
        <Reader holdRequest={holdRequest} />
      </Suspense>
    </RenderTrackerContext.Provider>,
  );
}

// HolodeckModel's own hold (a committed wrapper, released on unmount) needs
// real effects, so it is covered in a browser: embed-render.test.ts
// (holodeck#58 removal during load, null-fallback wait).
describe('useTrackedGLTF request holds', () => {
  it('registers before suspension even when no component effects can mount', async () => {
    const tracker = createRenderTracker();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    load.mockImplementation(() => { throw pending; });
    // Server rendering commits no effects: the hold must be registered by the
    // load hook itself, before a null fallback can be returned.
    renderReader(tracker);
    expect(tracker.pending).toBe(1);
    renderReader(tracker);
    expect(tracker.pending).toBe(1);
    finish();
    await pending;
    expect(tracker.pending).toBe(0);
  });

  it('holdRequest: false leaves the hold to a committed component (holodeck#58)', async () => {
    const tracker = createRenderTracker();
    const pending = Promise.resolve();
    load.mockImplementation(() => { throw pending; });
    renderReader(tracker, false);
    expect(tracker.pending).toBe(0);
    await pending;
  });
});

describe('HolodeckModel loading holds', () => {
  it('keeps normal Suspense behavior outside IsoCanvas', async () => {
    const pending = Promise.resolve();
    load.mockImplementation(() => { throw pending; });
    expect(() => renderModel(null)).not.toThrow();
    await pending;
  });

  it('does not hold for a loaded cache hit', () => {
    const tracker = createRenderTracker();
    load.mockReturnValue({ scene: new Group() });
    renderModel(tracker);
    expect(tracker.pending).toBe(0);
  });

  it('does not turn a loader error into a pending hold', () => {
    const tracker = createRenderTracker();
    load.mockImplementation(() => { throw new Error('GLB failed'); });
    renderModel(tracker);
    expect(tracker.pending).toBe(0);
  });
});
