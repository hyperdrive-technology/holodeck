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
  // Re-scanned (below) while a bound node is missing: a GLB under `root` (e.g. the agitated
  // vessel's mixer.glb inside AnimatedPartRoot) loads after the root group mounts.
  const nodes = useRef<Record<string, Object3D>>({});
  const scanned = useRef<Object3D | null>(null);
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
  const sinceScan = useRef(0);
  useFrame((_, dt) => {
    elapsed.current += dt;
    if (scanned.current !== root) {
      scanned.current = root;
      nodes.current = root ? findAnimNodes(root) : {};
      sinceScan.current = 0;
    } else if (root && bindings.some((b) => !nodes.current[b.nodeName])) {
      // A traverse every RESCAN_FRAMES frames, only while something bound is still missing.
      sinceScan.current += 1;
      if (sinceScan.current >= RESCAN_FRAMES) {
        nodes.current = findAnimNodes(root);
        sinceScan.current = 0;
      }
    }
    applyAnimations(bindings, nodes.current, live.current, dt, elapsed.current);
  });
}

/** Frames between re-scans of a root whose bound `anim.*` node has not appeared yet. */
export const RESCAN_FRAMES = 10;
