import type { CSSProperties } from 'react';

/**
 * Chrome tokens shared by the editor panels. Inline styles on purpose: the package ships no CSS.
 *
 * The editor has two chrome surfaces:
 * - dark: the rail, palette and inspector (`SIDEBAR` / `FIELD_BG` backgrounds);
 * - light: the bottom toolbar (`BAR_BG`) and its buttons (`BAR_BTN_BG`).
 *
 * Every text/background pair is asserted to meet WCAG AA (4.5:1) in `editor-styles.test.ts`;
 * add new pairs there when you add a token. Never inline a grey hex in a component — the
 * `#888` "N items" label (holodeck#72, 3.4:1 on `#fafafa`) is what that rule prevents.
 */
// --- dark surface (rail, palette, inspector) ---
export const SIDEBAR = '#252b36';
export const SIDEBAR_TEXT = '#e8eaed';
/** Secondary text on the dark surface (5.6:1 on SIDEBAR, 6.4:1 on FIELD_BG). */
export const MUTED = '#9aa3b2';
export const ACCENT = '#18BAE6';
export const FIELD_BG = '#1b2028';
/** Tool rail background (same value as FIELD_BG; named for intent). */
export const RAIL_BG = FIELD_BG;

// --- light surface (bottom toolbar) ---
export const BAR_BG = '#fafafa';
export const BAR_BORDER = '#e6e6e6';
/** Secondary text on the light toolbar, e.g. zoom level and "N items" (5.5:1 on BAR_BG). */
export const BAR_MUTED = '#666666';
export const BAR_BTN_BG = '#ffffff';
export const BAR_BTN_TEXT = '#333333';
export const BAR_BTN_BORDER = '#dddddd';
/** Disabled buttons are exempt from WCAG 1.4.3, so these are deliberately low-contrast. */
export const BAR_BTN_DISABLED_BG = '#f3f3f3';
export const BAR_BTN_DISABLED_TEXT = '#bbbbbb';

// --- canvas area ---
export const CANVAS_BG = '#ffffff';
export const CANVAS_TEXT = '#222222';
export const RAIL = 52;
export const PANEL = 280;
export const BAR = 48;
export const FONT = '13px/1.3 system-ui, sans-serif';

export const linkBtn: CSSProperties = {
  background: 'none',
  border: 0,
  color: ACCENT,
  cursor: 'pointer',
  font: FONT,
  padding: '0 6px',
};

export const fieldStyle: CSSProperties = {
  width: '100%',
  padding: 8,
  border: 0,
  borderRadius: 4,
  background: FIELD_BG,
  color: SIDEBAR_TEXT,
  font: FONT,
  boxSizing: 'border-box',
};
