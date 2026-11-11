import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoAnimator } from '../registry/types';
import {
  BOB_ANIMATOR,
  BUILTIN_ISO_ANIMATORS,
  FILL_ANIMATOR,
  fractionOf,
  PULSE_ANIMATOR,
  SPIN_ANIMATOR,
  TRAVEL_ANIMATOR,
  TURN_ANIMATOR,
  VISIBLE_ANIMATOR,
} from './animators';
import { applyAnimations, planAnimations } from './use-iso-animators';

const ctx = (
  node: Object3D,
  value: unknown,
  extra: Partial<{ dt: number; elapsed: number; settings: Record<string, unknown>; params: Record<string, unknown> }> = {},
) => ({
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

describe('spin enableParam', () => {
  it('turns only while the named param is truthy', () => {
    const node = new Object3D();
    const settings = { axis: 'x', enableParam: 'running' };
    SPIN_ANIMATOR.apply(ctx(node, 60, { settings, params: { running: false, speed: 60 } }));
    expect(node.rotation.x).toBe(0);
    SPIN_ANIMATOR.apply(ctx(node, 60, { settings, params: { running: true, speed: 60 } }));
    expect(node.rotation.x).toBeCloseTo(Math.PI * 2);
  });

  it('treats a missing params bag or a missing gate param as off', () => {
    const node = new Object3D();
    SPIN_ANIMATOR.apply(ctx(node, 60, { settings: { enableParam: 'running' } }));
    SPIN_ANIMATOR.apply(ctx(node, 60, { settings: { enableParam: 'running' }, params: {} }));
    expect(node.rotation.y).toBe(0);
  });

  it('ignores an empty or non-string gate (always on)', () => {
    for (const enableParam of ['', 7, null]) {
      const node = new Object3D();
      SPIN_ANIMATOR.apply(ctx(node, 60, { settings: { enableParam }, params: {} }));
      expect(node.rotation.y).toBeCloseTo(Math.PI * 2);
    }
  });
});

describe('fractionOf', () => {
  it('maps booleans to 0/1 and numbers against the full scale, clamped', () => {
    expect(fractionOf(true, 1)).toBe(1);
    expect(fractionOf(false, 100)).toBe(0);
    expect(fractionOf(50, 100)).toBe(0.5);
    expect(fractionOf(250, 100)).toBe(1);
    expect(fractionOf(-4, 1)).toBe(0);
    expect(fractionOf(0.25, undefined)).toBe(0.25);
  });

  it('is 0 for garbage values and falls back to scale 1 for a bad scale', () => {
    for (const value of [undefined, null, 'open', Number.NaN, Number.POSITIVE_INFINITY, {}]) expect(fractionOf(value, 1)).toBe(0);
    expect(fractionOf(0.5, 0)).toBe(0.5);
    expect(fractionOf(0.5, -3)).toBe(0.5);
    expect(fractionOf(0.5, 'x')).toBe(0.5);
  });
});

describe('travel', () => {
  it('moves along +Y by distance * fraction from the authored position', () => {
    const node = new Object3D();
    node.position.set(0, 0.48, 0);
    TRAVEL_ANIMATOR.apply(ctx(node, 50, { settings: { axis: 'y', distance: 0.08, scale: 100 } }));
    expect(node.position.y).toBeCloseTo(0.52);
    expect(node.position.x).toBe(0);
    TRAVEL_ANIMATOR.apply(ctx(node, 100, { settings: { axis: 'y', distance: 0.08, scale: 100 } }));
    expect(node.position.y).toBeCloseTo(0.56); // absolute, not accumulating
  });

  it('restores the authored position for 0, false and garbage', () => {
    const node = new Object3D();
    node.position.set(1, 2, 3);
    for (const value of [0, false, 'x', undefined]) {
      TRAVEL_ANIMATOR.apply(ctx(node, 1, { settings: { distance: 0.5 } }));
      expect(node.position.y).toBeCloseTo(2.5);
      TRAVEL_ANIMATOR.apply(ctx(node, value, { settings: { distance: 0.5 } }));
      expect(node.position.toArray()).toEqual([1, 2, 3]);
    }
  });

  it('honours the axis and a negative distance, and falls back to y for a bad axis', () => {
    const node = new Object3D();
    TRAVEL_ANIMATOR.apply(ctx(node, true, { settings: { axis: 'z', distance: -0.2 } }));
    expect(node.position.toArray()).toEqual([0, 0, -0.2]);
    const other = new Object3D();
    TRAVEL_ANIMATOR.apply(ctx(other, true, { settings: { axis: 'w', distance: 0.3 } }));
    expect(other.position.y).toBeCloseTo(0.3);
  });

  it('uses its spec defaults when settings are empty', () => {
    const node = new Object3D();
    TRAVEL_ANIMATOR.apply(ctx(node, 1));
    expect(node.position.y).toBeCloseTo(0.1);
  });
});

describe('turn', () => {
  it('maps value 0..scale to fromDeg..toDeg about the axis, added to the authored rotation', () => {
    const node = new Object3D();
    node.rotation.x = 0.25;
    const settings = { axis: 'y', fromDeg: 90, toDeg: 0 };
    TURN_ANIMATOR.apply(ctx(node, false, { settings }));
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2);
    TURN_ANIMATOR.apply(ctx(node, true, { settings }));
    expect(node.rotation.y).toBeCloseTo(0);
    TURN_ANIMATOR.apply(ctx(node, 0.5, { settings }));
    expect(node.rotation.y).toBeCloseTo(Math.PI / 4);
    expect(node.rotation.x).toBe(0.25); // other axes keep their authored value
  });

  it('is absolute: repeated frames at one value do not accumulate', () => {
    const node = new Object3D();
    for (let i = 0; i < 5; i++) TURN_ANIMATOR.apply(ctx(node, 1, { settings: { axis: 'z', fromDeg: 0, toDeg: 30 } }));
    expect(node.rotation.z).toBeCloseTo(Math.PI / 6);
  });

  it('sweeps a gauge needle over a percent range and shows the value-0 pose for garbage', () => {
    const node = new Object3D();
    const settings = { axis: 'z', fromDeg: -135, toDeg: 135, scale: 100 };
    TURN_ANIMATOR.apply(ctx(node, 50, { settings }));
    expect(node.rotation.z).toBeCloseTo(0);
    TURN_ANIMATOR.apply(ctx(node, 'bad', { settings }));
    expect(node.rotation.z).toBeCloseTo((-135 * Math.PI) / 180);
  });

  it('uses its spec defaults when settings are empty (quarter turn about Y)', () => {
    const node = new Object3D();
    TURN_ANIMATOR.apply(ctx(node, 1));
    expect(node.rotation.y).toBeCloseTo(Math.PI / 2);
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
    expect(plan[1]?.settings).toEqual({ axis: 'y', rpmScale: 1, enableParam: '' });
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
    expect(plan.find((b) => b.param === 'agitatorRpm')?.settings).toEqual({ axis: 'x', rpmScale: 3, enableParam: '' });
    expect(plan.find((b) => b.param === 'steam')).toMatchObject({ nodeName: 'anim.steam' });
    const swapped = planAnimations(def, { level: { animator: 'visible' } }, lookup);
    expect(swapped.find((b) => b.param === 'level')?.animator.id).toBe('visible');
  });

  it("layers the part's animNodes settings between the animator defaults and the placement", () => {
    const motor = { animNodes: { speed: { node: 'anim.shaft', animator: 'spin', settings: { axis: 'x', enableParam: 'running' } } } };
    expect(planAnimations(motor, undefined, lookup)[0]?.settings).toEqual({ axis: 'x', rpmScale: 1, enableParam: 'running' });
    const tuned = planAnimations(motor, { speed: { animator: 'spin', settings: { rpmScale: 0.5 } } }, lookup);
    expect(tuned[0]?.settings).toEqual({ axis: 'x', rpmScale: 0.5, enableParam: 'running' });
    // A placement that swaps the animator does not inherit settings written for spin.
    const swapped = planAnimations(motor, { speed: { animator: 'turn' } }, lookup);
    expect(swapped[0]?.settings).toEqual({ axis: 'y', fromDeg: 0, toDeg: 90, scale: 1 });
  });

  it('hands every resolved param to the animator (spin gated by running)', () => {
    const motor = { animNodes: { speed: { node: 'anim.shaft', animator: 'spin', settings: { axis: 'x', enableParam: 'running' } } } };
    const shaft = new Object3D();
    const plan = planAnimations(motor, undefined, lookup);
    applyAnimations(plan, { 'anim.shaft': shaft }, { speed: 60, running: false }, 1, 1);
    expect(shaft.rotation.x).toBe(0);
    applyAnimations(plan, { 'anim.shaft': shaft }, { speed: 60, running: true }, 1, 2);
    expect(shaft.rotation.x).toBeCloseTo(Math.PI * 2);
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
