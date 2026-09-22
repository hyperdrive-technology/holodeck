/**
 * ISA-101 material helpers used by HolodeckViewer3D.
 */

import { createMaterial, createTransform } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import {
  colorForStatus,
  ISA101_CRITICAL,
  ISA101_GREY,
  ISA101_WARNING,
  resolveNodeColor,
  resolveOpacity,
} from './materials';

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
