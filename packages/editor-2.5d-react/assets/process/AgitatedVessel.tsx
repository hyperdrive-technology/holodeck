import { useCallback, useEffect, useState } from 'react';
import type { Object3D } from 'three';
import { modelUrl } from '../models';
import { findAnimNodes } from './apply-style';
import { HolodeckModel } from './HolodeckModel';
import { agitatedVesselScale, MIXER_GLB } from './agitated-vessel';

/**
 * The agitated vessel as the Blender mixer (mixer.glb): replaces the
 * procedural bottle + `TankAgitator` (2026-10-30). Drawn by `Tank` when
 * `params.agitator` is on, so the Mixer palette part, the mash tun preset and
 * core's brewery vessels all get it through the one Tank API.
 *
 * - Placed with its floor at `floorY` (Tank frame), scaled by
 *   `agitatedVesselScale(radius, height)`.
 * - `fill` (0..1) scales `anim.liquid` directly (the GLB liquid convention);
 *   `color` / `opacity` restyle its `hd.liquid` material.
 * - `anim.agitator` keeps its authored name, so a parent's `spin` binding
 *   (AnimatedPartRoot / useIsoAnimators) finds it once the GLB has loaded.
 * - Its own Suspense boundary + render-signal hold (`ownBoundary`), so a Tank
 *   needs no Suspense around it.
 */
export function AgitatedVessel({
  radius,
  height,
  floorY,
  fill,
  color,
  opacity,
  edgeColor,
  instanceKey,
}: {
  radius: number;
  height: number;
  floorY: number;
  fill: number;
  color: string;
  opacity?: number;
  edgeColor?: string;
  instanceKey?: string;
}) {
  const scale = agitatedVesselScale(radius, height);
  const [root, setRoot] = useState<Object3D | null>(null);
  const onReady = useCallback((o: Object3D) => setRoot(o), []);
  useEffect(() => {
    const liquid = root ? findAnimNodes(root)['anim.liquid'] : undefined;
    // Same floor as the fill animator: a zero Y scale makes a singular matrix.
    if (liquid) liquid.scale.y = Math.max(0.001, Math.min(1, fill));
  }, [root, fill]);
  return (
    <group position={[0, floorY, 0]} scale={[scale.xz, scale.y, scale.xz]}>
      <HolodeckModel
        url={modelUrl(MIXER_GLB.model)}
        ownBoundary
        instanceKey={instanceKey}
        liquid={color}
        liquidOpacity={opacity}
        edgeColor={edgeColor}
        onReady={onReady}
      />
    </group>
  );
}
