import type { Object3D } from 'three';
import type { IsoAnimator, IsoPartDefinition } from '../registry/types';
import type { IsoPlacement } from '../iso/scene';

/*
 * Pure animation planning (no React, no R3F, no three at runtime), so the
 * dependency-light `./contracts` entry can export it: library packages run
 * their parts' real animators on their GLBs in tests without a renderer.
 * `useIsoAnimators` (use-iso-animators.ts) is the per-frame React driver.
 */

export interface AnimationBinding {
  param: string;
  nodeName: string;
  animator: IsoAnimator;
  settings: Record<string, unknown>;
}

/**
 * Decide which animator drives which `anim.*` node for a placement.
 *
 * Bindings come from `def.animNodes` (param -> node + animator + optional
 * part settings). `placement.animation[param]` overrides the animator id and
 * settings; when the part has no `animNodes` entry for that param the node
 * falls back to `anim.<param>` by convention. Unknown animator ids are
 * skipped (a pack may be uninstalled while a scene still names it).
 *
 * Settings layer, lowest first: the animator's spec defaults, the part's
 * `animNodes[param].settings` (only while the part's own animator is the one
 * in use: a placement that swaps the animator gets that animator's defaults,
 * not settings written for another one), then the placement's settings.
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
    const partSettings = base && base.animator === animator.id ? base.settings : undefined;
    out.push({
      param,
      nodeName: base?.node ?? `anim.${param}`,
      animator,
      settings: { ...defaults, ...partSettings, ...override?.settings },
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
    b.animator.apply({ node, value, dt, elapsed, settings: b.settings, params });
  }
}
