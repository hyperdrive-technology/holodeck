/**
 * Holodeck "Arcentry-style" iso look as one token object.
 *
 * Every value the process parts used to hard-code (unlit white body, #666
 * fat edges, the view-space left-dark / right-light iso shade on vessels)
 * lives here. Code-built parts read these tokens through the older constant
 * names (`TANK_SHADE_MIN`, `PIPE_WIRE_WIDTH`, `EDGE`, …), which are now
 * aliases. GLB parts from Blender get the same look through
 * `applyHolodeckStyle` (apply-style.ts), which maps material names
 * (`hd.white`, `hd.vessel`, …) onto the `finishes` below.
 *
 * Phase 1 rule: these numbers are the exact values the scene rendered with
 * before the extraction. `style.test.ts` pins them so a typo here shows up
 * as a failing test, not as a subtle grey shift in the snapshot.
 *
 * No three / React imports on purpose — this file is plain data so the
 * Blender pipeline (or a node script) can read it without a renderer.
 */

/** Unlit flat colour. `white` and `accent` are this kind. */
export type UnlitFinish = {
  kind: 'unlit';
  color: string;
  /**
   * Push the fill back in depth so coplanar edge lines win. Off for pipes
   * and other white parts: the offset lets the floor grid steal the
   * underside and it reads as ground-only shade.
   */
  offset: boolean;
};

/**
 * View-space iso gradient. `shadeMin` is the darkest grey (normal facing
 * screen-left), `shadeMax` the lightest (screen-right). `hubWhite` is the
 * grey at the local Y axis when `whiteHub` is on (caps / dome apex).
 */
export type IsoFinish = {
  kind: 'iso';
  shadeMin: number;
  shadeMax: number;
  hubWhite: number;
  whiteHub: boolean;
  /** Tanks need this so Edges win over the fill. */
  offset: boolean;
};

/**
 * Translucent liquid (tank / mixer fill, GLB `hd.liquid`). Unlit, blended,
 * `depthWrite` off so the interior back-wall lines, the impeller and the
 * liquid's own edges read through it like reference.jpg's light-blue fill.
 * Drawn after the (opaque) shell: `renderOrder` is applied to the mesh so a
 * transparent shell layer in the same part still sorts behind the liquid.
 * Colour: `color` when set, else `style.colors.liquid` (per-instance level
 * colours come in as an override, like the accent).
 */
export type LiquidFinish = {
  kind: 'liquid';
  /** Fill colour; absent = `style.colors.liquid`. */
  color?: string;
  /** 0..1 blend opacity. */
  opacity: number;
  /** Mesh render order (after shells at 0). */
  renderOrder: number;
  /** Always false: see above. Kept as a token so tests and the Blender lane can read it. */
  depthWrite: false;
  offset: boolean;
};

/**
 * A shell finish token. Unchanged since the first release: the liquid is a
 * separate token (`LiquidFinish`, `style.finishes.liquid`), so code that
 * switches over `Finish` / indexes `style.finishes[FinishName]` still gets a
 * shell `Finish` (third review of #228: widening these unions was a public
 * type break).
 */
export type Finish = UnlitFinish | IsoFinish;

/** Shell finish names. A GLB material named `hd.<name>` picks the matching finish. */
export type FinishName = 'white' | 'shaded' | 'vessel' | 'flask' | 'accent';

/** Every GLB material finish: the shell finishes plus `hd.liquid` (`MATERIAL_FINISH_NAMES`). */
export type MaterialFinishName = FinishName | 'liquid';

/**
 * Tokens for the Arcentry-parity annotation objects (connectors, area
 * variants, icons, metadata plane; holodeck#36). Optional on `HolodeckStyle`
 * so pack themes written before these objects existed still validate; read
 * them through `annotationStyle(style)`, which falls back to the defaults.
 */
export type AnnotationStyle = {
  /** Connector line colour when the placement sets none. */
  connector: string;
  /** Connector ribbon width (world units) when the placement sets none. */
  connectorWidth: number;
  /** Moving dots of an animated connector (`flow: true`). */
  flow: string;
  /** Floor text colour for connector captions, icons' glyph labels and plain text. */
  text: string;
  /** Default icon colour. */
  icon: string;
  /** Dashed / dotted area outline ribbon width (world units). */
  areaOutlineWidth: number;
  /** Walled ("VPN") area: wall fill, its opacity and default height. */
  areaWall: string;
  areaWallOpacity: number;
  areaWallHeight: number;
  /** Area drop shadow colour and opacity per shadow level (1..3). */
  shadow: string;
  shadowOpacity: number;
  /** Metadata plane panel. */
  metaFill: string;
  metaEdge: string;
  metaText: string;
};

export type HolodeckStyle = {
  /** Annotation-object tokens; absent = `HOLODECK_ANNOTATION_STYLE`. Read via `annotationStyle()`. */
  annotation?: AnnotationStyle;
  colors: {
    /** Unlit body fill for pipes, fittings, caps. */
    body: string;
    /** Fat outline colour on every part. */
    edge: string;
    /** Supply-area slab fill. */
    areaFill: string;
    /** Supply-area outline: lighter than `edge` so the slab sits behind the plant. */
    areaEdge: string;
    /** Default accent: valve handwheels. */
    accent: string;
    /** Unique-mesh `Pipe` band stripe default (`FittingParams.pipeBandColor`). */
    band: string;
    /** Instanced pipe band fallback when a scene pipe has no `band` (see InstancedLibrary). */
    bandInstanced: string;
    /** Pipe wireframe colour in the fitting tuner (`FittingParams.pipeWireColor`). */
    pipeWire: string;
    /** Liquid fill default (`TankParams.fillColor`). */
    liquid: string;
    /** Mixer liquid / temperature label when the live value alarms. */
    alarm: string;
    /** Dark bore inside the steam hex coupling. */
    bore: string;
  };
  edges: {
    /** `EdgesGeometry` crease angle in degrees when a part does not name one. */
    threshold: number;
    /**
     * Named crease thresholds. Lower draws more edges (1 ≈ every face
     * boundary), higher draws only hard creases.
     */
    thresholds: {
      /** Tank wall Edges (only drawn when the cage is off). */
      tankWall: number;
      /** Mixer bottle wall. */
      mixerWall: number;
      /** Quarter-torus elbows. Must be < 11.25 (the 8-step sweep) to outline the sweep joints. */
      elbow: number;
      /** Pipe tube + joint rings + end flanges (8-gon: 45° facets, 90° ring steps). */
      pipe: number;
      /** Valve barrel, flanges, bonnet. */
      valve: number;
      /** Valve handwheel: above the 30° rim facets so only the 90° box/cylinder steps (rim, hub, spokes) outline. */
      valveWheel: number;
      /** West packaging hex nut: every face edge. */
      nut: number;
      /** West packaging hex ridges around the nut. */
      westRing: number;
      /** Steam-out hex coupling. */
      steamNut: number;
      /** Supply-area slab outline. */
      area: number;
    };
    /** `Edges` default width in CSS px (Line2NodeMaterial.linewidth). */
    lineWidth: number;
    /** Pipe / fitting / vessel wire width in CSS px. */
    wireWidth: number;
  };
  finishes: Record<FinishName, Finish> & {
    white: UnlitFinish;
    shaded: IsoFinish;
    vessel: IsoFinish;
    flask: IsoFinish;
    accent: UnlitFinish;
    /**
     * Optional so themes written before `hd.liquid` (2026-10-29) still
     * validate; read it through `liquidFinish(style)`.
     */
    liquid?: LiquidFinish;
  };
};

export const HOLODECK_ANNOTATION_STYLE: AnnotationStyle = {
  // Same grey as the part outlines: connectors read as part of the drawing.
  connector: '#666666',
  connectorWidth: 0.08,
  flow: '#4aa3d9',
  // The label fill (Label maps the #666 default to this darker grey for 8 px legibility).
  text: '#4a4a4a',
  icon: '#666666',
  areaOutlineWidth: 0.05,
  areaWall: '#ffffff',
  areaWallOpacity: 0.55,
  areaWallHeight: 0.6,
  shadow: '#000000',
  shadowOpacity: 0.07,
  metaFill: '#ffffff',
  metaEdge: '#c8c8c8',
  metaText: '#4a4a4a',
};

/** The annotation tokens of `style`, defaulted for themes that predate them. */
export function annotationStyle(style: HolodeckStyle): AnnotationStyle {
  return style.annotation ?? HOLODECK_ANNOTATION_STYLE;
}

/**
 * Default liquid finish. Opacity history (Tank liquidOpacity before the
 * token): 0.69 with depthWrite on printed flask meridians; 1 (solid) hid the
 * interior rings; 0.84 hid the agitator. With depthWrite off: 0.62 read
 * dull blue-grey over the shaded liner vs reference.jpg's bright cyan; 0.78
 * keeps the colour while back-wall lines, bowl lines and blades still read
 * through (and scores better on the Arcentry fidelity gate).
 */
export const LIQUID_FINISH: LiquidFinish = {
  kind: 'liquid',
  opacity: 0.78,
  renderOrder: 2,
  depthWrite: false,
  offset: false,
};

export const HOLODECK_STYLE: HolodeckStyle = {
  annotation: HOLODECK_ANNOTATION_STYLE,
  colors: {
    body: '#ffffff',
    // Edges stay #666. Phong + lights flattened the plant to an even grey,
    // so fills are unlit and only the outline carries the drawing.
    edge: '#666666',
    areaFill: '#f3f3f3',
    areaEdge: '#c8c8c8',
    accent: '#c0392b',
    band: '#c0392b',
    // Not the same red as `band`. Kept separate so phase 1 does not shift
    // any instanced band that falls back to it.
    bandInstanced: '#e74c3c',
    pipeWire: '#888888',
    liquid: '#5cc8e6',
    alarm: '#e85d5d',
    bore: '#3a3a3a',
  },
  edges: {
    threshold: 15,
    thresholds: {
      // Tanks inherited wallThreshold 7 so the silo Edges sat a wire cage vs
      // r-holdbody quieter wall. Mixer stays 7.
      tankWall: 15,
      mixerWall: 7,
      // 22 hid the 15° sweep joints; 10 draws them without adding
      // any extra lines (torus facets are 45° across, 11.25° along since round 2).
      elbow: 10,
      // Round 3: 30 (was 15). The 8-gon facets are 45° and the joint bump crest ~44°, both above 30; the bump
      // feet are ~22°, below it, so each joint draws ONE line (was two: a fat ring's 90° end caps). See
      // pipe-geometry.ts and PIPE_RING_FOOT_DEG / PIPE_RING_CREST_DEG. Raising it past 45 would drop the
      // longitudinal facets, which is the wire mesh itself.
      pipe: 30,
      valve: 15,
      // Round 3: at 15 the 12-gon rim facets + inner ring + hub + spokes drew ~40 wire segments over a 16 px
      // disc and turned the tint to grey/brown mush. 40 keeps the 90° steps (rim edge, spokes) only.
      valveWheel: 40,
      // threshold 1 on the west hex rings drew every face vs r-west filled
      // ridges. Nut stays 1.
      nut: 1,
      westRing: 15,
      // threshold 1 / instanced wireframe caged every hex face vs r-steam2
      // filled coupling. West rings already use 15; west nut stays 1.
      steamNut: 15,
      area: 1,
    },
    lineWidth: 1,
    // Line2 width in CSS px. meshBasic wireframe / gl.lineWidth stay 1 on
    // most GPUs, which is why the outlines are fat Line2 meshes at all.
    wireWidth: 1.5,
  },
  finishes: {
    // Unlit white fill. Iso shade is tanks-only — pipes read as grey if
    // they share it.
    white: { kind: 'unlit', color: '#ffffff', offset: false },
    // Generic iso shade: the `ShadedFill` defaults (end-cap spheres use it).
    shaded: { kind: 'iso', shadeMin: 0.5, shadeMax: 0.92, hubWhite: 0.92, whiteHub: false, offset: true },
    vessel: {
      kind: 'iso',
      // 0.27 left the silo left-wall too white vs r-holdbody iso (darker
      // left, lighter right).
      shadeMin: 0.22,
      // Tanks inherited shadeMax 0.92 so the light side greyed vs
      // r-holdbody even silo. Mixer stays 0.97.
      shadeMax: 0.95,
      // Tanks inherited hubWhite 0.77 so the iso hub greyed vs r-holdbody
      // even silo. Mixer stays 0.88.
      hubWhite: 0.85,
      whiteHub: false,
      offset: true,
    },
    flask: {
      kind: 'iso',
      // Mixer inherited TANK_SHADE_MIN 0.22 so the bottle left-wall charcoal
      // dualled vs r-mixer's paler flask.
      shadeMin: 0.4,
      // Mixer inherited shadeMax 0.92 so the light side still greyed vs
      // r-mixer white flask. Tanks keep the vessel shadeMax.
      shadeMax: 0.97,
      // Mixer inherited hubWhite 0.77 so the iso hub still greyed vs r-mixer
      // even flask.
      hubWhite: 0.88,
      whiteHub: false,
      offset: true,
    },
    // Unlit flat colour. On a GLB the source material's base colour wins
    // over this default; `applyHolodeckStyle(..., { accent })` wins over both.
    accent: { kind: 'unlit', color: '#c0392b', offset: false },
    liquid: LIQUID_FINISH,
  },
};

/** Finish names in a fixed order (tests, tuners, material-name parsing). */
export const FINISH_NAMES: readonly FinishName[] = ['white', 'shaded', 'vessel', 'flask', 'accent'];

/** Every `hd.<name>` material a GLB may use: the shell finishes plus `hd.liquid`. */
export const MATERIAL_FINISH_NAMES: readonly MaterialFinishName[] = [...FINISH_NAMES, 'liquid'];

/** The liquid finish of `style`, defaulted for themes that predate it. */
export function liquidFinish(style: HolodeckStyle): LiquidFinish {
  return style.finishes.liquid ?? LIQUID_FINISH;
}

/** A finish token by name; `liquid` falls back to `LIQUID_FINISH` for older themes. */
export function finishToken(style: HolodeckStyle, name: FinishName): Finish;
export function finishToken(style: HolodeckStyle, name: MaterialFinishName): Finish | LiquidFinish;
export function finishToken(style: HolodeckStyle, name: MaterialFinishName): Finish | LiquidFinish {
  return name === 'liquid' ? liquidFinish(style) : style.finishes[name];
}

/**
 * Vertical gap (world units) between stacked ground layers, so a part's
 * contact edge is never buried in what it stands on. Parts sit at y = 0, the
 * area slab at -1 gap (AREA_Y), the editor's pick plane at -2 gaps, the floor
 * grid below that (-0.06). 0.02 is ~1.6 CSS px of screen height at the max
 * zoom (80) and well above depth-buffer precision for the 0.5..4000 ortho
 * near/far range. Plain number, not a theme token: themes must not be able
 * to reorder the ground layers.
 */
export const GROUND_CONTACT_EPSILON = 0.02;
