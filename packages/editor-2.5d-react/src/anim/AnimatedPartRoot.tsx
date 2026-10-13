import { useState, type ReactNode } from 'react';
import type { Group } from 'three';
import type { IsoPartDefinition } from '../registry/types';
import type { IsoPlacement } from '../iso/scene';
import { useIsoAnimators } from './use-iso-animators';

/**
 * Root group for a code-built part that wants the GLB animator path: any
 * descendant named `anim.<x>` (e.g. the base Tank's `anim.agitator`) is
 * driven by `def.animNodes` / `placement.animation` exactly like a GLB's
 * nodes. Packs without a `@react-three/fiber` dependency can use this
 * instead of spelling `<group>` themselves.
 */
export function AnimatedPartRoot({
  def,
  params,
  animation,
  children,
}: {
  def: Pick<IsoPartDefinition, 'animNodes'>;
  params: Record<string, unknown>;
  animation?: IsoPlacement['animation'];
  children: ReactNode;
}) {
  // State, not a ref: the hook must re-plan once the group exists.
  const [root, setRoot] = useState<Group | null>(null);
  useIsoAnimators(root, def, params, animation);
  return <group ref={setRoot}>{children}</group>;
}
