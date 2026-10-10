import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Object3D } from 'three';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { findAnimNodes } from '../../assets/process';
import { useIsoRegistry } from '../registry/react';
import type { IsoAnimator, IsoPartDefinition } from '../registry/types';
import type { IsoPlacement } from '../iso/scene';

export interface AnimationBinding {
  param: string;
  nodeName: string;
  animator: IsoAnimator;
  settings: Record<string, unknown>;
}

/**
 * Decide which animator drives which `anim.*` node for a placement.
 *
 * Bindings come from `def.animNodes` (param -> node + animator).
 * `placement.animation[param]` overrides the animator id and settings; when
 * the part has no `animNodes` entry for that param the node falls back to
 * `anim.<param>` by convention. Unknown animator ids are skipped (a pack may
 * be uninstalled while a scene still names it).
 */
export function planAnimations(
  def: Pick<IsoPartDefinition, 'animNodes'>,
  animation: IsoPlacement['animation'],
  getAnimator: (id: string) => IsoAnimator | undefined,
): AnimationBinding[] {
  const params = new Set([...Object.keys(def.animNodes ?? {}), ...Object.keys(animation ?? {})]);
  const out: AnimationBinding[] = [];
  for (const param of params) {
    const base = def.animNodes?.[param];
    const override = animation?.[param];
    const animator = getAnimator(override?.animator ?? base?.animator ?? '');
    if (!animator) continue;
    const defaults: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(animator.settings ?? {})) defaults[key] = spec.default;
    out.push({
      param,
      nodeName: base?.node ?? `anim.${param}`,
      animator,
      settings: { ...defaults, ...override?.settings },
    });
  }
  return out;
}

/** One frame: call each binding whose param has a value and whose node exists. */
export function applyAnimations(
  bindings: readonly AnimationBinding[],
  nodes: Record<string, Object3D>,
  params: Record<string, unknown>,
  dt: number,
  elapsed: number,
): void {
  for (const b of bindings) {
    const node = nodes[b.nodeName];
    const value = params[b.param];
    if (!node || value === undefined) continue;
    b.animator.apply({ node, value, dt, elapsed, settings: b.settings });
  }
}

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
