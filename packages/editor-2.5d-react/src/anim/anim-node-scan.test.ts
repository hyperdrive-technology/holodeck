/**
 * Review of #228 (finding 3): HolodeckModel rebuilds its styled clone when
 * the liquid colour / opacity changes (an alarm flip), under the SAME
 * AnimatedPartRoot group. The animator hook only re-scanned while a bound
 * node name was missing, so spin / fill kept writing to the detached old
 * clone and the vessel froze.
 */
import { Group, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { FILL_ANIMATOR, SPIN_ANIMATOR } from './animators';
import { applyAnimations, emptyAnimNodeScan, isUnder, syncAnimNodes, type AnimationBinding } from './use-iso-animators';

const bindings: AnimationBinding[] = [
  { param: 'rpm', nodeName: 'anim.agitator', animator: SPIN_ANIMATOR, settings: {} },
  { param: 'level', nodeName: 'anim.liquid', animator: FILL_ANIMATOR, settings: {} },
];

/** A stand-in for one styled GLB clone with its two animated nodes. */
function clone(): { scene: Group; agitator: Object3D; liquid: Object3D } {
  const scene = new Group();
  const agitator = new Object3D();
  agitator.name = 'anim.agitator';
  const liquid = new Object3D();
  liquid.name = 'anim.liquid';
  scene.add(agitator, liquid);
  return { scene, agitator, liquid };
}

describe('syncAnimNodes', () => {
  it('follows a clone swap under a stable root (recolour / alarm) instead of animating the detached clone', () => {
    const root = new Group();
    const a = clone();
    root.add(a.scene);
    const scan = emptyAnimNodeScan();
    expect(syncAnimNodes(scan, root, bindings)['anim.agitator']).toBe(a.agitator);
    // HolodeckModel swaps its <primitive>: the old clone leaves, a new one with the same names arrives.
    const b = clone();
    root.remove(a.scene);
    root.add(b.scene);
    for (let frame = 0; frame < 3; frame++) {
      applyAnimations(bindings, syncAnimNodes(scan, root, bindings), { rpm: 60, level: 0.5 }, 0.1, frame * 0.1);
    }
    expect(b.agitator.rotation.y).toBeGreaterThan(0);
    expect(b.liquid.scale.y).toBeCloseTo(0.5);
    expect(a.agitator.rotation.y).toBe(0);
  });

  it('keeps the cached nodes (no traverse) while they are still under the root', () => {
    const root = new Group();
    const a = clone();
    root.add(a.scene);
    const scan = emptyAnimNodeScan();
    const first = syncAnimNodes(scan, root, bindings);
    expect(syncAnimNodes(scan, root, bindings)).toBe(first);
  });

  it('a new root rescans; a null root animates nothing', () => {
    const scan = emptyAnimNodeScan();
    const a = clone();
    expect(syncAnimNodes(scan, a.scene, bindings)['anim.liquid']).toBe(a.liquid);
    expect(syncAnimNodes(scan, null, bindings)).toEqual({});
  });
});

describe('isUnder', () => {
  it('is true for the root and its descendants, false once detached', () => {
    const root = new Group();
    const a = clone();
    root.add(a.scene);
    expect(isUnder(a.agitator, root)).toBe(true);
    expect(isUnder(root, root)).toBe(true);
    root.remove(a.scene);
    expect(isUnder(a.agitator, root)).toBe(false);
  });
});
