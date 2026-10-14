import { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { Group } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmAssetMounted, createRenderTracker, RenderTrackerContext, type RenderTracker } from '../../src/iso/render-signal';
import { HolodeckModel } from './HolodeckModel';

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

describe('HolodeckModel loading holds', () => {
  it('registers before suspension even when no component effects can mount', async () => {
    const tracker = createRenderTracker();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    load.mockImplementation(() => { throw pending; });
    // Server rendering commits no effects: the hold must be registered by the
    // load hook itself, before a null fallback can be returned.
    renderModel(tracker);
    expect(tracker.pending).toBe(1);
    renderModel(tracker);
    expect(tracker.pending).toBe(1);
    finish();
    await pending;
    // Loaded but not committed yet: the hold survives until the model mounts.
    expect(tracker.pending).toBe(1);
    confirmAssetMounted(tracker, '/slow.glb');
    expect(tracker.pending).toBe(0);
  });

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
