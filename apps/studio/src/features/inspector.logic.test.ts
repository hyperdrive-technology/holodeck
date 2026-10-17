import type { IsoPartParamSpec } from '@holodeck/editor-2.5d-react';
import { describe, expect, it } from 'vitest';
import { coerceCoordinate, coerceParam, paramValue, rotateQuarter, rotationDegrees, visibleParams } from './inspector.logic';

const num = (over: Partial<IsoPartParamSpec> = {}): IsoPartParamSpec => ({ type: 'number', label: 'Level', default: 0.5, ...over });

describe('inspector logic', () => {
  it.each([
    [undefined, 0],
    [0, 0],
    [Math.PI / 2, 90],
    [Math.PI, 180],
    [-Math.PI / 2, 270],
    [2 * Math.PI, 0],
    [5 * Math.PI, 180],
  ])('rotationDegrees(%s) = %s', (rad, deg) => {
    expect(rotationDegrees(rad)).toBe(deg);
  });

  it('rotateQuarter steps by 90 degrees and wraps', () => {
    expect(rotationDegrees(rotateQuarter(undefined, 1))).toBe(90);
    expect(rotationDegrees(rotateQuarter(0, -1))).toBe(270);
    expect(rotateQuarter((3 * Math.PI) / 2, 1)).toBe(0);
    // Accumulated drift from many turns snaps back to an exact quarter.
    expect(rotateQuarter(Math.PI / 2 + 1e-9, 1)).toBe(Math.PI);
  });

  it('paramValue prefers the placement value, else the default', () => {
    const p = { id: 'a', object: 'tank', x: 0, y: 0, params: { level: 0.9 } };
    expect(paramValue(p, 'level', num())).toBe(0.9);
    expect(paramValue(p, 'temp', num({ default: 20 }))).toBe(20);
    expect(paramValue({ ...p, params: { level: false } }, 'level', num())).toBe(false);
  });

  describe('coerceParam', () => {
    it('parses and clamps numbers', () => {
      expect(coerceParam(num(), '0.25')).toEqual({ ok: true, value: 0.25 });
      expect(coerceParam(num({ min: 0, max: 1 }), '7')).toEqual({ ok: true, value: 1 });
      expect(coerceParam(num({ min: 0, max: 1 }), '-3')).toEqual({ ok: true, value: 0 });
      expect(coerceParam(num(), '').ok).toBe(false);
      expect(coerceParam(num(), 'abc').ok).toBe(false);
      expect(coerceParam(num(), 'Infinity').ok).toBe(false);
      expect(coerceParam(num(), true).ok).toBe(false);
    });
    it('checks enums against options', () => {
      const spec: IsoPartParamSpec = { type: 'enum', label: 'Top', default: 'flat', options: ['flat', 'dome'] };
      expect(coerceParam(spec, 'dome')).toEqual({ ok: true, value: 'dome' });
      expect(coerceParam(spec, 'cone')).toMatchObject({ ok: false, reason: 'choose one of flat, dome' });
    });
    it('passes booleans and strings of the right type only', () => {
      expect(coerceParam({ type: 'boolean', label: 'On', default: false }, true)).toEqual({ ok: true, value: true });
      expect(coerceParam({ type: 'boolean', label: 'On', default: false }, 'true').ok).toBe(false);
      expect(coerceParam({ type: 'string', label: 'Text', default: '' }, 'hi')).toEqual({ ok: true, value: 'hi' });
      expect(coerceParam({ type: 'string', label: 'Text', default: '' }, false).ok).toBe(false);
    });
  });

  it('coerceCoordinate rounds to 2 decimals and rejects junk', () => {
    expect(coerceCoordinate('3')).toEqual({ ok: true, value: 3 });
    expect(coerceCoordinate('-1.239')).toEqual({ ok: true, value: -1.24 });
    expect(coerceCoordinate(' ').ok).toBe(false);
    expect(coerceCoordinate('1e400').ok).toBe(false);
  });

  it('visibleParams drops hidden specs and keeps order', () => {
    expect(visibleParams({ b: num(), a: num({ hidden: true }), c: num() }).map(([k]) => k)).toEqual(['b', 'c']);
  });
});
