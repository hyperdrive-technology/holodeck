/** Complete holodeck.iso style tokens, including the E2 annotation surface. */
function style(dark: boolean) {
  const body = dark ? '#334155' : '#ffffff';
  const edge = dark ? '#a7b8ce' : '#607086';
  const accent = dark ? '#91b8e4' : '#6d8fbd';
  const text = dark ? '#e2e8f0' : '#334155';
  const area = dark ? '#1e293b' : '#f1f5f9';
  const areaEdge = dark ? '#607086' : '#c5d0de';
  return {
    colors: {
      body, edge, accent, areaFill: area, areaEdge,
      band: accent, bandInstanced: accent, pipeWire: edge,
      liquid: dark ? '#65b8d8' : '#4a9cbd', alarm: '#e86868',
      bore: dark ? '#0f172a' : '#334155',
    },
    edges: {
      threshold: 25, lineWidth: 1, wireWidth: 1.25,
      thresholds: {
        tankWall: 15, mixerWall: 7, elbow: 10, pipe: 30, valve: 15,
        valveWheel: 40, nut: 1, westRing: 15, steamNut: 15, area: 1,
      },
    },
    finishes: {
      white: { kind: 'unlit' as const, color: body, offset: false },
      accent: { kind: 'unlit' as const, color: accent, offset: false },
      shaded: { kind: 'iso' as const, shadeMin: dark ? 0.18 : 0.5, shadeMax: dark ? 0.48 : 0.92, hubWhite: dark ? 0.5 : 0.92, whiteHub: false, offset: true },
      vessel: { kind: 'iso' as const, shadeMin: dark ? 0.14 : 0.22, shadeMax: dark ? 0.5 : 0.9, hubWhite: dark ? 0.55 : 1, whiteHub: true, offset: true },
      flask: { kind: 'iso' as const, shadeMin: dark ? 0.2 : 0.5, shadeMax: dark ? 0.55 : 0.92, hubWhite: dark ? 0.6 : 1, whiteHub: true, offset: true },
      // Colour comes from colors.liquid; same tokens as LIQUID_FINISH (GLB `hd.liquid`).
      liquid: { kind: 'liquid' as const, opacity: 0.78, renderOrder: 2, depthWrite: false as const, offset: false },
    },
    annotation: {
      connector: edge, connectorWidth: 0.07, flow: accent, text, icon: text,
      areaOutlineWidth: 0.045, areaWall: body, areaWallOpacity: 0.55,
      areaWallHeight: 0.6, shadow: '#000000', shadowOpacity: dark ? 0.15 : 0.07,
      metaFill: area, metaEdge: areaEdge, metaText: text,
    },
  };
}

export const ARCENTRY_LIGHT = { id: 'arcentry-light', label: 'Arcentry light', style: style(false) };
export const ARCENTRY_DARK = { id: 'arcentry-dark', label: 'Arcentry dark', style: style(true) };
export const CLOUD_THEMES = [ARCENTRY_LIGHT, ARCENTRY_DARK];
