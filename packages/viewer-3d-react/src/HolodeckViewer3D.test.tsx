/**
 * Unit tests for HolodeckViewer3D helpers (ISA-101 materials + animation).
 */

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
} from './utils/animation';
import {
  colorForStatus,
  ISA101_CRITICAL,
  ISA101_GREY,
  ISA101_WARNING,
  resolveNodeColor,
  resolveOpacity,
} from './utils/materials';

describe('colorForStatus (ISA-101)', () => {
  it('maps healthy and unknown to grey-normal (never green)', () => {
    expect(colorForStatus('healthy')).toEqual(ISA101_GREY);
    expect(colorForStatus('unknown')).toEqual(ISA101_GREY);
    expect(colorForStatus(undefined)).toEqual(ISA101_GREY);
    expect(colorForStatus('healthy').g).toBeLessThan(0.7);
  });

  it('maps warning to amber and critical to red', () => {
    expect(colorForStatus('warning')).toEqual(ISA101_WARNING);
    expect(colorForStatus('critical')).toEqual(ISA101_CRITICAL);
  });
});

describe('resolveNodeColor', () => {
  it('ignores saturated material.color when status is healthy', () => {
    const node = {
      id: 'n1',
      type: 'equipment',
      name: 'Pump',
      status: 'healthy' as const,
      transform: createTransform(),
      material: createMaterial({ color: { r: 0, g: 1, b: 0, a: 1 } }),
    };
    expect(resolveNodeColor(node)).toMatchObject({
      r: ISA101_GREY.r,
      g: ISA101_GREY.g,
      b: ISA101_GREY.b,
    });
  });

  it('uses critical red regardless of material hue', () => {
    const node = {
      id: 'n2',
      type: 'equipment',
      name: 'Valve',
      status: 'critical' as const,
      transform: createTransform(),
      material: createMaterial({ color: { r: 0, g: 1, b: 0, a: 1 } }),
    };
    expect(resolveNodeColor(node)).toMatchObject({
      r: ISA101_CRITICAL.r,
      g: ISA101_CRITICAL.g,
      b: ISA101_CRITICAL.b,
    });
  });
});

describe('resolveOpacity', () => {
  it('honours material opacity and implies transparency when < 1', () => {
    expect(resolveOpacity(createMaterial({ opacity: 0.4 }))).toEqual({
      opacity: 0.4,
      transparent: true,
    });
    expect(resolveOpacity(createMaterial())).toEqual({
      opacity: 1,
      transparent: false,
    });
  });
});

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
