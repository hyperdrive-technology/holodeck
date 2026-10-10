import { useLoader } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { ColorRepresentation, Object3D, Vector3Tuple } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyHolodeckStyle } from './apply-style';
import { useHolodeckStyle } from './style-context';
import type { HolodeckStyle } from './style';

/**
 * A Blender-built part (`assets/models/*.glb`) drawn in the Holodeck look.
 *
 * The GLB carries shape only; `applyHolodeckStyle` swaps its `hd.*`
 * materials for the iso finishes and adds the outlines. Each mount styles
 * its own clone so per-instance overrides (e.g. a handwheel colour) don't
 * leak between placements — `useLoader` caches one parsed scene per URL.
 */
export function HolodeckModel({
  url,
  position,
  rotationY = 0,
  scale = 1,
  accent,
  style: styleProp,
  onReady,
}: {
  url: string;
  position?: Vector3Tuple;
  rotationY?: number;
  /** Uniform scale about the model origin (the base, for Blender parts). */
  scale?: number;
  accent?: ColorRepresentation;
  style?: HolodeckStyle;
  /** Called once the styled clone is mounted (e.g. to fit a camera to its bounds). */
  onReady?: (root: Object3D) => void;
}) {
  const contextStyle = useHolodeckStyle();
  const style = styleProp ?? contextStyle;
  const gltf = useLoader(GLTFLoader, url);
  // Clone and style together: restyling the same clone after an accent
  // change would hit the idempotency flag before the old dispose ran.
  const { scene, dispose } = useMemo(() => {
    const clone = gltf.scene.clone(true);
    return { scene: clone, dispose: applyHolodeckStyle(clone, style, accent === undefined ? {} : { accent }) };
  }, [gltf, style, accent]);
  useEffect(() => dispose, [dispose]);
  useEffect(() => onReady?.(scene), [scene, onReady]);
  return <primitive object={scene} position={position} rotation={[0, rotationY, 0]} scale={scale} />;
}
