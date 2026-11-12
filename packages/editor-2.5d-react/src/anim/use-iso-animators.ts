import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Object3D } from 'three';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { findAnimNodes } from '../../assets/process';
import { useIsoRegistry } from '../registry/react';
import type { IsoAnimator, IsoPartDefinition } from '../registry/types';
import type { IsoPlacement } from '../iso/scene';
import { applyAnimations, planAnimations } from './plan';

export { applyAnimations, planAnimations, type AnimationBinding } from './plan';

/**
 * Drive a part's `anim.*` nodes from its resolved params, once per R3F frame.
 * `root` is the styled GLB clone (null until loaded). Call inside a Canvas.
 */
export function useIsoAnimators(
  root: Object3D | null,
  def: Pick<IsoPartDefinition, 'animNodes'>,
  params: Record<string, unknown>,
  animation?: IsoPlacement['animation'],
): void {
  const registry = useIsoRegistry();
  const nodes = useMemo(() => (root ? findAnimNodes(root) : {}), [root]);
  const bindings = useMemo(
    () => planAnimations(def, animation, (id) => registry.get<IsoAnimator>(HOLODECK_KINDS.isoAnimator, id)),
    [def, animation, registry],
  );
  // Read params through a ref so a 400 ms metrics tick does not rebuild bindings.
  const live = useRef(params);
  live.current = params;
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [root]);
  useFrame((_, dt) => {
    elapsed.current += dt;
    applyAnimations(bindings, nodes, live.current, dt, elapsed.current);
  });
}
