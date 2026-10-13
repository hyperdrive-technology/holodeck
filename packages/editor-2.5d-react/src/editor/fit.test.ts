import { describe, expect, it } from 'vitest';
import { initialIsoPose } from '../iso/pose';
import type { IsoPlacement } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { fitView, sceneWorldBox } from './fit';

const home = initialIsoPose(18);
const at = (id: string, object: string, x: number, y: number, extra: Partial<IsoPlacement> = {}): IsoPlacement => ({
  id, object, x, y, ...extra,
});
const part = (footprint: { w: number; h: number }, extra: Partial<IsoPartDefinition> = {}) =>
  ({ id: 'p', label: 'p', footprint, params: {}, component: () => null, ...extra }) as IsoPartDefinition;

describe('sceneWorldBox', () => {
  it('is a unit box for an empty scene', () => {
    expect(sceneWorldBox({ objects: [] })).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it('covers footprints, pipe ends and area pads', () => {
    const parts: Record<string, IsoPartDefinition> = { tank: part({ w: 2, h: 2 }) };
    const box = sceneWorldBox(
      { objects: [at('t', 'tank', 2, 2), at('p', 'pipe', 4, 2, { toX: 8, toY: 2 }), at('a', 'area', 5, 2, { width: 12, height: 4 })] },
      (id) => parts[id],
    );
    // area spans grid x -1..11 -> world +0.5; tank/pipe lie inside it.
    expect(box.min[0]).toBeCloseTo(-0.5);
    expect(box.max[0]).toBeCloseTo(11.5);
    expect(box.min[2]).toBeCloseTo(0.5);
    expect(box.max[2]).toBeCloseTo(4.5);
  });

  it('swaps the footprint for a quarter-turn rotation', () => {
    const box = sceneWorldBox({ objects: [at('t', 'tank', 0, 0, { rotation: Math.PI / 2 })] }, () => part({ w: 4, h: 2 }));
    expect(box.max[0] - box.min[0]).toBeCloseTo(2);
    expect(box.max[2] - box.min[2]).toBeCloseTo(4);
  });

  it('uses the explicit height, and scale for GLB parts', () => {
    expect(sceneWorldBox({ objects: [at('t', 'tank', 0, 0, { height: 5 })] }).max[1]).toBe(5);
    const glb = part({ w: 1, h: 1 }, { model: 'x.glb', scale: 1.5, defaults: { height: 2 } });
    expect(sceneWorldBox({ objects: [at('g', 'glb', 0, 0)] }, () => glb).max[1]).toBeCloseTo(3);
  });
});

describe('fitView', () => {
  const box = { min: [0, 0, 0] as [number, number, number], max: [10, 3, 4] as [number, number, number] };

  it('targets the box centre', () => {
    expect(fitView(box, home, 1000, 800).target).toEqual([5, 1.5, 2]);
  });

  it('zooms in for a smaller box and out for a bigger one', () => {
    const small = fitView({ min: [0, 0, 0], max: [4, 2, 4] }, home, 1000, 800).zoom;
    const big = fitView({ min: [0, 0, 0], max: [20, 2, 20] }, home, 1000, 800).zoom;
    expect(small).toBeGreaterThan(big);
  });

  it('scales zoom with the viewport and keeps the margin', () => {
    const box = { min: [0, 0, 0] as [number, number, number], max: [40, 3, 20] as [number, number, number] };
    const a = fitView(box, home, 1000, 1000, { margin: 0 }).zoom;
    const b = fitView(box, home, 2000, 2000, { margin: 0 }).zoom;
    expect(b / a).toBeCloseTo(2, 5);
    expect(fitView(box, home, 1000, 1000, { margin: 0.1 }).zoom).toBeCloseTo(a * 0.8, 5);
  });

  it('puts the projected extents inside the viewport', () => {
    // A flat 10x10 floor square under the iso camera projects to width 10*sqrt(2), height 10*sqrt(2)*sin(35.26 deg).
    const sq = fitView({ min: [0, 0, 0], max: [10, 0, 10] }, home, 1000, 1000, { margin: 0 });
    expect(sq.zoom).toBeCloseTo(1000 / (10 * Math.SQRT2), 4);
  });

  it('clamps to the wheel range and survives degenerate input', () => {
    expect(fitView({ min: [0, 0, 0], max: [0.1, 0, 0.1] }, home, 1000, 800).zoom).toBe(80);
    expect(fitView({ min: [0, 0, 0], max: [1000, 0, 1000] }, home, 1000, 800).zoom).toBe(8);
    expect(fitView({ min: [1, 1, 1], max: [1, 1, 1] }, home, 1000, 800).zoom).toBe(20);
  });

  it('works top-down', () => {
    const top = { ...home, radius: 0 };
    expect(Number.isFinite(fitView(box, top, 1000, 800).zoom)).toBe(true);
  });
});
