import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoAnimator } from '../registry/types';
import {
  BOB_ANIMATOR,
  BUILTIN_ISO_ANIMATORS,
  FILL_ANIMATOR,
  PULSE_ANIMATOR,
  SPIN_ANIMATOR,
  VISIBLE_ANIMATOR,
} from './animators';
import { applyAnimations, planAnimations } from './use-iso-animators';

const ctx = (node: Object3D, value: unknown, extra: Partial<{ dt: number; elapsed: number; settings: Record<string, unknown> }> = {}) => ({
  node,
  value,
  dt: 1,
  elapsed: 0,
  settings: {},
  ...extra,
});

describe('spin', () => {
  it('turns about Y at rpm * dt: 60 rpm for one second is one revolution', () => {
    const node = new Object3D();
    SPIN_ANIMATOR.apply(ctx(node, 60));
    expect(node.rotation.y).toBeCloseTo(Math.PI * 2);
    expect(node.rotation.x).toBe(0);
  });

  it('honours axis and rpmScale and accumulates across frames', () => {
    const node = new Object3D();
    for (let i = 0; i < 4; i++) SPIN_ANIMATOR.apply(ctx(node, 30, { dt: 0.25, settings: { axis: 'z', rpmScale: 2 } }));
    expect(node.rotation.z).toBeCloseTo(Math.PI * 2);
    expect(node.rotation.y).toBe(0);
  });

  it('falls back to Y for a bad axis and stops for non-numeric values', () => {
    const node = new Object3D();
    SPIN_ANIMATOR.apply(ctx(node, 60, { settings: { axis: 'w' } }));
    expect(node.rotation.y).toBeCloseTo(Math.PI * 2);
    const still = new Object3D();
    SPIN_ANIMATOR.apply(ctx(still, 'fast'));
    SPIN_ANIMATOR.apply(ctx(still, Number.NaN));
    SPIN_ANIMATOR.apply(ctx(still, 0));
    expect(still.rotation.y).toBe(0);
  });
});

describe('fill', () => {
  it('scales Y to the 0..1 value and leaves X and Z alone', () => {
    const node = new Object3D();
    FILL_ANIMATOR.apply(ctx(node, 0.5));
    expect(node.scale.toArray()).toEqual([1, 0.5, 1]);
  });

  it('clamps out-of-range values and floors at a non-singular scale', () => {
    const node = new Object3D();
    FILL_ANIMATOR.apply(ctx(node, 7));
    expect(node.scale.y).toBe(1);
    FILL_ANIMATOR.apply(ctx(node, -3));
    expect(node.scale.y).toBe(0.001);
    FILL_ANIMATOR.apply(ctx(node, 0));
    expect(node.scale.y).toBe(0.001);
    FILL_ANIMATOR.apply(ctx(node, 'x'));
    expect(node.scale.y).toBe(0.001);
  });

  it('hides the liquid node when empty and shows it again once filled (no floor disc)', () => {
    const node = new Object3D();
    FILL_ANIMATOR.apply(ctx(node, 0));
    expect(node.visible).toBe(false);
    FILL_ANIMATOR.apply(ctx(node, 0.01));
    expect(node.visible).toBe(true);
    FILL_ANIMATOR.apply(ctx(node, 0, { settings: { scale: 100 } }));
    expect(node.visible).toBe(false);
    FILL_ANIMATOR.apply(ctx(node, 40, { settings: { scale: 100 } }));
    expect(node.visible).toBe(true);
  });
});

describe('fill scale setting', () => {
  it('divides by settings.scale so a 0..100 percent fills 0..1', () => {
    const node = new Object3D();
    FILL_ANIMATOR.apply(ctx(node, 50, { settings: { scale: 100 } }));
    expect(node.scale.y).toBeCloseTo(0.5);
    FILL_ANIMATOR.apply(ctx(node, 250, { settings: { scale: 100 } }));
    expect(node.scale.y).toBe(1);
    FILL_ANIMATOR.apply(ctx(node, 0, { settings: { scale: 100 } }));
    expect(node.scale.y).toBe(0.001);
  });

  it('ignores a non-positive or non-numeric scale', () => {
    const node = new Object3D();
    FILL_ANIMATOR.apply(ctx(node, 0.5, { settings: { scale: 0 } }));
    expect(node.scale.y).toBe(0.5);
    FILL_ANIMATOR.apply(ctx(node, 0.25, { settings: { scale: 'x' } }));
    expect(node.scale.y).toBe(0.25);
  });
});

describe('bob', () => {
  it('offsets Y sinusoidally while truthy and returns to the authored Y when not', () => {
    const node = new Object3D();
    node.position.y = 2;
    BOB_ANIMATOR.apply(ctx(node, true, { elapsed: Math.PI / 6, settings: { amplitude: 0.1, speed: 3 } }));
    expect(node.position.y).toBeCloseTo(2.1);
    BOB_ANIMATOR.apply(ctx(node, false, { elapsed: 1 }));
    expect(node.position.y).toBe(2);
    BOB_ANIMATOR.apply(ctx(node, true, { elapsed: Math.PI / 6, settings: { amplitude: 0.1, speed: 3 } }));
    expect(node.position.y).toBeCloseTo(2.1); // base was remembered, not re-read from the offset position
  });
});

describe('visible', () => {
  it('maps truthiness to node.visible', () => {
    const node = new Object3D();
    VISIBLE_ANIMATOR.apply(ctx(node, 0));
    expect(node.visible).toBe(false);
    VISIBLE_ANIMATOR.apply(ctx(node, 'yes'));
    expect(node.visible).toBe(true);
  });
});

describe('pulse', () => {
  it('scales up at the wave peak and restores the authored scale when off', () => {
    const node = new Object3D();
    node.scale.set(2, 2, 2);
    PULSE_ANIMATOR.apply(ctx(node, true, { elapsed: Math.PI / 12, settings: { amount: 0.5, speed: 6 } }));
    expect(node.scale.x).toBeCloseTo(2 * 1.5); // sin(pi/2) = 1 -> peak
    PULSE_ANIMATOR.apply(ctx(node, false));
    expect(node.scale.toArray()).toEqual([2, 2, 2]);
  });

  it('drives emissiveIntensity on materials that have one', () => {
    const material = Object.assign(new MeshBasicMaterial(), { emissiveIntensity: 0 });
    const group = new Group();
    group.add(new Mesh(new BoxGeometry(), material));
    PULSE_ANIMATOR.apply(ctx(group, true, { elapsed: Math.PI / 12, settings: { speed: 6 } }));
    expect(material.emissiveIntensity).toBeCloseTo(1);
  });
});

describe('built-in animator set', () => {
  it('has unique ids, a default param each, and spec defaults for every setting', () => {
    const ids = BUILTIN_ISO_ANIMATORS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of BUILTIN_ISO_ANIMATORS) {
      expect(a.param.length).toBeGreaterThan(0);
      for (const spec of Object.values(a.settings ?? {})) expect(spec.default).not.toBeUndefined();
    }
  });
});

describe('planAnimations / applyAnimations', () => {
  const registry = createIsoRegistryWithBuiltins();
  const lookup = (id: string) => registry.get<IsoAnimator>(HOLODECK_KINDS.isoAnimator, id);
  const def = {
    animNodes: {
      level: { node: 'anim.liquid', animator: 'fill' },
      agitatorRpm: { node: 'anim.agitator', animator: 'spin' },
    },
  };

  it('binds each param to its node and animator, with animator setting defaults', () => {
    const plan = planAnimations(def, undefined, lookup);
    expect(plan.map((b) => [b.param, b.nodeName, b.animator.id])).toEqual([
      ['level', 'anim.liquid', 'fill'],
      ['agitatorRpm', 'anim.agitator', 'spin'],
    ]);
    expect(plan[1]?.settings).toEqual({ axis: 'y', rpmScale: 1 });
  });

  it('lets placement.animation override animator and settings, and falls back to anim.<param>', () => {
    const plan = planAnimations(
      def,
      {
        agitatorRpm: { animator: 'spin', settings: { axis: 'x', rpmScale: 3 } },
        steam: { animator: 'pulse' },
      },
      lookup,
    );
    expect(plan.find((b) => b.param === 'agitatorRpm')?.settings).toEqual({ axis: 'x', rpmScale: 3 });
    expect(plan.find((b) => b.param === 'steam')).toMatchObject({ nodeName: 'anim.steam' });
    const swapped = planAnimations(def, { level: { animator: 'visible' } }, lookup);
    expect(swapped.find((b) => b.param === 'level')?.animator.id).toBe('visible');
  });

  it('skips unknown animators instead of throwing', () => {
    const plan = planAnimations({ animNodes: { a: { node: 'anim.a', animator: 'gone' } } }, undefined, lookup);
    expect(plan).toEqual([]);
  });

  it('runs a frame on a dummy GLB-shaped tree and skips missing nodes / absent params', () => {
    const root = new Group();
    const liquid = new Object3D();
    liquid.name = 'anim.liquid';
    const agitator = new Object3D();
    agitator.name = 'anim.agitator';
    root.add(liquid, agitator);
    const nodes = { 'anim.liquid': liquid, 'anim.agitator': agitator };
    const plan = planAnimations(def, undefined, lookup);

    applyAnimations(plan, nodes, { level: 0.25, agitatorRpm: 30 }, 1, 1);
    expect(liquid.scale.y).toBeCloseTo(0.25);
    expect(agitator.rotation.y).toBeCloseTo(Math.PI);

    // param absent: node untouched. node missing: no throw.
    applyAnimations(plan, nodes, { level: 0.5 }, 1, 2);
    expect(liquid.scale.y).toBeCloseTo(0.5);
    expect(agitator.rotation.y).toBeCloseTo(Math.PI);
    expect(() => applyAnimations(plan, {}, { level: 1, agitatorRpm: 1 }, 1, 3)).not.toThrow();
  });
});
