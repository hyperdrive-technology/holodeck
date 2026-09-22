import {
  createMaterial,
  createTransform,
  type Keyframe,
} from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import {
  applyEasing,
  animationLocalTime,
  interpolateKeyframes,
} from './animation';

describe('createTransform / createMaterial (SDK)', () => {
  it('builds default transform and material helpers used by the viewer', () => {
    expect(createTransform({ x: 1 }, { y: Math.PI / 2 }, { z: 2 })).toEqual({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 2 },
    });
    expect(createMaterial({ opacity: 0.5 }).opacity).toBe(0.5);
  });
});

describe('interpolateKeyframes', () => {
  const keys: Keyframe[] = [
    { time: 0, value: 0, easing: 'linear' },
    { time: 1, value: 10, easing: 'linear' },
  ];

  it('lerps numeric values between keyframes', () => {
    expect(interpolateKeyframes(keys, 0)).toBe(0);
    expect(interpolateKeyframes(keys, 0.5)).toBe(5);
    expect(interpolateKeyframes(keys, 1)).toBe(10);
  });

  it('clamps outside the keyframe range', () => {
    expect(interpolateKeyframes(keys, -1)).toBe(0);
    expect(interpolateKeyframes(keys, 2)).toBe(10);
  });

  it('applies ease-in so mid-span is below linear', () => {
    const eased: Keyframe[] = [
      { time: 0, value: 0 },
      { time: 1, value: 10, easing: 'ease-in' },
    ];
    const mid = interpolateKeyframes(eased, 0.5) as number;
    expect(mid).toBeLessThan(5);
    expect(mid).toBeGreaterThan(0);
  });
});

describe('applyEasing / animationLocalTime', () => {
  it('returns identity for linear easing', () => {
    expect(applyEasing(0.3, 'linear')).toBeCloseTo(0.3);
  });

  it('loops or clamps animation local time', () => {
    expect(
      animationLocalTime({ name: 'spin', duration: 2, loop: true, tracks: [] }, 5)
    ).toBe(1);
    expect(
      animationLocalTime(
        { name: 'once', duration: 2, loop: false, tracks: [] },
        5
      )
    ).toBe(2);
  });
});
