import { useLoader } from '@react-three/fiber';
import { useContext, useEffect, useLayoutEffect, useMemo } from 'react';
import type { ColorRepresentation, Object3D, Vector3Tuple } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyHolodeckStyle, type ApplyStyleOverrides } from './apply-style';
import { useHolodeckStyle } from './style-context';
import type { HolodeckStyle } from './style';
import { confirmAssetMounted, holdPendingAsset, RenderTrackerContext } from '../../src/iso/render-signal';

/**
 * `useLoader(GLTFLoader, url)` that holds IsoCanvas's rendered signal while
 * the request is pending. Exported for parts that read the parsed scene
 * themselves (DataPart's logo anchor); the loader cache is shared, so a
 * second call for the same URL is a cache hit.
 */
export function useTrackedGLTF(url: string) {
  const tracker = useContext(RenderTrackerContext);
  try {
    return useLoader(GLTFLoader, url);
  } catch (pending) {
    // useLoader throws its cached promise before React commits any effects.
    // Register synchronously so a null Suspense fallback cannot report ready
    // while the request is parked. Loaded cache hits need no hold.
    if (tracker && pending && typeof (pending as PromiseLike<unknown>).then === 'function') {
      holdPendingAsset(tracker, pending as PromiseLike<unknown>, url);
    }
    throw pending;
  }
}

/**
 * A Blender-built part (`assets/models/*.glb`) drawn in the Holodeck look.
 *
 * The GLB carries shape only; `applyHolodeckStyle` swaps its `hd.*`
 * materials for the iso finishes and adds the outlines. Each mount styles
 * its own clone so per-instance overrides (e.g. a handwheel colour) don't
 * leak between placements — `useLoader` caches one parsed scene per URL.
 * Inside IsoCanvas, pending loads automatically hold its rendered signal,
 * including with a host-provided `Suspense fallback={null}`. Outside IsoCanvas
 * loading works normally; hosts must still supply a Suspense boundary.
 */
export function HolodeckModel({
  url,
  position,
  rotationY = 0,
  scale = 1,
  accent,
  body,
  edgeColor,
  style: styleProp,
  onReady,
}: {
  url: string;
  position?: Vector3Tuple;
  rotationY?: number;
  /** Uniform scale about the model origin (the base, for Blender parts). */
  scale?: number;
  accent?: ColorRepresentation;
  /** `hd.white` body colour for this instance (data-only part colours). */
  body?: ColorRepresentation;
  /** Outline colour for this instance; default `style.colors.edge`. */
  edgeColor?: ColorRepresentation;
  style?: HolodeckStyle;
  /** Called once the styled clone is mounted (e.g. to fit a camera to its bounds). */
  onReady?: (root: Object3D) => void;
}) {
  const contextStyle = useHolodeckStyle();
  const style = styleProp ?? contextStyle;
  const gltf = useTrackedGLTF(url);
  const tracker = useContext(RenderTrackerContext);
  // The suspended load's hold ends only once this model is committed.
  useLayoutEffect(() => { if (tracker) confirmAssetMounted(tracker, url); }, [tracker, url]);
  // Clone and style together: restyling the same clone after an accent
  // change would hit the idempotency flag before the old dispose ran.
  const { scene, dispose } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const overrides: ApplyStyleOverrides = {};
    if (accent !== undefined) overrides.accent = accent;
    if (body !== undefined) overrides.body = body;
    if (edgeColor !== undefined) overrides.edgeColor = edgeColor;
    return { scene: clone, dispose: applyHolodeckStyle(clone, style, overrides) };
  }, [gltf, style, accent, body, edgeColor]);
  useEffect(() => dispose, [dispose]);
  useEffect(() => onReady?.(scene), [scene, onReady]);
  return <primitive object={scene} position={position} rotation={[0, rotationY, 0]} scale={scale} />;
}
