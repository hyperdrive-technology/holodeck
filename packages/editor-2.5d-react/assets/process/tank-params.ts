import { Color } from 'three';
import { HOLODECK_STYLE } from './style';

export type TankCap = 'dome' | 'flat';

/** Holding / ingredient flask. 0.9 filled the silo like a pie vs r-holdbody's inset U.
 *  0.8 / 0.76 were still a tad wide in o-holdbody after the lathe flask. */
export const TANK_INNER_RATIO = 0.74;

/** Holding flask U sits on the floor. −0.2 put the hemisphere equator at the
 *  tank bottom so fill 0.21 read as a ball vs r-holdbody's bottle. */
export const TANK_BOWL_Y_OFFSET = 0;

/** 4 dome stacks drew a latitude cage vs r-holdbody's sparse cap. */
export const TANK_DOME_HEIGHT_SEGMENTS = 3;

/** 1 extra hoop dualled vs r-holdbody's quieter silo. */
export const TANK_BODY_RINGS = 0;

/** Alias of `HOLODECK_STYLE.finishes.vessel.shadeMin` (style.ts has the why). */
export const TANK_SHADE_MIN = HOLODECK_STYLE.finishes.vessel.shadeMin;

/** Alias of `HOLODECK_STYLE.finishes.vessel.hubWhite`. */
export const TANK_HUB_WHITE = HOLODECK_STYLE.finishes.vessel.hubWhite;

/** Alias of `HOLODECK_STYLE.finishes.vessel.shadeMax`. */
export const TANK_SHADE_MAX = HOLODECK_STYLE.finishes.vessel.shadeMax;

/** Alias of `HOLODECK_STYLE.finishes.flask.shadeMin`. */
export const MIXER_SHADE_MIN = HOLODECK_STYLE.finishes.flask.shadeMin;

/** 0.69 let flask meridians print through the cyan vs r-mixer solid fill. Tanks keep TANK_LIQUID_OPACITY. */
export const MIXER_LIQUID_OPACITY = 0.84;

/** Tanks inherited liquidOpacity 0.69 so meridians printed through the fill vs r-holdbody solid U. Mixer stays 0.84. */
export const TANK_LIQUID_OPACITY = 0.88; // round 3: 0.78 -> 0.9, reference liquid is solid; wire lines draw over it anyway (separate LineBags)

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
  showBowl: boolean;
  showLiquid: boolean;
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
  showLiquid: true,
  shaftRadius: 0.04,
  shaftLength: 0.88,
  impellerSpan: 1.3,
  impellerRadius: 0.036,
  shoulderRatio: 0,
  shoulderTopRatio: 1,
  outerBowlHeight: 0,
};

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
 * Mixer hat on the dome apex. `capLidThickness` used to be a paper-thin
 * ring so the slider did nothing; lidH is a real cylinder now.
 * Arcentry’s agitator hat is a squat 8-gon, not a chimney — capHeightRatio
 * was sized for a flat tank lid, so only a slice of it becomes neck height.
 */
export function mixerHatLayout(tankH: number, p: TankParams) {
  const bodyTop = tankH / 2;
  const domeApex = bodyTop + p.domeYOffset + p.domeHeight;
  const neckH = Math.max(tankH * p.capHeightRatio * 0.22, 0.03);
  const lidH = Math.max(p.capLidThickness, 0.004);
  const capR = p.radius * p.capRadiusRatio;
  return {
    domeApex,
    neckH,
    lidH,
    capR,
    neckMidY: domeApex + neckH / 2,
    lidMidY: domeApex + neckH + lidH / 2,
    lidTop: domeApex + neckH + lidH,
  };
}

/**
 * 0.72 sat the star mid-flask; 0.50 was still above r-mixer heel sit.
 * Fraction of fill height from the heel; not MIXER_INNER_RATIO.
 */
export const MIXER_IMPELLER_Y_FACTOR = 0.38;

/**
 * `shaftLength` is a fraction of tank height. Mixer used to size the
 * shaft from lid→liquid and the tuner slider did nothing.
 *
 * Blades sit at fill × MIXER_IMPELLER_Y_FACTOR. Lowering that without
 * growing the shaft leaves a lid-blade gap, so visual shaftH is
 * max(slider, lid→blades). MIXER_SHAFT_LENGTH stays 0.77; the tuner
 * still lengthens past the blades (`long.shaftH === tankH * shaftLength`).
 */
export function mixerShaftLayout(tankH: number, fill: number, p: TankParams) {
  const hat = mixerHatLayout(tankH, p);
  const level = Math.min(1, Math.max(0.02, fill));
  const liquidY = -tankH / 2 + tankH * level * MIXER_IMPELLER_Y_FACTOR;
  const shaftHSlider = Math.max(0.2, tankH * p.shaftLength);
  const shaftTop = hat.lidTop;
  // More negative Y is lower. min() grows the shaft down to the blades
  // when the slider would stop short; a longer slider still wins.
  const shaftBot = Math.min(shaftTop - shaftHSlider, liquidY);
  const shaftH = shaftTop - shaftBot;
  return {
    ...hat,
    liquidY,
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

/** Mixer flask sits inset in the vessel; tanks use TANK_INNER_RATIO. */
export const MIXER_INNER_RATIO = 0.72;

/** Plus (2 crossed cylinders) dualled vs r-mixer's three blades in the window. */
export const MIXER_IMPELLER_BLADES = 3;

/** 0 yaw put a blade along +X. r-mixer shows a blade across the window (~30°). */
export const MIXER_IMPELLER_YAW = Math.PI / 6;

/** 0.042 read as a fat star vs r-mixer's thin blades. */
export const MIXER_IMPELLER_RADIUS = 0.03;

/** 6-gon bars still read as sausages vs r-mixer thin agitator (radius stays 0.03). */
export const MIXER_IMPELLER_SIDES = 4;

/** 0.45 still large vs r-mixer compact propeller; 0.55/0.70/1.0/1.5 were worse. Not MIXER_IMPELLER_Y_FACTOR. */
export const MIXER_IMPELLER_SPAN = 0.36;

/**
 * Through-center bars are one cylinder per blade, so 3 bars = 6 rays (a
 * star) vs r-mixer 3-blade propeller sitting on the shaft. Tip-to-tip
 * stays `span`; each bar starts at the shaft.
 */
export function mixerImpellerBladeLayout(span: number, shaftRadius: number) {
  const hub = Math.max(0.01, shaftRadius);
  const bladeLen = Math.max(0.04, span / 2 - hub);
  return { hub, bladeLen, radial: hub + bladeLen / 2 };
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

/** 0.95 ran the shaft through the impeller into the heel vs r-mixer lid-to-blade. */
export const MIXER_SHAFT_LENGTH = 0.77;

/** 24 segs made flask/wall meridians denser than r-mixer even at step 3. */
export const MIXER_RADIAL_SEGMENTS = 15;

/** Lid-top ring read as a dark washer vs r-mixer's solid 8-gon. Edges already stroke the lid. */
export const MIXER_HAT_LID_RING = false;

/** Identity 8-gon put a face toward the camera vs r-mixer's vertex-on. Half a facet. */
export const MIXER_HAT_YAW = Math.PI / 8;

/** depthTest false punched the 3-blade star through the bottle wall vs the r-mixer in-window agitator. */
export const MIXER_AGITATOR_DEPTH_TEST = true;

/** #5a5e62 punched a dark star vs the r-mixer needle sitting with the flask cage. */
export const MIXER_AGITATOR_COLOR = '#666666';

/** Mixer keep-arc must show a right-hand bottle wall. Tank window 91° ate
 *  the +X silhouette so s-mixer read as a cutaway cylinder vs r-mixer's bottle. */
export const MIXER_WINDOW_DEG = 70;

/** Inherited 45 opened the cut a tad toward +X vs r-mixer keep-arc on the
 *  right-hand bottle wall. Tanks stay TANK_WINDOW_YAW 45. */
export const MIXER_WINDOW_YAW = 40;

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
export const MIXER_WALL_MERIDIAN_STEP = 3;

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
