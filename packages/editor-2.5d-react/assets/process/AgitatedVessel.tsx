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
 * - `fill` (0..1) scales `anim.liquid` directly (the GLB liquid convention;
 *   0 hides it);
 *   `color` / `opacity` restyle its `hd.liquid` material.
 * - `anim.agitator` keeps its authored name, so a parent's `spin` binding
 *   (AnimatedPartRoot / useIsoAnimators) finds it once the GLB has loaded.
 * - Its own Suspense boundary + render-signal hold (`ownBoundary`), so a Tank
 *   needs no Suspense around it.
 */
/** Name of AgitatedVessel's root group (scene inspection, tests). */
export const AGITATED_VESSEL_NODE = 'agitated-vessel';

export function AgitatedVessel({
  radius,
  height,
  floorY,
  fill,
  agitator = true,
  color,
  opacity,
  edgeColor,
  instanceKey,
}: {
  radius: number;
  height: number;
  floorY: number;
  fill: number;
  /** Show the GLB's `anim.agitator` (shaft + impeller); false hides it (`TankParams.agitator` off). */
  agitator?: boolean;
  color: string;
  opacity?: number;
  edgeColor?: string;
  instanceKey?: string;
}) {
  const scale = agitatedVesselScale(radius, height);
  const [root, setRoot] = useState<Object3D | null>(null);
  const onReady = useCallback((o: Object3D) => setRoot(o), []);
  useEffect(() => {
    const spinner = root ? findAnimNodes(root)['anim.agitator'] : undefined;
    if (spinner) spinner.visible = agitator;
  }, [root, agitator]);
  useEffect(() => {
    const liquid = root ? findAnimNodes(root)['anim.liquid'] : undefined;
    if (!liquid) return;
    // Same floor as the fill animator: a zero Y scale makes a singular matrix. An empty vessel hides the
    // liquid instead (the 0.001 sliver read as a disc on the floor; round 5, 2026-10-30).
    liquid.scale.y = Math.max(0.001, Math.min(1, fill));
    liquid.visible = fill > 0;
  }, [root, fill]);
  return (
    <group name={AGITATED_VESSEL_NODE} position={[0, floorY, 0]} scale={[scale.xz, scale.y, scale.xz]}>
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
