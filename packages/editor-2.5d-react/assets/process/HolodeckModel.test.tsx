import { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { Group } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetHoldKey, confirmAssetMounted, createRenderTracker, RenderTrackerContext, type RenderTracker } from '../../src/iso/render-signal';
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

function Reader({ owner }: { owner?: string }) {
  useTrackedGLTF('/slow.glb', owner === undefined ? {} : { owner });
  return null;
}

function renderReader(tracker: RenderTracker, owner?: string) {
  return renderToString(
    <RenderTrackerContext.Provider value={tracker}>
      <Suspense fallback={null}>
        <Reader owner={owner} />
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
    // Loaded but not committed yet: the hold survives until the model mounts.
    expect(tracker.pending).toBe(1);
    confirmAssetMounted(tracker, assetHoldKey(undefined, '/slow.glb'));
    expect(tracker.pending).toBe(0);
  });

  it('holds are per instance, not per URL: another instance of the same pending URL keeps its own (holodeck#199)', async () => {
    const tracker = createRenderTracker();
    const pending = new Promise<void>(() => {});
    load.mockImplementation(() => { throw pending; });
    renderReader(tracker, 'a');
    renderReader(tracker, 'b');
    renderReader(tracker, 'a'); // a render retry of the same instance is not a second hold
    expect(tracker.pending).toBe(2);
    confirmAssetMounted(tracker, assetHoldKey('a', '/slow.glb'));
    expect(tracker.pending).toBe(1);
    confirmAssetMounted(tracker, assetHoldKey('b', '/slow.glb'));
    expect(tracker.pending).toBe(0);
  });
});

describe('HolodeckModel host-controlled suspension (GPT review of #197)', () => {
  it('shows the host Suspense fallback while loading, with and without a tracker', async () => {
    const pending = Promise.resolve();
    load.mockImplementation(() => { throw pending; });
    const render = (tracker: RenderTracker | null) => renderToString(
      <RenderTrackerContext.Provider value={tracker}>
        <Suspense fallback={<i>host-loading</i>}>
          <HolodeckModel url="/slow.glb" />
        </Suspense>
      </RenderTrackerContext.Provider>,
    );
    expect(render(null)).toContain('host-loading');
    expect(render(createRenderTracker())).toContain('host-loading');
    await pending;
  });

  it('holds the request synchronously by default, in both boundary modes', async () => {
    for (const ownBoundary of [false, true]) {
      const tracker = createRenderTracker();
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => { finish = resolve; });
      load.mockImplementation(() => { throw pending; });
      renderToString(
        <RenderTrackerContext.Provider value={tracker}>
          <Suspense fallback={null}>
            <HolodeckModel url="/slow.glb" ownBoundary={ownBoundary} />
          </Suspense>
        </RenderTrackerContext.Provider>,
      );
      expect(tracker.pending).toBe(1);
      finish();
      await pending;
    }
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
