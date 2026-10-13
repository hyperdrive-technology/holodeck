import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import type { Object3D } from 'three';
import { HolodeckModel as StaticHolodeckModel } from '../../assets/process/HolodeckModel';
import type { IsoPartDefinition } from '../registry/types';
import type { IsoPlacement } from '../iso/scene';
import { faceLiquidWindow } from './liquid-window';
import { useIsoAnimators } from './use-iso-animators';

/**
 * `HolodeckModel` (styled GLB clone) plus the animator path: pass the part
 * `def` (its `animNodes`), resolved `params` and the placement's `animation`
 * overrides and the model's `anim.*` nodes are driven every frame.
 * Without `def`/`params` it behaves exactly like the static component.
 */
export function HolodeckModel({
  def,
  params,
  animation,
  onReady,
  ...rest
}: ComponentProps<typeof StaticHolodeckModel> & {
  def?: Pick<IsoPartDefinition, 'animNodes'>;
  params?: Record<string, unknown>;
  animation?: IsoPlacement['animation'];
}) {
  const [root, setRoot] = useState<Object3D | null>(null);
  const ready = useCallback(
    (object: Object3D) => {
      setRoot(object);
      onReady?.(object);
    },
    [onReady],
  );
  useIsoAnimators(root, def ?? NO_ANIM, params ?? NO_PARAMS, animation);
  // Keep the vessel's liquid sight window facing the camera whatever the placement yaw.
  const yaw = rest.rotationY ?? 0;
  useEffect(() => {
    if (root) faceLiquidWindow(root, yaw);
  }, [root, yaw]);
  return <StaticHolodeckModel {...rest} onReady={ready} />;
}

const NO_ANIM = {};
const NO_PARAMS = {};
