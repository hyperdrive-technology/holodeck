/**
 * Every text/background token pair in the editor chrome must meet WCAG AA (holodeck#72:
 * the toolbar "N items" label was #888 on #fafafa, 3.4:1, and failed axe in the Hyperdrive IDE).
 */
import { describe, expect, it } from 'vitest';
import { WCAG_AA_NORMAL, contrastRatio } from './contrast';
import * as t from './editor-styles';

const PAIRS: Array<[name: string, fg: string, bg: string]> = [
  // dark surface
  ['SIDEBAR_TEXT on SIDEBAR', t.SIDEBAR_TEXT, t.SIDEBAR],
  ['SIDEBAR_TEXT on FIELD_BG', t.SIDEBAR_TEXT, t.FIELD_BG],
  ['MUTED on SIDEBAR', t.MUTED, t.SIDEBAR],
  ['MUTED on FIELD_BG', t.MUTED, t.FIELD_BG],
  ['MUTED on RAIL_BG', t.MUTED, t.RAIL_BG],
  ['ACCENT on SIDEBAR', t.ACCENT, t.SIDEBAR],
  ['ACCENT on RAIL_BG', t.ACCENT, t.RAIL_BG],
  // light surface
  ['BAR_MUTED on BAR_BG ("N items", zoom)', t.BAR_MUTED, t.BAR_BG],
  ['BAR_BTN_TEXT on BAR_BTN_BG', t.BAR_BTN_TEXT, t.BAR_BTN_BG],
  ['CANVAS_TEXT on CANVAS_BG', t.CANVAS_TEXT, t.CANVAS_BG],
];

describe('editor chrome tokens', () => {
  it.each(PAIRS)('%s meets WCAG AA (4.5:1)', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
  });

  it('keeps the "N items" label at >= 5:1 for headroom against anti-aliasing', () => {
    expect(contrastRatio(t.BAR_MUTED, t.BAR_BG)).toBeGreaterThanOrEqual(5);
  });
});
