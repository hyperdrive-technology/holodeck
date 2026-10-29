import { Color, Quaternion, Vector3 } from 'three';
import { HOLODECK_STYLE, LIQUID_FINISH } from './style';

/** Legacy cap prop on `<Tank cap>`; maps onto `TankTop` ('flat' = flat lid with a hatch). */
export type TankCap = 'dome' | 'flat';

/** Top closure of the base vessel. */
export type TankTop = 'dome' | 'flat' | 'cone';
/** Bottom closure (drawn below the shell floor, so `height` stays the straight-wall height). */
export type TankBottom = 'flat' | 'dish' | 'cone';
/** Stand under the bottom closure. */
export type TankSupport = 'none' | 'legs' | 'skirt';
/** Side nozzle on the kept arc. 'tangential' is the whirlpool inlet. */
export type TankNozzle = 'none' | 'tangential';

export const TANK_TOPS: readonly TankTop[] = ['dome', 'flat', 'cone'];
export const TANK_BOTTOMS: readonly TankBottom[] = ['flat', 'dish', 'cone'];
export const TANK_SUPPORTS: readonly TankSupport[] = ['none', 'legs', 'skirt'];

/** Holding / ingredient flask radius / tank radius. 0.9 filled the silo like a pie vs r-holdbody's inset U
 *  when the flask was a window-sliced pie; 0.8 / 0.76 / 0.74 followed. Round 2 (translucent closed flask with
 *  bowl lines): 0.9 again -- reference.jpg's liquid spans the window, and fidelity 0.1960 -> 0.2022. */
export const TANK_INNER_RATIO = 0.9;

/** Holding flask U sits on the floor. −0.2 put the hemisphere equator at the
 *  tank bottom so fill 0.21 read as a ball vs r-holdbody's bottle. */
export const TANK_BOWL_Y_OFFSET = 0;

/** 4 dome stacks drew a latitude cage vs r-holdbody's sparse cap. */
export const TANK_DOME_HEIGHT_SEGMENTS = 3;

/** 1 extra hoop dualled vs r-holdbody's quieter silo. */
export const TANK_BODY_RINGS = 0;

/**
 * Horizontal hoops on the inner back wall between the floor rim and the top
 * rim, seen through the cutaway (reference.jpg: the holding / ingredient
 * tanks show their inner rim and hoop lines through the window, above and
 * below the liquid). Des, 2026-10-29: reverses the earlier "no lines inside
 * the window" rule. 0 = rims only. Round 2: 1 (mid hoop). reference.jpg
 * shows rims + panel seams but no hoops; 2 hoops plus 4 seams read as a grid.
 */
export const TANK_INTERIOR_HOOPS = 1;

/** The interior rings sit just inside the liner so they never z-fight it. */
export const INTERIOR_RING_INSET = 0.995;

/**
 * Vertical liner seams on the inner back wall: every Nth liner vertex on the
 * back arc. reference.jpg's interiors show two or three seams; step 1 (every
 * facet, ~6 with the margin) read as a bird cage in the demo scene. 0 = rings only.
 */
export const TANK_INTERIOR_MERIDIAN_STEP = 2;

/**
 * Width (CSS px) of the cage, rim, interior and liquid lines (Line2). The
 * creases (Edges) use `edges.wireWidth` 1.5; these are the reference's
 * thinner panel lines. 1-device-px lineBasic (before round 2) was ~0.5 CSS px
 * at DPR 2 and read faint.
 */
export const TANK_LINE_WIDTH = 1;

/**
 * Liner (inner wall) iso shade, seen from inside with the inward normal:
 * lighter than the outer wall (vessel 0.22..0.95) like reference.jpg's
 * interiors -- near-white panels greying slightly toward the right.
 */
export const LINER_SHADE = { shadeMin: 0.75, shadeMax: 0.85, hubWhite: 1 } as const;

/** Extra arc (radians) either side of the visible back arc so the hoops meet the jamb silhouettes without a gap. */
export const INTERIOR_RING_MARGIN = 0.08;

/** Alias of `HOLODECK_STYLE.finishes.vessel.shadeMin` (style.ts has the why). */
export const TANK_SHADE_MIN = HOLODECK_STYLE.finishes.vessel.shadeMin;

/** Alias of `HOLODECK_STYLE.finishes.vessel.hubWhite`. */
export const TANK_HUB_WHITE = HOLODECK_STYLE.finishes.vessel.hubWhite;

/** Alias of `HOLODECK_STYLE.finishes.vessel.shadeMax`. */
export const TANK_SHADE_MAX = HOLODECK_STYLE.finishes.vessel.shadeMax;

/** Alias of `HOLODECK_STYLE.finishes.flask.shadeMin`. */
export const MIXER_SHADE_MIN = HOLODECK_STYLE.finishes.flask.shadeMin;

/**
 * 0.69 let flask meridians print through the cyan (depthWrite off then) vs
 * r-mixer's fill; 0.84 hid the shaft and impeller below the waterline (Des
 * 2026-10-29). With depthWrite on only the flask's front surface blends,
 * so 0.72 shows the agitator and the back-wall hoops through the liquid
 * like reference.jpg's mixer without any mesh lines printing through.
 */
export const MIXER_LIQUID_OPACITY = LIQUID_FINISH.opacity; // one liquid look since round 2: the `liquid` finish token

/** Tanks inherited liquidOpacity 0.69 so meridians printed through the fill vs r-holdbody solid U. Mixer stays 0.84. */
// History: 0.88 with depthWrite off printed the flask's own back faces and meridians through the cutout;
// 1 (solid) hid the interior back-wall rings that Des asked for on 2026-10-29 (reference.jpg shows the
// inner rim / hoop lines through the liquid). 0.8 with depthWrite ON: only the flask's front surface
// blends, so the back-wall hoops read as darker liquid-tinted lines and nothing else prints through.
export const TANK_LIQUID_OPACITY = LIQUID_FINISH.opacity; // alias of the `liquid` finish token (style.ts), shared with GLB hd.liquid

/** Aliases of `HOLODECK_STYLE.edges.thresholds.tankWall` / `.mixerWall`. */
export const TANK_WALL_THRESHOLD = HOLODECK_STYLE.edges.thresholds.tankWall;
export const MIXER_WALL_THRESHOLD = HOLODECK_STYLE.edges.thresholds.mixerWall;

/** Alias of `HOLODECK_STYLE.finishes.flask.hubWhite`. */
export const MIXER_HUB_WHITE = HOLODECK_STYLE.finishes.flask.hubWhite;

/** Alias of `HOLODECK_STYLE.finishes.flask.shadeMax`. */
export const MIXER_SHADE_MAX = HOLODECK_STYLE.finishes.flask.shadeMax;

/** Mixer inherited linerRatio 0.97 so the window inner wall sat thick vs r-mixer thin glass. */
export const MIXER_LINER_RATIO = 0.99;

/** Tanks inherited linerRatio 0.97 so the window inner wall sat thick vs r-holdbody thin glass. Mixer stays 0.99. */
export const TANK_LINER_RATIO = 0.99;

/** Mixer inherited linerColor #f4f4f4 so the window inner sat cream vs r-mixer white cutaway. */
export const MIXER_LINER_COLOR = '#ffffff';

/** Tanks inherited linerColor #f4f4f4 so the window inner sat cream vs r-holdbody white cutaway. */
export const TANK_LINER_COLOR = '#ffffff';

/** Holding / ingredient keep-arc. Mixer stays MIXER_WINDOW_DEG 70 because 91 ate
 *  the +X bottle wall. o-holdbody cut sits vs r-holdbody — do not narrow. */
export const TANK_WINDOW_DEG = 91;
export const TANK_WINDOW_YAW = 45;

export type TankParams = {
  height: number;
  radius: number;
  fill: number;
  fillColor: string;
  liquidOpacity: number;
  innerRatio: number;
  linerRatio: number;
  linerColor: string;
  windowDeg: number;
  windowYawDeg: number;
  radialSegments: number;
  bodyHeightSegments: number;
  bodyRings: number;
  bodyRingWidth: number;
  cageThreshold: number;
  wallThreshold: number;
  domeHeightSegments: number;
  domePhiDeg: number;
  domeRadiusScale: number;
  /** World-space height of the spherical cap (hemisphere ≈ radius when phi is 90°). */
  domeHeight: number;
  /** Extra Y from the body top; + lifts the dome. */
  domeYOffset: number;
  domeThreshold: number;
  capHeightRatio: number;
  capRadiusRatio: number;
  capLidThickness: number;
  capLineWidth: number;
  bowlHeightSegments: number;
  /** World-space height of the inner hemisphere (equals inner radius at defaults). */
  bowlHeight: number;
  /** Extra Y from the tank floor; + lifts the bowl. */
  bowlYOffset: number;
  bowlThreshold: number;
  edgeColor: string;
  lineWidth: number;
  shadeMin: number;
  shadeMax: number;
  hubWhite: number;
  showCage: boolean;
  showWall: boolean;
  showLiner: boolean;
  showDome: boolean;
  /**
   * Liquid bowl lines (meridians + latitude rings on the flask bowl), seen through the liquid like
   * reference.jpg's liquid bottom. Off before round 2: with depthWrite on they printed through as "mesh lines".
   */
  showBowl: boolean;
  /** Inner ullage cage (meridians at the inner radius above the liquid). Off for the same reason. */
  showInnerCage: boolean;
  showLiquid: boolean;
  /** Horizontal rim + hoop lines on the inner back wall, seen through the window (reference.jpg). */
  showInteriorRings: boolean;
  /** Body hoops between the bottom and top inner rims (`TANK_INTERIOR_HOOPS`). */
  interiorHoops: number;
  /** Liner facet seams on the back wall: every Nth vertex, 0 = none (`TANK_INTERIOR_MERIDIAN_STEP`). */
  interiorMeridianStep: number;
  shaftRadius: number;
  shaftLength: number;
  impellerSpan: number;
  impellerRadius: number;
  /** Fraction of body height that tapers into the dome (0 = silo). */
  shoulderRatio: number;
  /** Top radius / tank radius at the dome join. */
  shoulderTopRatio: number;
  /** Outer heel height. 0 = flat cylinder floor (tanks). */
  outerBowlHeight: number;
  // --- Base-vessel presets (brewery HLT / mash tun / kettle / whirlpool) ---
  /** Top closure. `<Tank cap>` (legacy) overrides this when given. */
  top: TankTop;
  /** Bottom closure below the shell floor. */
  bottom: TankBottom;
  /** Stand below the bottom closure (lifts the vessel by `standHeight`). */
  support: TankSupport;
  /** Draw the agitator (drive hat on the top, shaft + 3-blade impeller in the window). */
  agitator: boolean;
  /** Side nozzle on the kept arc. */
  nozzle: TankNozzle;
  /** Cone lid height (world units) for `top: 'cone'`. */
  coneTopHeight: number;
  /** Cone lid top radius as a fraction of the tank radius. */
  coneTopRatio: number;
  /** Dish depth below the floor for `bottom: 'dish'`. */
  dishBottomHeight: number;
  /** Cone depth below the floor for `bottom: 'cone'`. */
  coneBottomHeight: number;
  /** Cone outlet radius as a fraction of the tank radius. */
  coneBottomRatio: number;
  /** Stand height (legs or skirt) in world units. */
  standHeight: number;
  /** Leg radius. */
  legRadius: number;
  /** Number of legs. */
  legCount: number;
};

export const DEFAULT_TANK_PARAMS: TankParams = {
  height: 3.05,
  radius: 1,
  fill: 0.21,
  fillColor: HOLODECK_STYLE.colors.liquid,
  liquidOpacity: TANK_LIQUID_OPACITY,
  innerRatio: TANK_INNER_RATIO,
  linerRatio: TANK_LINER_RATIO,
  linerColor: TANK_LINER_COLOR,
  windowDeg: TANK_WINDOW_DEG,
  windowYawDeg: TANK_WINDOW_YAW,
  radialSegments: 15,
  bodyHeightSegments: 1,
  bodyRings: TANK_BODY_RINGS,
  bodyRingWidth: 0.004,
  cageThreshold: 1,
  wallThreshold: TANK_WALL_THRESHOLD,
  domeHeightSegments: TANK_DOME_HEIGHT_SEGMENTS,
  domePhiDeg: 90,
  domeRadiusScale: 1,
  domeHeight: 0.32,
  domeYOffset: -0.02,
  domeThreshold: 0.2,
  capHeightRatio: 0.14,
  capRadiusRatio: 0.54,
  capLidThickness: 0.02,
  capLineWidth: HOLODECK_STYLE.edges.wireWidth,
  bowlHeightSegments: 2,
  bowlHeight: 0.24,
  bowlYOffset: TANK_BOWL_Y_OFFSET,
  bowlThreshold: 1,
  edgeColor: HOLODECK_STYLE.colors.edge,
  lineWidth: HOLODECK_STYLE.edges.wireWidth,
  shadeMin: TANK_SHADE_MIN,
  shadeMax: TANK_SHADE_MAX,
  hubWhite: TANK_HUB_WHITE,
  showCage: true,
  showWall: true,
  showLiner: true,
  showDome: true,
  showBowl: true,
  showInnerCage: false,
  showLiquid: true,
  showInteriorRings: true,
  interiorHoops: TANK_INTERIOR_HOOPS,
  interiorMeridianStep: TANK_INTERIOR_MERIDIAN_STEP,
  shaftRadius: 0.04,
  shaftLength: 0.88,
  impellerSpan: 1.3,
  impellerRadius: 0.036,
  shoulderRatio: 0,
  shoulderTopRatio: 1,
  outerBowlHeight: 0,
  top: 'dome',
  bottom: 'flat',
  support: 'none',
  agitator: false,
  nozzle: 'none',
  coneTopHeight: 0.3,
  coneTopRatio: 0.3,
  dishBottomHeight: 0.14,
  coneBottomHeight: 0.45,
  coneBottomRatio: 0.12,
  standHeight: 0.35,
  legRadius: 0.035,
  legCount: 4,
};

/**
 * Vertical layout of the base vessel. `height` is the straight-wall height
 * (what the scene stores and the resize handle drags); the top closure sits
 * above it and the bottom closure + stand below it. `y0` is the shell floor in
 * the Tank's local frame (origin at the wall's mid-height), `floorY` the
 * lowest point (where the stand or closure meets the ground). A part
 * positions the Tank at `[x, -floorY, z]` so that point lands on y = 0.
 */
export function tankLayout(
  height: number,
  radius: number,
  p: Pick<
    TankParams,
    | 'top'
    | 'bottom'
    | 'support'
    | 'domeHeight'
    | 'domeYOffset'
    | 'coneTopHeight'
    | 'coneTopRatio'
    | 'dishBottomHeight'
    | 'coneBottomHeight'
    | 'coneBottomRatio'
    | 'standHeight'
  >,
): {
  y0: number;
  bodyTop: number;
  topHeight: number;
  apexY: number;
  bottomDepth: number;
  bottomY: number;
  standHeight: number;
  floorY: number;
  /** Radius where the top closure ends (cone tip / hatch). */
  topR: number;
  /** Radius where the bottom closure ends (cone outlet). */
  bottomR: number;
} {
  const y0 = -height / 2;
  const bodyTop = height / 2;
  const topHeight =
    p.top === 'dome' ? Math.max(0, p.domeHeight + p.domeYOffset) : p.top === 'cone' ? Math.max(0.02, p.coneTopHeight) : 0;
  const bottomDepth =
    p.bottom === 'dish'
      ? Math.min(Math.max(0, p.dishBottomHeight), radius)
      : p.bottom === 'cone'
        ? Math.max(0.02, p.coneBottomHeight)
        : 0;
  const standHeight = p.support === 'none' ? 0 : Math.max(0, p.standHeight);
  const bottomY = y0 - bottomDepth;
  return {
    y0,
    bodyTop,
    topHeight,
    apexY: bodyTop + topHeight,
    bottomDepth,
    bottomY,
    standHeight,
    floorY: bottomY - standHeight,
    topR: p.top === 'cone' ? radius * Math.min(0.95, Math.max(0, p.coneTopRatio)) : radius,
    bottomR: p.bottom === 'cone' ? radius * Math.min(0.9, Math.max(0, p.coneBottomRatio)) : radius,
  };
}

/**
 * World Y range of the straight (windowed) wall for a vessel seated on the
 * floor by `tankLayout` (the part puts the Tank at y = -floorY). This is
 * `IsoPartDefinition.wallSpan`: routing/vessel-ports.ts uses it to tell a
 * pipe running through the cut-away window from one passing under a vessel
 * on legs or a skirt.
 */
export function tankWallSpan(layout: Pick<ReturnType<typeof tankLayout>, 'y0' | 'bodyTop' | 'floorY'>): {
  bottomY: number;
  topY: number;
} {
  return { bottomY: layout.y0 - layout.floorY, topY: layout.bodyTop - layout.floorY };
}

/** Grid footprint (whole cells) that covers a vessel of `radius`; routing treats it as the obstacle box. */
export function vesselFootprint(radius: number): { w: number; h: number } {
  const cells = Math.max(1, Math.ceil(2 * Math.max(0, radius) - 1e-6));
  return { w: cells, h: cells };
}

/**
 * Pipe attach points for a vessel: east/west on the footprint edge at floor
 * level, so a resized vessel keeps its nozzles on its silhouette.
 */
export function vesselPorts(radius: number): Record<string, { x: number; y: number; dir: 'n' | 'e' | 's' | 'w' }> {
  const half = vesselFootprint(radius).w / 2;
  return {
    east: { x: half, y: 0, dir: 'e' },
    west: { x: -half, y: 0, dir: 'w' },
  };
}

/**
 * Lathe profile (r, y) of a cone frustum, `stacks` segments from (r0, y0) to
 * (r1, y1). Shared by the cone lid and the cone bottom.
 */
export function frustumProfile(r0: number, y0: number, r1: number, y1: number, stacks = 1): Array<[number, number]> {
  const n = Math.max(1, Math.round(stacks));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([r0 + (r1 - r0) * t, y0 + (y1 - y0) * t]);
  }
  return pts;
}

/**
 * Lathe profile of a shallow dish under the floor: a spherical cap of depth
 * `depth` whose rim is at (radius, yRim) and pole at (0, yRim - depth).
 */
export function dishProfile(radius: number, yRim: number, depth: number, stacks = 3): Array<[number, number]> {
  const d = Math.min(Math.max(1e-4, depth), radius);
  // Sphere through the rim circle and the pole: R = (r^2 + d^2) / 2d.
  const R = (radius * radius + d * d) / (2 * d);
  const cy = yRim - d + R;
  const n = Math.max(2, Math.round(stacks));
  const phiRim = Math.asin(Math.min(1, radius / R));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const phi = phiRim * (1 - i / n);
    pts.push([R * Math.sin(phi), cy - R * Math.cos(phi)]);
  }
  return pts;
}

/** Legs sit at this fraction of the tank radius (under the floor rim, inside the wall). */
export const LEG_RADIUS_RATIO = 0.78;

/**
 * Leg positions around the vessel, inset from the wall so legs sit under
 * the floor rim. Default yaw 0: legs at theta 0 / 90 / 180 / 270 put the two
 * front legs either side of the iso camera axis (theta 45). The old pi/4
 * offset stood one leg dead centre under the cutaway, where it read as a
 * stray front leg (Des 2026-10-29, mash tun).
 */
export function legPositions(radius: number, count: number, yawOffset = 0): Array<[number, number]> {
  const n = Math.max(1, Math.round(count));
  const r = radius * LEG_RADIUS_RATIO;
  return Array.from({ length: n }, (_, i) => {
    const a = yawOffset + (i * Math.PI * 2) / n;
    return [r * Math.sin(a), r * Math.cos(a)];
  });
}

/**
 * Does any line-segment endpoint of `positions` (x,y,z triples) lie inside
 * the window arc? Test helper for "no outline inside the cutout".
 */
export function segmentsInsideWindow(positions: Float32Array, windowStart: number, windowRad: number): number {
  let n = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    if (Math.hypot(x, z) < 1e-6) continue;
    // Cylinder theta: (x,z) = (sin θ, cos θ).
    const th = Math.atan2(x, z);
    // Strictly inside (jambs are allowed on the boundary).
    if (angleOnArc(th, windowStart + 1e-3, windowRad - 2e-3)) n += 1;
  }
  return n;
}

export function mergeTankParams(partial?: Partial<TankParams>): TankParams {
  return { ...DEFAULT_TANK_PARAMS, ...partial };
}

/**
 * Tuner Shape Height used to be ignored: SceneObjectView always passed
 * scene.json `object.height`. Scale each vessel from its authored height
 * so the mixer (2.7) stays shorter than the 3.05 tanks.
 */
export function tunedVesselHeight(sceneHeight: number, params?: Partial<TankParams>): number {
  if (params?.height == null) {
    return sceneHeight;
  }
  return sceneHeight * (params.height / DEFAULT_TANK_PARAMS.height);
}

/**
 * Agitator drive hat on the top apex, after reference.jpg's central mixer:
 * a short neck sunk into the dome, a round drum (the motor housing) and a
 * thin cover plate. Batch 3/4 drew a squat 8-gon puck; Des (2026-10-29)
 * called it "an octagonal flat disc". `apexY` overrides the dome apex for
 * flat / cone lids (the base Tank passes `tankLayout().apexY`).
 *
 * `capHeightRatio` sizes the neck, `capRadiusRatio` the drum radius (of the
 * tank radius), `capLidThickness` the cover plate; the drum height is
 * `MIXER_HAT_ASPECT` x its radius.
 */
export function mixerHatLayout(tankH: number, p: TankParams, apexY?: number) {
  const bodyTop = tankH / 2;
  const domeApex = apexY ?? bodyTop + p.domeYOffset + p.domeHeight;
  const neckH = Math.max(tankH * p.capHeightRatio * 0.22, 0.03);
  const lidH = Math.max(p.capLidThickness, 0.004);
  const capR = p.radius * p.capRadiusRatio;
  const neckR = capR * MIXER_NECK_RATIO;
  const drumH = capR * MIXER_HAT_ASPECT;
  // The neck starts a little below the apex so it never floats over a faceted dome.
  const neckBot = domeApex - MIXER_NECK_SINK;
  const neckTop = domeApex + neckH;
  const drumTop = neckTop + drumH;
  return {
    domeApex,
    neckH: neckTop - neckBot,
    neckR,
    drumH,
    lidH,
    capR,
    neckMidY: (neckBot + neckTop) / 2,
    drumMidY: neckTop + drumH / 2,
    lidMidY: drumTop + lidH / 2,
    lidTop: drumTop + lidH,
  };
}

/** Neck radius as a fraction of the drum radius (reference: a short collar under the motor). */
export const MIXER_NECK_RATIO = 0.45;

/** How far the neck sinks below the dome apex (world units). */
export const MIXER_NECK_SINK = 0.03;

/**
 * Drum height / drum radius. 0.25 (the old lid-only puck) read as a flat
 * disc; reference.jpg's motor hat is about half as tall as it is wide, so
 * height ~ 0.7x radius. 0.9 sat tall over the shoulder at 2x zoom.
 */
export const MIXER_HAT_ASPECT = 0.72;

/** Round drum: the 8-gon hat read as an octagonal disc vs the reference's cylinder. */
export const MIXER_HAT_SIDES = 24;

/**
 * Lowest the impeller hub may sit, as a fraction of the tank height above
 * the shell floor. Keeps the blades inside the flask's U when `shaftLength`
 * would run the shaft through the heel (Batch 3 rejected "through-heel").
 */
export const MIXER_IMPELLER_FLOOR_CLEARANCE = 0.16;

/**
 * Shaft + impeller. `shaftLength` is the drop from the dome apex to the
 * impeller hub, as a fraction of tank height (the tuner slider), clamped so
 * the hub stays MIXER_IMPELLER_FLOOR_CLEARANCE above the floor.
 *
 * The shaft ends INSIDE the hub (shaftBot = hub centre), so the impeller is
 * always attached. Before 2026-10-29 the blades sat at a fill-dependent
 * height (fill x 0.38) and the shaft was sized separately, so the impeller
 * floated off the shaft and moved with the liquid level. The impeller now
 * ignores the fill: a real agitator does not ride the waterline.
 */
export function mixerShaftLayout(tankH: number, p: TankParams, apexY?: number) {
  const hat = mixerHatLayout(tankH, p, apexY);
  const y0 = -tankH / 2;
  const floorY = y0 + tankH * MIXER_IMPELLER_FLOOR_CLEARANCE;
  const shaftTop = hat.neckMidY;
  const impellerY = Math.min(shaftTop - 0.1, Math.max(hat.domeApex - tankH * p.shaftLength, floorY));
  const hub = mixerImpellerBladeLayout(p.impellerSpan, p.shaftRadius, p.impellerRadius);
  const shaftBot = impellerY;
  const shaftH = shaftTop - shaftBot;
  return {
    ...hat,
    impellerY,
    hubR: hub.hubR,
    hubH: hub.hubH,
    shaftH,
    shaftTop,
    shaftBot,
    shaftY: (shaftTop + shaftBot) / 2,
  };
}

/**
 * Three.js cylinder theta is (x,z) = (sin θ, cos θ); sphere phi is
 * (x,z) = (−cos φ, sin φ). Same physical cut needs φ = θ + π/2.
 */
export function spherePhiFromCylinderTheta(theta: number): number {
  return theta + Math.PI / 2;
}

/**
 * Camera-facing hole vs remaining keep-arc. Iso looks from +X+Y+Z, so
 * yaw 45° / width 91° opens the +X/+Z quadrant (theta 0 is +Z).
 */
export function tankWindow(windowDeg: number, windowYawDeg: number): {
  windowRad: number;
  windowStart: number;
  keepStart: number;
  keepLen: number;
} {
  const windowRad = (windowDeg * Math.PI) / 180;
  const yaw = (windowYawDeg * Math.PI) / 180;
  return {
    windowRad,
    windowStart: yaw - windowRad / 2,
    keepStart: yaw + windowRad / 2,
    keepLen: Math.PI * 2 - windowRad,
  };
}

/**
 * The part of the inner wall the camera sees through the window: the
 * window's arc turned half a revolution (the back wall opposite the
 * opening), plus `margin` radians either side. Ring segments outside this
 * arc would sit behind the outer wall anyway; keeping them to the back arc
 * means no ring can poke through a jamb's cut face.
 */
export function interiorRingArc(
  windowDeg: number,
  windowYawDeg: number,
  margin = INTERIOR_RING_MARGIN,
): { start: number; len: number } {
  const { windowStart, windowRad } = tankWindow(windowDeg, windowYawDeg);
  const len = Math.min(Math.PI * 2, windowRad + 2 * margin);
  return { start: windowStart + Math.PI - margin, len };
}

/**
 * Heights of the interior rings: the bottom inner rim (`yBottom`), `hoops`
 * evenly spaced body hoops, and the top inner rim (`yTop`). Sorted bottom to
 * top; empty when the wall has no height.
 */
export function interiorRingHeights(yBottom: number, yTop: number, hoops: number): number[] {
  if (!(yTop - yBottom > 1e-4)) return [];
  const n = Math.max(0, Math.round(hoops));
  const ys = [yBottom];
  for (let i = 1; i <= n; i++) ys.push(yBottom + ((yTop - yBottom) * i) / (n + 1));
  ys.push(yTop);
  return ys;
}

/**
 * Distance from the axis to a faceted wall (a `CylinderGeometry` /
 * `LatheGeometry` with vertices every `facetStep` radians from `facetStart`)
 * along the ray at `theta`. A smooth circle of the wall's radius bulges
 * outside every flat facet between its vertices, so a line drawn on the
 * circle hides behind the facet and reads as a dashed ring.
 */
export function facetedRadiusAt(radius: number, theta: number, facetStart: number, facetStep: number): number {
  if (!(facetStep > 1e-6)) return radius;
  const k = Math.floor((theta - facetStart) / facetStep);
  const mid = facetStart + (k + 0.5) * facetStep;
  return (radius * Math.cos(facetStep / 2)) / Math.cos(theta - mid);
}

/**
 * LineSegments positions for the interior rings: one polyline per height
 * on `arc`, following the faceted liner (vertices every `facetStep` from
 * `facetStart`) at `radius`, so each ring lies flat on the facets instead of
 * dipping behind them.
 */
export function interiorRingSegments(
  radius: number,
  heights: readonly number[],
  arc: { start: number; len: number },
  facetStart: number,
  facetStep: number,
): Float32Array {
  // Break points: the arc ends plus every facet vertex strictly inside the arc.
  const thetas = [arc.start];
  if (facetStep > 1e-6) {
    const first = Math.floor((arc.start - facetStart) / facetStep) + 1;
    for (let k = first; ; k++) {
      const th = facetStart + k * facetStep;
      if (th >= arc.start + arc.len - 1e-9) break;
      thetas.push(th);
    }
  } else {
    for (let i = 1; i < 32; i++) thetas.push(arc.start + (arc.len * i) / 32);
  }
  thetas.push(arc.start + arc.len);
  const pts: number[] = [];
  const at = (th: number, y: number): [number, number, number] => {
    const r = facetedRadiusAt(radius, th, facetStart, facetStep);
    return [r * Math.sin(th), y, r * Math.cos(th)];
  };
  for (const y of heights) {
    for (let i = 0; i < thetas.length - 1; i++) {
      pts.push(...at(thetas[i], y), ...at(thetas[i + 1], y));
    }
  }
  return new Float32Array(pts);
}

/**
 * Vertical facet lines on the inner back wall (reference.jpg's interiors
 * show the liner's panel seams through the window): one line per `step`-th
 * liner vertex strictly inside `arc`, from `y0` to `y1`. Vertices sit on
 * the facet corners, so the lines lie on the liner (radius = `radius`).
 */
export function interiorMeridianSegments(
  radius: number,
  y0: number,
  y1: number,
  arc: { start: number; len: number },
  facetStart: number,
  facetStep: number,
  step = 1,
): Float32Array {
  if (!(facetStep > 1e-6) || !(y1 - y0 > 1e-6)) return new Float32Array(0);
  const pts: number[] = [];
  const first = Math.floor((arc.start - facetStart) / facetStep) + 1;
  const every = Math.max(1, Math.round(step));
  for (let k = first; ; k++) {
    const th = facetStart + k * facetStep;
    if (th >= arc.start + arc.len - 1e-9) break;
    if ((k - first) % every !== 0) continue;
    const x = radius * Math.sin(th);
    const z = radius * Math.cos(th);
    pts.push(x, y0, z, x, y1, z);
  }
  return new Float32Array(pts);
}

/** Interior rims / hoops plus the facet seams between the first and last height, as one line set. */
export function interiorLineSegments(
  radius: number,
  heights: number[],
  arc: { start: number; len: number },
  facetStart: number,
  facetStep: number,
  meridianStep: number,
): Float32Array {
  const rings = interiorRingSegments(radius, heights, arc, facetStart, facetStep);
  const seams =
    meridianStep > 0 && heights.length >= 2
      ? interiorMeridianSegments(radius, heights[0], heights[heights.length - 1], arc, facetStart, facetStep, meridianStep)
      : new Float32Array(0);
  const out = new Float32Array(rings.length + seams.length);
  out.set(rings, 0);
  out.set(seams, rings.length);
  return out;
}

/**
 * Latitude rings on the liquid flask's bowl: a full circle at each interior
 * lathe-profile point below `yMax` (the bowl equator or the waterline,
 * whichever is lower), every `step`-th point. With the flask meridians these
 * are the radial + ring lines reference.jpg shows on the liquid bottom.
 */
export function bowlLatitudeRings(
  profile: Array<[number, number]>,
  yMax: number,
  step = 1,
  segments = 48,
): Float32Array {
  const parts: Float32Array[] = [];
  const every = Math.max(1, Math.round(step));
  // Skip the pole (radius 0) and the closing waterline point (also radius 0).
  const inner = profile.filter(([r, y]) => r > 1e-4 && y < yMax - 1e-6);
  inner.forEach(([r, y], i) => {
    if (i % every === every - 1) parts.push(cylinderArcSegments(r, y, 0, Math.PI * 2, segments));
  });
  const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** The bowl part of a flask lathe profile (pole up to `yMax`), for the bowl meridians. */
export function bowlProfile(profile: Array<[number, number]>, yMax: number): Array<[number, number]> {
  return profile.filter(([r, y], i) => y <= yMax + 1e-6 && !(i > 0 && r < 1e-6));
}

/** Inner flask is a closed body of revolution (Arcentry bottle), not a
 * window pie. Window-sliced fill read as a cyan cutaway face. Waterline
 * is a flat disc — a bowl-height hemispherical cap (tick 96) ate holding
 * fill 0.21 into a ball and domed the mixer vs r-mixer's ellipse.
 */
export const LIQUID_THETA_LENGTH = Math.PI * 2;

/** Bowl equator → liquidTop. Do not subtract bowlHeight for a top cap. */
export function liquidCylinderHeight(liquidTop: number, bowlOriginY: number): number {
  return Math.max(0, liquidTop - bowlOriginY);
}

/**
 * Mixer flask radius / vessel radius. 0.72 left white margins either side
 * of the liquid; reference.jpg's mixer liquid fills the window. 0.9 since
 * round 2 (fidelity 0.2022 -> 0.2047). Tanks use TANK_INNER_RATIO.
 */
export const MIXER_INNER_RATIO = 0.9;

/** Three pitched blades, like the reference propeller (two read as a plus, four as a star). */
export const MIXER_IMPELLER_BLADES = 3;

/** 0 yaw put a blade along +X. r-mixer shows a blade across the window (~30°). */
export const MIXER_IMPELLER_YAW = Math.PI / 6;

/**
 * Blade size knob (`impellerRadius`): the blade chord is 3.5x and the blade
 * thickness 0.4x this. 0.042 read as a fat star when blades were round bars.
 */
export const MIXER_IMPELLER_RADIUS = 0.03;

/**
 * Blade pitch about the blade's own long axis (radians). Flat (0) blades read
 * as a stray horizontal star; reference.jpg's blades are tilted paddles.
 */
export const MIXER_BLADE_PITCH = Math.PI / 5;

/**
 * Tip-to-tip impeller span (world units) for the radius-1 mixer: about half
 * the flask diameter (inner 0.72 -> 1.44), like reference.jpg. Batch 3's
 * 0.36 read as a tiny star once the bars became blades; 0.45..1.5 were for
 * the old through-centre bars.
 */
export const MIXER_IMPELLER_SPAN = 0.7;

/**
 * Hub + blade sizes. The hub is a short cylinder ~2.2x the shaft radius;
 * each blade starts inside the hub (overlap) so blades, hub and shaft read
 * as one connected part, and the tip-to-tip span stays `span`.
 */
export function mixerImpellerBladeLayout(span: number, shaftRadius: number, bladeSize = MIXER_IMPELLER_RADIUS) {
  const hubR = Math.max(0.035, shaftRadius * 2.2);
  const hubH = Math.max(0.05, hubR * 1.4);
  const inner = hubR * 0.6;
  const bladeLen = Math.max(0.04, span / 2 - inner);
  return {
    hubR,
    hubH,
    bladeLen,
    /** Blade centre distance from the shaft axis. */
    radial: inner + bladeLen / 2,
    chord: bladeSize * 3.5,
    thickness: Math.max(0.006, bladeSize * 0.4),
  };
}

/** 0.055 was fatter than the blades vs r-mixer's needle shaft. */
export const MIXER_SHAFT_RADIUS = 0.032;

/** 8-gon shaft faceted vs r-mixer round needle at frozen 0.032 radius. */
export const MIXER_SHAFT_SIDES = 16;

/** 0.18 neck read as a chimney vs r-mixer's squat 8-gon on the dome apex. */
export const MIXER_CAP_HEIGHT_RATIO = 0.1;

/** 3 extra hoops dualled vs r-mixer's quieter bottle (lathe meridians stay). */
export const MIXER_BODY_RINGS = 0;

/** 0.5 hat read wide vs r-mixer's smaller 8-gon on the dome. */
export const MIXER_CAP_RADIUS_RATIO = 0.4;

/** MIXER_DEFAULTS 0.025 sat taller than the r-mixer squat puck (tank default is 0.02). */
export const MIXER_CAP_LID_THICKNESS = 0.02;

/**
 * Dome apex -> impeller hub, as a fraction of tank height. 0.77 measured
 * lid -> blades under the old fill-dependent impeller; with the hub now
 * fixed near the floor, 0.9 puts it ~0.2 H above the floor in the radius-1
 * mixer (2.7) and mash tun, i.e. low in the flask like reference.jpg.
 * MIXER_IMPELLER_FLOOR_CLEARANCE stops longer values from reaching the heel.
 */
export const MIXER_SHAFT_LENGTH = 0.9;

/** 24 segs made flask/wall meridians denser than r-mixer even at step 3. */
export const MIXER_RADIAL_SEGMENTS = 15;

/** depthTest false punched the 3-blade star through the bottle wall vs the r-mixer in-window agitator. */
export const MIXER_AGITATOR_DEPTH_TEST = true;

/**
 * Shaft colour. #5a5e62 punched a dark needle; #666 vanished under the
 * 0.84 liquid (Des 2026-10-29: "shaft stops short of the impeller"). A mid
 * grey reads both against the white liner and through the liquid.
 */
export const MIXER_AGITATOR_COLOR = '#8c9196';

/** Hub + blades: light grey with outline edges, like the reference propeller. */
export const MIXER_IMPELLER_COLOR = '#c9cdd1';

/** Mixer keep-arc must show a right-hand bottle wall. Tank window 91° ate
 *  the +X silhouette so s-mixer read as a cutaway cylinder vs r-mixer's bottle. */
export const MIXER_WINDOW_DEG = 100; // = MIXER_GLB.windowDeg: agitated vessels are mixer.glb since 2026-10-30 (was 70 procedural)

/** Inherited 45 opened the cut a tad toward +X vs r-mixer keep-arc on the
 *  right-hand bottle wall. Tanks stay TANK_WINDOW_YAW 45. */
export const MIXER_WINDOW_YAW = 45; // = MIXER_GLB.windowYawDeg (was 40 procedural); routing clips pipes on this cutout

/** Mixer body tapers into the dome. A silo (ratio 0) read as cylinder+hemisphere
 *  vs r-mixer's bottle shoulders. */
export const MIXER_SHOULDER_RATIO = 0.18;
export const MIXER_SHOULDER_TOP = 0.82;

/**
 * Cosine ease for mixer shoulders. A linear frustum (cone) read as a
 * piecewise bottle vs r-mixer's smooth lathe. Ease keeps vertical
 * tangents at both ends (cylinder and dome equator).
 */
export function bottleShoulderEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return (1 - Math.cos(Math.PI * x)) / 2;
}

export function bottleShoulderPoints(
  rBottom: number,
  rTop: number,
  y0: number,
  y1: number,
  stacks: number,
): Array<[number, number]> {
  const n = Math.max(2, Math.round(stacks));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = rBottom + (rTop - rBottom) * bottleShoulderEase(t);
    pts.push([r, y0 + (y1 - y0) * t]);
  }
  return pts;
}

/**
 * Mixer wall + cosine shoulder + dome in tank Y. Heel stays a 360° sphere
 * (windowing the U cut the bottle). One lathe so wall/shoulder/lid are not
 * three meshes vs r-mixer's bottle. Caller must pass yWall0 below the heel
 * equator (heelOl) — tick 113 started on the equator and the join rang again.
 */
export function mixerUpperPoints(
  tankR: number,
  topR: number,
  yWall0: number,
  yShoulder0: number,
  yShoulder1: number,
  yDomeOrigin: number,
  domeR: number,
  domeScaleY: number,
  domePhi: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const push = (x: number, y: number) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(last[1] - y) < 1e-6) {
      return;
    }
    pts.push([x, y]);
  };
  if (tankR > 1e-6) {
    push(tankR, yWall0);
    push(tankR, yShoulder0);
  }
  for (const [r, y] of bottleShoulderPoints(tankR, topR, yShoulder0, yShoulder1, 8)) {
    push(r, y);
  }
  if (domeR > 1e-4 && domePhi > 1e-4) {
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const phi = domePhi * (1 - i / n);
      push(domeR * Math.sin(phi), yDomeOrigin + domeScaleY * domeR * Math.cos(phi));
    }
  }
  return pts;
}

/** Mixer outer heel. A flat cylinder floor read as a can vs r-mixer's bottle U. */
export const MIXER_OUTER_BOWL = 0.28;

/** Pull the straight wall down over the heel equator. The cage arc at the
 *  join read as a seam vs r-mixer's smooth U. */
export const MIXER_HEEL_OVERLAP = 0.06;

export function heelOverlap(bowlH: number, overlap = MIXER_HEEL_OVERLAP): number {
  if (bowlH <= 1e-4) {
    return 0;
  }
  return Math.min(overlap, bowlH * 0.35);
}

/** Pull the straight wall up over the frustum join. The cage arc at wallH/2
 *  read as a waist seam vs r-mixer's smooth shoulder. */
export const MIXER_SHOULDER_OVERLAP = 0.05;

export function shoulderOverlap(shoulderH: number, overlap = MIXER_SHOULDER_OVERLAP): number {
  if (shoulderH <= 1e-4) {
    return 0;
  }
  return Math.min(overlap, shoulderH * 0.35);
}

/** Frustum meridians stop short of the dome equator. The cage arc at
 *  shoulderH/2 read as a lid seam vs r-mixer's smooth shoulder. */
export const MIXER_DOME_OVERLAP = 0.04;

/**
 * Mixer inner U uses the outer heel height so the flask matches the bottle.
 * Tank `bowlHeight`/`bowlYOffset` is a squat dish (0.24 / −0.2) that sat
 * on the floor vs r-mixer's inset bottle.
 */
export function flaskBowl(
  y0: number,
  innerR: number,
  outerBowlH: number,
  bowlHeight: number,
  bowlYOffset: number,
): { originY: number; bowlH: number; scaleY: number } {
  const bowlH = outerBowlH > 1e-4 ? outerBowlH : bowlHeight;
  const originY = outerBowlH > 1e-4 ? y0 + bowlH : y0 + bowlHeight + bowlYOffset;
  return { originY, bowlH, scaleY: innerR > 1e-6 ? bowlH / innerR : 1 };
}

/**
 * One lathe for the inner flask. Bowl sphere + cylinder were two open
 * rims at the equator — that join read as a ring vs r-holdbody's bottle.
 * Profile: south-pole → bowl (to equator or liquidTop) → wall → axis cap.
 */
export function flaskLathePoints(
  inner: number,
  bowlH: number,
  originY: number,
  liquidTop: number,
  stacks: number,
): Array<[number, number]> {
  const poleY = originY - bowlH;
  if (liquidTop <= poleY + 1e-6 || inner < 1e-6 || bowlH < 1e-6) {
    return [];
  }
  const n = Math.max(2, Math.round(stacks));
  const pts: Array<[number, number]> = [];
  const push = (x: number, y: number) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-6 && Math.abs(last[1] - y) < 1e-6) {
      return;
    }
    pts.push([x, y]);
  };
  const yBowlTop = Math.min(originY, liquidTop);
  const cosEnd = Math.min(1, Math.max(-1, (yBowlTop - originY) / bowlH));
  const thEnd = Math.acos(cosEnd);
  const th0 = Math.PI;
  for (let i = 0; i <= n; i++) {
    const th = th0 + ((thEnd - th0) * i) / n;
    push(inner * Math.sin(th), originY + bowlH * Math.cos(th));
  }
  if (liquidTop > originY + 1e-6) {
    push(inner, liquidTop);
  }
  push(0, liquidTop);
  return pts;
}

/** Meridians along the flask wall (skip the waterline radius that closes the lathe). */
export function flaskMeridianSegments(profile: Array<[number, number]>, thetas: number[]): Float32Array {
  const wall =
    profile.length > 0 && profile[profile.length - 1][0] < 1e-6 ? profile.slice(0, -1) : profile;
  const pts: number[] = [];
  for (const th of thetas) {
    const s = Math.sin(th);
    const c = Math.cos(th);
    for (let i = 0; i < wall.length - 1; i++) {
      const [r0, y0] = wall[i];
      const [r1, y1] = wall[i + 1];
      pts.push(r0 * s, y0, r0 * c, r1 * s, y1, r1 * c);
    }
  }
  return new Float32Array(pts);
}

export function bodyShoulder(
  bodyH: number,
  tankR: number,
  p: Pick<TankParams, 'shoulderRatio' | 'shoulderTopRatio'>,
): { shoulderH: number; cylH: number; topR: number } {
  const ratio = Math.min(0.45, Math.max(0, p.shoulderRatio));
  const shoulderH = bodyH * ratio;
  const topR = tankR * Math.min(1, Math.max(0.45, p.shoulderTopRatio));
  return { shoulderH, cylH: Math.max(0, bodyH - shoulderH), topR };
}

/**
 * Height of a rounded outer heel (half-ellipsoid, radius `radius`, depth
 * `bowlH`, pole at `y0`) at distance `r` from the axis: where a leg under the
 * heel has to stop so it meets the shell instead of floating below it.
 */
export function heelSurfaceY(y0: number, radius: number, bowlH: number, r: number): number {
  if (!(bowlH > 1e-6) || !(radius > 1e-6)) return y0;
  const t = Math.min(1, Math.max(0, r / radius));
  return y0 + bowlH * (1 - Math.sqrt(1 - t * t));
}

/** Lift the straight wall by `bowlH` so an outer hemisphere can sit under it. */
export function bodyOuterBowl(
  straightCylH: number,
  outerBowlHeight: number,
): { bowlH: number; cylH: number } {
  const bowlH = Math.min(Math.max(0, outerBowlHeight), straightCylH * 0.4);
  return { bowlH, cylH: Math.max(0, straightCylH - bowlH) };
}

/** Unlined fill in the window — a 15-gon’s front edges read as cage lines. */
export function windowFillSegments(radialSegments: number): number {
  return Math.max(32, Math.round(radialSegments) * 2);
}

/**
 * Inner cage lives in the ullage only. Meridians through the liquid
 * showed as verticals in the cyan cutout.
 */
export function innerCageSpan(
  y0: number,
  bodyTop: number,
  liquidTop: number,
): { y0: number; y1: number } | null {
  const bottom = Math.max(y0, liquidTop);
  if (bodyTop - bottom < 1e-4) {
    return null;
  }
  return { y0: bottom, y1: bodyTop };
}

/** Mixer outer wall meridians. Step 2 on 24 segs read dense vs r-mixer. */
// Round 2 (2026-10-29): 1. Step 3 left at most one meridian on each visible jamb strip, so the bottle read as
// a smooth grey blob vs reference.jpg's faceted panels (4-5 seams per side).
export const MIXER_WALL_MERIDIAN_STEP = 1;

/**
 * Tank outer-wall meridians (the cage on the kept arc): every facet, like
 * reference.jpg's panelled walls. Was FLASK_MERIDIAN_STEP (3).
 */
export const TANK_WALL_MERIDIAN_STEP = 1;

/**
 * Dome meridians: every facet. Round 3 used every 2nd; reference.jpg's
 * domes show a meridian per facet converging on the apex (holding / A / B).
 */
export const TANK_DOME_MERIDIAN_STEP = 1;

/**
 * Liquid bowl radial lines: every facet, like the reference's liquid bottom
 * (a radial per facet + rings). Seen through the liquid, so they read
 * tinted, not as a cage.
 */
export const TANK_BOWL_MERIDIAN_STEP = 1;

/** Inner flask meridians. Step 2 (every second of 15) read dense vs r-holdbody. */
export const FLASK_MERIDIAN_STEP = 3;

/** Even indices around a closed loop (0, 2, …). */
export function everyNthMeridian(segCount: number, step = 2): number[] {
  const n = Math.max(2, Math.round(segCount));
  const s = Math.max(2, Math.round(step));
  const out: number[] = [];
  for (let i = 0; i < n; i += s) {
    out.push(i);
  }
  return out;
}

export function everySecondMeridian(segCount: number): number[] {
  return everyNthMeridian(segCount, 2);
}

function wrapTau(theta: number): number {
  const tau = Math.PI * 2;
  return ((theta % tau) + tau) % tau;
}

export function angleOnArc(theta: number, start: number, len: number): boolean {
  return wrapTau(theta - start) <= len + 1e-6;
}

export function cylinderThetasEven(
  segs: number,
  thetaStart: number,
  thetaLength: number,
  closed: boolean,
  step = 2,
): number[] {
  const ths: number[] = [];
  const seen = new Set<number>();
  const add = (t: number) => {
    const k = Math.round(wrapTau(t) * 1e5);
    if (seen.has(k)) {
      return;
    }
    seen.add(k);
    ths.push(t);
  };
  if (closed) {
    for (const i of everyNthMeridian(segs, step)) {
      add((Math.PI * 2 * i) / segs);
    }
  } else {
    add(thetaStart);
    add(thetaStart + thetaLength);
    for (const i of everyNthMeridian(segs, step)) {
      const th = (Math.PI * 2 * i) / segs;
      if (angleOnArc(th, thetaStart, thetaLength)) {
        add(th);
      }
    }
  }
  return ths;
}

/**
 * Jambs plus even meridians inset from the window. Even meridians within
 * half a step of a jamb still read as being in the cutout in iso.
 */
/**
 * Thetas of the kept-arc FACET corners: keepStart + k * keepLen / segs (the
 * vertices of a `CylinderGeometry` / `LatheGeometry` cut on that arc), every
 * `step`-th, always including both jambs. Lines on these sit on the mesh's
 * facet edges and meet the kept-arc rims at their vertices.
 * `cylinderThetasKept` uses the world 2 pi / segs grid instead, which is not
 * the windowed mesh's grid: its meridians crossed facets mid-face and missed
 * the rim vertices (line-termination.test.ts, 2026-10-30).
 */
export function facetThetasKept(segs: number, keepStart: number, keepLen: number, step = 1): number[] {
  const n = Math.max(1, Math.round(segs));
  const every = Math.max(1, Math.round(step));
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    if (k === 0 || k === n || k % every === 0) out.push(keepStart + (k * keepLen) / n);
  }
  return out;
}

/** Meridians along a full lathe profile (e.g. a dish rim -> pole), keeping the axis point (unlike flaskMeridianSegments). */
export function profileMeridianSegments(profile: Array<[number, number]>, thetas: number[]): Float32Array {
  const pts: number[] = [];
  for (const th of thetas) {
    const s = Math.sin(th);
    const c = Math.cos(th);
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      pts.push(r0 * s, y0, r0 * c, r1 * s, y1, r1 * c);
    }
  }
  return new Float32Array(pts);
}

export function cylinderThetasKept(
  segs: number,
  keepStart: number,
  keepLen: number,
  step = 2,
): number[] {
  const inset = Math.PI / Math.max(3, segs);
  const innerStart = keepStart + inset;
  const innerLen = keepLen - 2 * inset;
  const ths: number[] = [];
  const seen = new Set<number>();
  const add = (t: number) => {
    const k = Math.round(wrapTau(t) * 1e5);
    if (seen.has(k)) {
      return;
    }
    seen.add(k);
    ths.push(t);
  };
  add(keepStart);
  add(keepStart + keepLen);
  if (innerLen > 1e-4) {
    for (const i of everyNthMeridian(segs, step)) {
      const th = (Math.PI * 2 * i) / segs;
      if (angleOnArc(th, innerStart, innerLen)) {
        add(th);
      }
    }
  }
  return ths;
}

function pushSpherePolyline(
  pts: number[],
  radius: number,
  phi: number,
  polarStart: number,
  polarLength: number,
  steps: number,
) {
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let s = 0; s <= steps; s++) {
    const polar = polarStart + (polarLength * s) / steps;
    const st = Math.sin(polar);
    const x = -radius * Math.cos(phi) * st;
    const y = radius * Math.cos(polar);
    const z = radius * Math.sin(phi) * st;
    if (s > 0) {
      pts.push(px, py, pz, x, y, z);
    }
    px = x;
    py = y;
    pz = z;
  }
}

export function sphereMeridiansFromCylinderThetas(
  radius: number,
  cylinderThetas: number[],
  polarStart: number,
  polarLength: number,
  stacks: number,
): Float32Array {
  const steps = Math.max(2, Math.round(stacks));
  const pts: number[] = [];
  for (const th of cylinderThetas) {
    pushSpherePolyline(pts, radius, spherePhiFromCylinderTheta(th), polarStart, polarLength, steps);
  }
  return new Float32Array(pts);
}

export function sphereLatitudeArcs(
  radius: number,
  phiStart: number,
  phiLength: number,
  polarAngles: number[],
  steps: number,
): Float32Array {
  const pts: number[] = [];
  const n = Math.max(4, steps);
  for (const polar of polarAngles) {
    const st = Math.sin(polar);
    const y = radius * Math.cos(polar);
    for (let i = 0; i < n; i++) {
      const p0 = phiStart + (phiLength * i) / n;
      const p1 = phiStart + (phiLength * (i + 1)) / n;
      pts.push(
        -radius * Math.cos(p0) * st,
        y,
        radius * Math.sin(p0) * st,
        -radius * Math.cos(p1) * st,
        y,
        radius * Math.sin(p1) * st,
      );
    }
  }
  return new Float32Array(pts);
}

function pushCylinderMeridian(pts: number[], radius: number, y0: number, y1: number, theta: number) {
  const x = radius * Math.sin(theta);
  const z = radius * Math.cos(theta);
  pts.push(x, y0, z, x, y1, z);
}

export function frustumMeridianSegments(
  rBottom: number,
  rTop: number,
  y0: number,
  y1: number,
  thetaStart: number,
  thetaLength: number,
  segs: number,
  closed: boolean,
): Float32Array {
  const pts: number[] = [];
  const thetas = closed
    ? cylinderThetasEven(segs, thetaStart, thetaLength, true)
    : cylinderThetasKept(segs, thetaStart, thetaLength);
  for (const th of thetas) {
    const s = Math.sin(th);
    const c = Math.cos(th);
    pts.push(rBottom * s, y0, rBottom * c, rTop * s, y1, rTop * c);
  }
  return new Float32Array(pts);
}

export function cylinderMeridianSegments(
  radius: number,
  y0: number,
  y1: number,
  thetaStart: number,
  thetaLength: number,
  segs: number,
  closed: boolean,
  // Default 2. Tank/ullage pass FLASK_MERIDIAN_STEP so the neck is not denser than the U.
  step = 2,
): Float32Array {
  const pts: number[] = [];
  const thetas = closed
    ? cylinderThetasEven(segs, thetaStart, thetaLength, true, step)
    : cylinderThetasKept(segs, thetaStart, thetaLength, step);
  for (const th of thetas) {
    pushCylinderMeridian(pts, radius, y0, y1, th);
  }
  return new Float32Array(pts);
}

export function cylinderArcSegments(
  radius: number,
  y: number,
  thetaStart: number,
  thetaLength: number,
  segs: number,
): Float32Array {
  const pts = new Float32Array(segs * 6);
  let o = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = thetaStart + (thetaLength * i) / segs;
    const t1 = thetaStart + (thetaLength * (i + 1)) / segs;
    pts[o++] = radius * Math.sin(t0);
    pts[o++] = y;
    pts[o++] = radius * Math.cos(t0);
    pts[o++] = radius * Math.sin(t1);
    pts[o++] = y;
    pts[o++] = radius * Math.cos(t1);
  }
  return pts;
}

export function sphereMeridianSegments(
  radius: number,
  segs: number,
  thetaStart: number,
  thetaLength: number,
  stacks: number,
): Float32Array {
  const thetas = cylinderThetasEven(segs, 0, Math.PI * 2, true);
  const steps = Math.max(2, Math.round(stacks));
  const pts: number[] = [];
  for (const th of thetas) {
    pushSpherePolyline(pts, radius, spherePhiFromCylinderTheta(th), thetaStart, thetaLength, steps);
  }
  return new Float32Array(pts);
}

/**
 * Three.js counts radialSegments across thetaLength/phiLength, not 360°.
 * Scale the cut so cage, window, and dome share the same angular pitch.
 */
export function keptRadialSegments(full: number, keepLen: number): number {
  const n = Math.max(3, Math.round(full));
  return Math.max(2, Math.round((n * keepLen) / (Math.PI * 2)));
}

/**
 * Waterline radius in a scaled hemisphere bowl. Above the equator the
 * surface is the inner cylinder; below it, a smaller chord of the bowl.
 */
export function liquidSurfaceRadius(
  inner: number,
  bowlHeight: number,
  bowlYOffset: number,
  tankBottom: number,
  liquidTop: number,
): number {
  const originY = tankBottom + bowlHeight + bowlYOffset;
  const poleY = originY - bowlHeight;
  if (liquidTop >= originY - 1e-6) {
    return inner;
  }
  if (liquidTop <= poleY + 1e-6) {
    return 0.01;
  }
  const scaleY = bowlHeight / Math.max(inner, 1e-6);
  const localY = (liquidTop - originY) / scaleY;
  return Math.sqrt(Math.max(1e-6, inner * inner - localY * localY));
}

/** Sphere theta range (south hemisphere) filled up to liquidTop. Null if below the pole. */
export function bowlThetaForLiquid(
  inner: number,
  bowlHeight: number,
  bowlYOffset: number,
  tankBottom: number,
  liquidTop: number,
): { thetaStart: number; thetaLength: number } | null {
  const originY = tankBottom + bowlHeight + bowlYOffset;
  const poleY = originY - bowlHeight;
  if (liquidTop <= poleY + 1e-6) {
    return null;
  }
  if (liquidTop >= originY - 1e-6) {
    return { thetaStart: Math.PI / 2, thetaLength: Math.PI / 2 };
  }
  const scaleY = bowlHeight / Math.max(inner, 1e-6);
  const localY = (liquidTop - originY) / scaleY;
  const thetaStart = Math.acos(Math.min(1, Math.max(-1, localY / inner)));
  return { thetaStart, thetaLength: Math.PI - thetaStart };
}

/**
 * Round 3: the built-in Tank liquid used ONE flat unlit colour for bowl, wall and waterline, so a low fill
 * (the demo HLT at 17%) read as a translucent disc: no side/top contrast to say "volume". Reference tanks show
 * a solid liquid with a lighter free surface and a deeper-coloured bowl/wall. Pure so it can be unit-tested.
 * `surface` = colour lightened toward white by SURFACE_LIGHTEN; `side` = colour darkened by SIDE_DARKEN.
 */
export const LIQUID_SURFACE_LIGHTEN = 0.16;
export const LIQUID_SIDE_DARKEN = 0.12;
export function liquidShades(hex: string): { surface: string; side: string } {
  const c = new Color(hex);
  const surface = c.clone().lerp(new Color('#ffffff'), LIQUID_SURFACE_LIGHTEN);
  const side = c.clone().lerp(new Color('#000000'), LIQUID_SIDE_DARKEN);
  return { surface: `#${surface.getHexString()}`, side: `#${side.getHexString()}` };
}

/** Closed horizontal ring as LineSegments positions (x,y,z pairs), the dark waterline rim in the reference tanks. */
export function waterlineRing(radius: number, y: number, segments: number): Float32Array {
  const n = Math.max(3, Math.round(segments));
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    out.set([radius * Math.sin(a0), y, radius * Math.cos(a0), radius * Math.sin(a1), y, radius * Math.cos(a1)], i * 6);
  }
  return out;
}

/**
 * Where the inlet nozzle leaves the shell, in radians along the kept wall
 * from the window's camera-left jamb, and how far it leans from the wall
 * normal toward the tangent (away from the window). Round 2 (Des
 * 2026-10-29): "the diagonal stick reads worse than before" -- the long
 * grid-aligned tangent chord (offset 0.32, lean pi/2, buried 1 r) grazed the
 * wall as a thin sliver. A short stub, 0.6 rad onto the left wall (its
 * normal ~80° off the camera ray, so the stub points screen-left and its
 * flange ring is seen nearly edge-on) leaning 0.45 rad toward the tangent so
 * it still reads as a tangential inlet.
 * Earlier: 0.38 / +tangent / hex flange = round face on a long pipe that
 * read as a twisted flange.
 */
export const TANK_NOZZLE_JAMB_OFFSET = 0.6;
export const TANK_NOZZLE_LEAN = 0.45;
/** Visible stub length / tank radius (round 1 stick was 0.4 R). */
export const TANK_NOZZLE_LENGTH = 0.26;
/** Stub radius / tank radius. */
export const TANK_NOZZLE_RADIUS = 0.085;

/**
 * Pose of the inlet nozzle stub in the tank's local frame. The stub
 * geometry (`nozzleStubGeometry`, flange.ts) runs along local +Y from its
 * origin (the shell end) to the flanged free end; `quaternion` turns +Y onto
 * `axis`, so the flange ring is perpendicular to the stub by construction
 * (flange-orientation.test.ts). `position` is the shell end, buried inside
 * the faceted wall so no open end shows; `length` is the whole stub
 * (buried part + `visibleLength`).
 *
 * Why a quaternion instead of the old Euler pair (group yaw theta + mesh
 * roll pi/2 on X-axis cylinders): one rotation derived from the axis, with
 * nothing to get out of order. `Quaternion.setFromUnitVectors` is three.js'
 * shortest-arc rotation between two directions.
 */
export function tankNozzlePose(
  radius: number,
  theta: number,
  y: number,
  visibleLength: number,
  nozzleR: number,
  lean = TANK_NOZZLE_LEAN,
): {
  axis: [number, number, number];
  /** Shell end of the stub (the geometry's origin). */
  position: [number, number, number];
  quaternion: [number, number, number, number];
  /** Whole stub length: the buried part plus `visibleLength`. */
  length: number;
} {
  // Cylinder theta convention: point on the wall = (r sin θ, y, r cos θ); the outward normal is
  // (sin θ, 0, cos θ) and d/dθ (cos θ, 0, -sin θ) the tangent. Lean toward -tangent (away from the window).
  const normal = new Vector3(Math.sin(theta), 0, Math.cos(theta));
  const away = new Vector3(-Math.cos(theta), 0, Math.sin(theta));
  const axis = normal.clone().multiplyScalar(Math.cos(lean)).addScaledVector(away, Math.sin(lean)).normalize();
  // The shell is a polygon whose flat faces sit up to R (1 - cos(pi / n)) inside the circle (0.03 R covers
  // n >= 13); the tilted end disc reaches r sin(lean) further out. Start inside both.
  const startR = Math.max(0, radius * 0.97 - nozzleR * Math.sin(lean) - 0.01);
  const start = normal.clone().multiplyScalar(startR).setY(y);
  // Distance along the axis from the start to the circle of radius R (where the stub leaves the shell).
  const b = start.x * axis.x + start.z * axis.z;
  const c = start.x * start.x + start.z * start.z - radius * radius;
  const inside = -b + Math.sqrt(Math.max(0, b * b - c));
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
  return {
    axis: [axis.x, axis.y, axis.z],
    position: [start.x, start.y, start.z],
    quaternion: [q.x, q.y, q.z, q.w],
    length: inside + Math.max(0, visibleLength),
  };
}
