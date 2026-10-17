import { describe, expect, it } from 'vitest';
import { clampWidth, dragWidth, parseStoredWidth, type PanelBounds } from './panel-width.logic';

const B: PanelBounds = { defaultWidth: 300, minWidth: 200, maxWidth: 500 };

describe('panel width logic', () => {
  it.each([
    [300, 300],
    [100, 200],
    [900, 500],
    [250.6, 251],
    [Number.NaN, 300],
    [Infinity, 300],
  ])('clampWidth(%s) = %s', (value, expected) => {
    expect(clampWidth(value, B)).toBe(expected);
  });

  it('drags a right-edge handle with the pointer and a left-edge handle against it', () => {
    expect(dragWidth(300, 100, 150, 'right', B)).toBe(350);
    expect(dragWidth(300, 100, 150, 'left', B)).toBe(250);
    expect(dragWidth(300, 100, 1000, 'right', B)).toBe(500);
    expect(dragWidth(300, 100, 1000, 'left', B)).toBe(200);
  });

  it.each([
    [null, 300],
    ['', 300],
    ['abc', 300],
    ['420', 420],
    ['9999', 500],
  ])('parseStoredWidth(%j) = %s', (raw, expected) => {
    expect(parseStoredWidth(raw, B)).toBe(expected);
  });
});
