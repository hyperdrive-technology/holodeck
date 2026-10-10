import type { CSSProperties } from 'react';

/** Chrome tokens shared by the editor panels. Inline styles on purpose: the package ships no CSS. */
export const SIDEBAR = '#252b36';
export const SIDEBAR_TEXT = '#e8eaed';
export const MUTED = '#9aa3b2';
export const ACCENT = '#18BAE6';
export const FIELD_BG = '#1b2028';
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
