import { HOLODECK_STYLE, type HolodeckStyle } from '../../assets/process/style';
import type { IsoTheme } from './types';

export const HOLODECK_THEME_DEFAULT: IsoTheme = {
  id: 'holodeck.default',
  label: 'Holodeck',
  style: HOLODECK_STYLE,
};

/**
 * Slightly darker body, cooler edges and a cyan accent. Built as a copy of
 * HOLODECK_STYLE so any token added there flows through; only what differs
 * is spelled out. Kept light enough to stay on the white canvas: this is a
 * "dusk" variant of the same drawing style, not a night mode.
 */
const body = '#d3d9e2';
export const HOLODECK_STYLE_DARK: HolodeckStyle = {
  ...HOLODECK_STYLE,
  colors: {
    ...HOLODECK_STYLE.colors,
    body,
    edge: '#2f3a4a',
    areaFill: '#dfe4ec',
    areaEdge: '#a9b3c2',
    accent: '#18bae6',
    band: '#18bae6',
    bandInstanced: '#18bae6',
    liquid: '#2f7eb8',
    bore: '#1f2733',
  },
  finishes: {
    ...HOLODECK_STYLE.finishes,
    white: { ...HOLODECK_STYLE.finishes.white, color: body },
    accent: { ...HOLODECK_STYLE.finishes.accent, color: '#18bae6' },
    vessel: { ...HOLODECK_STYLE.finishes.vessel, shadeMin: 0.16, shadeMax: 0.82, hubWhite: 0.7 },
    flask: { ...HOLODECK_STYLE.finishes.flask, shadeMin: 0.3, shadeMax: 0.85, hubWhite: 0.75 },
    shaded: { ...HOLODECK_STYLE.finishes.shaded, shadeMin: 0.4, shadeMax: 0.8, hubWhite: 0.8 },
  },
};

export const HOLODECK_THEME_DARK: IsoTheme = {
  id: 'holodeck.dark',
  label: 'Holodeck dusk',
  style: HOLODECK_STYLE_DARK,
};

export const BUILTIN_ISO_THEMES: readonly IsoTheme[] = [HOLODECK_THEME_DEFAULT, HOLODECK_THEME_DARK];
