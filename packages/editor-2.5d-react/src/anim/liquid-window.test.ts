import { Group, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { faceLiquidWindow } from './liquid-window';

const named = (name: string, parent: Object3D) => {
  const o = new Object3D();
  o.name = name;
  parent.add(o);
  return o;
};

describe('faceLiquidWindow', () => {
  it('counter-rotates the liquid pivot only', () => {
    const root = new Group();
    const liquid = named('anim.liquid', root);
    const agitator = named('anim.agitator', root);
    expect(faceLiquidWindow(root, Math.PI)).toBe(true);
    expect(liquid.rotation.y).toBeCloseTo(-Math.PI);
    expect(agitator.rotation.y).toBe(0);
  });

  it('leaves an unrotated part alone and ignores parts without a liquid pivot', () => {
    const root = new Group();
    const liquid = named('anim.liquid', root);
    expect(faceLiquidWindow(root, 0)).toBe(true);
    expect(liquid.rotation.y).toBeCloseTo(0);
    expect(faceLiquidWindow(new Group(), 1)).toBe(false);
  });
});
