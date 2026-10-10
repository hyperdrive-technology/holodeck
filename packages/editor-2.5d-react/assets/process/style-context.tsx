import { createContext, useContext, type ReactNode } from 'react';
import { HOLODECK_STYLE, type HolodeckStyle } from './style';

/**
 * Style tokens for code-built parts (Edges, WhiteFill, Tank, Area, ...).
 *
 * A React context with `HOLODECK_STYLE` as the default value, so parts render
 * identically when no provider is mounted (browser snapshot tests rely on
 * that). Themes (`holodeck.iso.theme` contributions) swap the value.
 *
 * Not everything is themed yet: module-level constants such as `EDGE`/`BODY`
 * in Shell.tsx and the tank-params defaults are frozen at import time and
 * still read `HOLODECK_STYLE` directly. Parts that matter visually read the
 * context instead; follow that pattern when you convert another one.
 */
const StyleContext = createContext<HolodeckStyle>(HOLODECK_STYLE);

export function HolodeckStyleProvider({ style, children }: { style: HolodeckStyle; children?: ReactNode }) {
  return <StyleContext.Provider value={style}>{children}</StyleContext.Provider>;
}

export function useHolodeckStyle(): HolodeckStyle {
  return useContext(StyleContext);
}
