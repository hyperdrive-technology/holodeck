import { describe, expect, it } from 'vitest';
import { INSTANCE_LIMIT, partitionScene, poolCount, slices } from './partition-scene';
import type { ScenePlacement } from './scene';

function fittings(n: number): ScenePlacement[] {
  const objects: ScenePlacement[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % 80;
    const y = Math.floor(i / 80) * 2;
    objects.push({
      id: `pipe-${i}`,
      object: 'pipe',
      x,
      y,
      toX: x,
      toY: y + 1,
    });
    objects.push({
      id: `elbow-${i}`,
      object: 'elbow',
      x,
      y: y + 1,
    });
  }
  objects.push({ id: 'tank-0', object: 'tank', x: 0, y: 0 });
  return objects;
}

describe('instance pools', () => {
  it('keeps tanks unique and batches pipes/elbows', () => {
    const { pipes, elbows, unique } = partitionScene(fittings(10));
    expect(pipes).toHaveLength(10);
    expect(elbows).toHaveLength(10);
    expect(unique.map((o) => o.object)).toEqual(['tank']);
  });

  it('drops empty pipe runs without toX/toY', () => {
    const { pipes, unique } = partitionScene([
      { id: 'broken', object: 'pipe', x: 0, y: 0 },
    ]);
    expect(pipes).toHaveLength(0);
    expect(unique).toHaveLength(1);
  });

  it('fits hundreds of fittings in one pool and thousands in several', () => {
    expect(poolCount(400)).toBe(1);
    expect(poolCount(INSTANCE_LIMIT)).toBe(1);
    expect(poolCount(INSTANCE_LIMIT + 1)).toBe(2);
    expect(poolCount(2500)).toBe(3);
    const many = fittings(400);
    expect(many.length).toBe(801);
    const { pipes, elbows } = partitionScene(many);
    expect(pipes).toHaveLength(400);
    expect(elbows).toHaveLength(400);
    expect(slices(pipes)).toHaveLength(1);
    expect(slices(pipes, 100)).toHaveLength(4);
  });
});
