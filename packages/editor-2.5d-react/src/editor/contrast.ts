/**
 * WCAG 2.x relative luminance and contrast ratio for `#rgb` / `#rrggbb` colours.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * Used by `editor-styles.test.ts` to keep every chrome text/background token pair at
 * WCAG AA (holodeck#72) and by the editor render test to check the live DOM.
 */

/** WCAG AA minimum for normal-size text (< 18pt, or < 14pt bold). */
export const WCAG_AA_NORMAL = 4.5;

/** Parse `#rgb` or `#rrggbb` (case-insensitive) into 0..255 channels. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    throw new Error(`not a #rgb/#rrggbb colour: ${hex}`);
  }
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (0 = black, 1 = white) of 0..255 sRGB channels. */
export function luminanceRgb([r, g, b]: readonly [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function luminance(hex: string): number {
  return luminanceRgb(parseHex(hex));
}

/** Contrast ratio (1..21) between two luminances; order does not matter. */
export function contrastRatioL(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export function contrastRatio(fg: string, bg: string): number {
  return contrastRatioL(luminance(fg), luminance(bg));
}
