import { Component, useContext, useLayoutEffect, type ReactNode } from 'react';
import { SRGBColorSpace, TextureLoader, type Texture } from 'three';
import { confirmAssetMounted, holdPendingAsset, RenderTrackerContext } from '../iso/render-signal';
import { assetUrlProblem } from './validate';

type TextureEntry =
  | { status: 'pending'; promise: Promise<void> }
  | { status: 'ready'; texture: Texture }
  | { status: 'error' };

/**
 * Shared per-URL texture cache for user-supplied images (logos, image
 * placements). Like R3F's `useLoader` cache, entries live for the page:
 * every placement of one logo shares one Texture, so never mutate it per
 * placement.
 *
 * Why not `useLoader(TextureLoader, url)`? On a failed load it throws into
 * React; an error boundary catches it, but R3F's reconciler still reports
 * every caught error through `window.reportError`, so one broken image URL in
 * a shared document showed up as a page error in every host. Here a failure
 * is a value (null), warned once.
 */
const textureCache = new Map<string, TextureEntry>();
const warnedUrls = new Set<string>();

function textureEntry(url: string): TextureEntry {
  let entry = textureCache.get(url);
  if (entry) return entry;
  const promise = new Promise<void>((resolve) => {
    new TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        textureCache.set(url, { status: 'ready', texture });
        resolve();
      },
      undefined,
      (error) => {
        textureCache.set(url, { status: 'error' });
        if (!warnedUrls.has(url)) {
          warnedUrls.add(url);
          console.warn(`holodeck: could not load image ${url.slice(0, 200)}: ${String((error as { message?: string })?.message ?? error)}`);
        }
        resolve();
      },
    );
  });
  entry = { status: 'pending', promise };
  textureCache.set(url, entry);
  return entry;
}

/** Test hook: forget cached textures and warnings. */
export function resetTextureCache(): void {
  textureCache.clear();
  warnedUrls.clear();
}

/**
 * The texture for `url`, suspending while it loads (and holding IsoCanvas's
 * rendered signal, same handshake as `useTrackedGLTF`, so a render test or a
 * PNG export never captures a logo-less frame). Returns null when the image
 * cannot be loaded.
 */
export function useTrackedTexture(url: string): Texture | null {
  const tracker = useContext(RenderTrackerContext);
  // Runs only once a render commits, i.e. after the load settled: releases the hold below.
  useLayoutEffect(() => {
    if (tracker) confirmAssetMounted(tracker, `texture:${url}`);
  }, [tracker, url]);
  // One choke point for every image URL, including ones that never went
  // through parseSceneFile (inspector edits, host metrics, pack definitions
  // built in code): a disallowed URL is never fetched (holodeck#96).
  const problem = assetUrlProblem(url);
  if (problem) {
    if (!warnedUrls.has(url)) {
      warnedUrls.add(url);
      console.warn(`holodeck: refusing image URL ${JSON.stringify(url.slice(0, 200))}: ${problem}`);
    }
    return null;
  }
  const entry = textureEntry(url);
  if (entry.status === 'pending') {
    if (tracker) holdPendingAsset(tracker, entry.promise, `texture:${url}`);
    throw entry.promise;
  }
  return entry.status === 'ready' ? entry.texture : null;
}

/**
 * Error boundary for user-supplied assets. GLB models still load through
 * `useLoader`, which throws on a 404; without this one bad model URL would
 * unmount the whole canvas. Renders nothing for the failed asset and warns
 * once per URL. `resetKey` (the URL) clears the error when it changes.
 */
export class AssetBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { failed: string | null }
> {
  state: { failed: string | null } = { failed: null };
  private static warned = new Set<string>();

  static getDerivedStateFromError(): { failed: string } {
    return { failed: '' };
  }

  componentDidCatch(error: unknown): void {
    this.setState({ failed: this.props.resetKey });
    if (!AssetBoundary.warned.has(this.props.resetKey)) {
      AssetBoundary.warned.add(this.props.resetKey);
      console.warn(`holodeck: could not load asset ${this.props.resetKey.slice(0, 200)}: ${String(error)}`);
    }
  }

  componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed !== null) this.setState({ failed: null });
  }

  render(): ReactNode {
    return this.state.failed !== null ? null : this.props.children;
  }
}
