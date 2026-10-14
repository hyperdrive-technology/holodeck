import { Suspense } from 'react';
import { HolodeckModel } from '../anim/HolodeckModel';
import { gridToWorld } from '../iso/grid';
import { PendingAsset } from '../iso/render-signal';
import { partScale } from './part-scale';
import type { IsoPartProps } from './types';

/**
 * Generic `IsoPartDefinition.component` for GLB parts: a pack registers
 * `{ model: '/models/fermenter.glb', animNodes: {...}, component: GlbPart }`
 * and needs no React code of its own.
 *
 * `placement.rotation` is yaw in radians. `placement.handwheel` is passed as
 * the `hd.accent` colour (the one per-instance colour GLB parts support).
 * `def.scale` scales the model uniformly about its base. The model is placed at the cell centre on the floor (y = 0): GLBs are
 * authored with their origin at the base.
 */
export function GlbPart({ placement, params, style, def }: IsoPartProps) {
  if (!def.model) return null;
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  return (
    // useLoader suspends; without a boundary one slow GLB would blank the whole scene.
    // The fallback holds the canvas's rendered signal until the model is in.
    <Suspense fallback={<PendingAsset />}>
      <HolodeckModel
        url={def.model}
        position={[wx, 0, wz]}
        rotationY={placement.rotation ?? 0}
        scale={partScale(def)}
        accent={placement.handwheel}
        style={style}
        def={def}
        params={params}
        animation={placement.animation}
      />
    </Suspense>
  );
}
