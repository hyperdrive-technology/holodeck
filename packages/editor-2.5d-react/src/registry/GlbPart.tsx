import { Suspense } from 'react';
import { HolodeckModel } from '../anim/HolodeckModel';
import { gridToWorld } from '../iso/grid';
import { assetHoldKey, PendingAsset } from '../iso/render-signal';
import { mergeFittingParams } from '../../assets/process/fitting-params';
import { partOriginY } from './part-pose';
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
 * authored with their origin at the base, except `origin: 'pipe-axis'` inline parts, which sit at `pipeWorldY()`.
 */
export function GlbPart({ placement, params, style, def, tuning }: IsoPartProps) {
  if (!def.model) return null;
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const y = partOriginY(def, mergeFittingParams(tuning?.fittings).pipeRadius);
  return (
    // useLoader suspends; without a boundary one slow GLB would blank the whole scene.
    // The fallback holds the canvas's rendered signal until the model is in.
    <Suspense fallback={<PendingAsset requestKey={assetHoldKey(placement.id, def.model)} />}>
      <HolodeckModel
        url={def.model}
        instanceKey={placement.id}
        position={[wx, y, wz]}
        rotationY={placement.rotation ?? 0}
        scale={partScale(def)}
        // `alarmParam` beats the per-instance handwheel colour (partAccent's rule 1).
        accent={def.alarmParam && params[def.alarmParam] === true ? style.colors.alarm : placement.handwheel}
        style={style}
        def={def}
        params={params}
        animation={placement.animation}
      />
    </Suspense>
  );
}
