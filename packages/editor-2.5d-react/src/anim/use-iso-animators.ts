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
  const scan = useRef<AnimNodeScan>(emptyAnimNodeScan());
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
    const nodes = syncAnimNodes(scan.current, root, bindings);
    applyAnimations(bindings, nodes, live.current, dt, elapsed.current);
  });
}

/** Frames between re-scans of a root whose bound `anim.*` node has not appeared yet. */
export const RESCAN_FRAMES = 10;

/** Per-hook cache of the `anim.*` nodes found under a root. */
export interface AnimNodeScan {
  root: Object3D | null;
  nodes: Record<string, Object3D>;
  sinceScan: number;
}

export const emptyAnimNodeScan = (): AnimNodeScan => ({ root: null, nodes: {}, sinceScan: 0 });

/** Is `node` still in `root`'s subtree? (Walks up the parents: a GLB clone is a few levels deep.) */
export function isUnder(node: Object3D, root: Object3D): boolean {
  for (let o: Object3D | null = node; o; o = o.parent) if (o === root) return true;
  return false;
}

/**
 * The `anim.*` nodes to animate this frame (mutates `scan`). Scans when the
 * root changes, and right away when a cached node has left the root's
 * subtree: HolodeckModel swaps in a new styled clone (same node names) when
 * the liquid colour / opacity changes, e.g. an alarm flip, and the old nodes
 * would otherwise keep being animated off-screen (review of #228). Re-scans
 * every RESCAN_FRAMES frames while a bound node is missing (a GLB under the
 * root loads after the root mounts).
 */
export function syncAnimNodes(
  scan: AnimNodeScan,
  root: Object3D | null,
  bindings: readonly AnimationBinding[],
): Record<string, Object3D> {
  if (scan.root !== root) {
    scan.root = root;
    scan.nodes = root ? findAnimNodes(root) : {};
    scan.sinceScan = 0;
  } else if (root && Object.values(scan.nodes).some((n) => !isUnder(n, root))) {
    scan.nodes = findAnimNodes(root);
    scan.sinceScan = 0;
  } else if (root && bindings.some((b) => !scan.nodes[b.nodeName])) {
    // A traverse every RESCAN_FRAMES frames, only while something bound is still missing.
    scan.sinceScan += 1;
    if (scan.sinceScan >= RESCAN_FRAMES) {
      scan.nodes = findAnimNodes(root);
      scan.sinceScan = 0;
    }
  }
  return scan.nodes;
}
