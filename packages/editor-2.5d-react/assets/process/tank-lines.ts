/**
 * Every outline LINE (not mesh crease) a procedural `Tank` draws, as pure
 * data in the Tank's local frame (origin at the straight wall's mid-height).
 * `Tank.tsx` renders these arrays; `line-termination.test.ts` checks them
 * against Des's rule (2026-10-30): every vertical / meridian line must end on
 * a drawn horizontal ring, a window cut edge or the boundary -- never fade
 * into a dome or shoulder.
 *
 * How each family terminates:
 * - wall meridians (kept-arc facet vertices): bottom rim (full circle) and
 *   top rim (kept arc, same facet vertices);
 * - dome meridians: dome equator ring (the first latitude arc, kept-arc facet
 *   vertices) and the apex where they all meet;
 * - cone lid meridians: top rim and the lid's apex ring; cone bottom: bottom
 *   rim and outlet ring; dish bottom: bottom rim and the pole;
 * - interior seams: the interior bottom / top rims (InteriorLines);
 * - liquid bowl meridians: the waterline when the liquid is inside the bowl,
 *   else the bowl equator ring (added here) -- and the pole;
 * - flat-lid hatch: its Edges creases plus `hatchBase`, the ring where the
 *   open neck meets the lid (the neck's bottom boundary z-fought the lid, so
 *   its facet lines hung loose).
 *
 * The shoulder (mixer bottle) path is not covered: agitated vessels are
 * mixer.glb since 2026-10-30 and no preset uses a shoulder.
 */
import {
  type TankParams,
  type TankTop,
  bowlLatitudeRings,
  bowlProfile,
  cylinderArcSegments,
  cylinderThetasEven,
  facetThetasKept,
  profileMeridianSegments,
  dishProfile,
  flaskBowl,
  flaskLathePoints,
  flaskMeridianSegments,
  frustumMeridianSegments,
  interiorRingArc,
  interiorRingHeights,
  interiorLineSegments,
  INTERIOR_RING_INSET,
  LIQUID_THETA_LENGTH,
  sphereLatitudeArcs,
  sphereMeridiansFromCylinderThetas,
  spherePhiFromCylinderTheta,
  tankLayout,
  tankWindow,
  TANK_BOWL_MERIDIAN_STEP,
  TANK_DOME_MERIDIAN_STEP,
  TANK_WALL_MERIDIAN_STEP,
  bodyShoulder,
  bodyOuterBowl,
} from './tank-params';

/** Bottom rim segments: a fine circle so meridians at any theta end on it (chord sag < 0.0013 R). */
export const BOTTOM_RIM_SEGMENTS = 64;
/** Every 2nd bowl stack gets a latitude ring (16 stacks: rings would be a hatch). */
export const BOWL_RING_STEP = 2;

const empty = new Float32Array(0);

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** Apply `y' = oy + sy * y` to line positions (the dome group's position + Y scale). */
function liftScaleY(pts: Float32Array, oy: number, sy: number): Float32Array {
  const out = new Float32Array(pts);
  for (let i = 1; i < out.length; i += 3) out[i] = oy + sy * out[i];
  return out;
}

/** Liquid outline: waterline ring, bowl meridians + latitude rings (+ equator ring when submerged). */
export function liquidLines({
  inner,
  bowlH,
  originY,
  liquidTop,
  stacks,
  thetas,
  bowlLines,
}: {
  inner: number;
  bowlH: number;
  originY: number;
  liquidTop: number;
  stacks: number;
  thetas: number[];
  bowlLines: boolean;
}): { waterline: Float32Array; bowl: Float32Array; surfaceR: number } {
  const profile = flaskLathePoints(inner, bowlH, originY, liquidTop, stacks);
  // Radius of the waterline: the last non-axis profile point (inside the bowl it is < inner).
  const rim = [...profile].reverse().find(([r]) => r > 1e-6);
  const surfaceR = rim ? rim[0] : inner;
  const waterline = profile.length > 2 ? cylinderArcSegments(surfaceR, liquidTop, 0, Math.PI * 2, 48) : empty;
  if (!bowlLines || profile.length < 3) return { waterline, bowl: empty, surfaceR };
  const yMax = Math.min(originY, liquidTop);
  const parts = [flaskMeridianSegments(bowlProfile(profile, yMax), thetas), bowlLatitudeRings(profile, yMax, BOWL_RING_STEP)];
  // Submerged bowl: the meridians stop at the bowl equator, below the waterline -- ring them there.
  if (liquidTop > originY + 1e-6) parts.push(cylinderArcSegments(inner, originY, 0, Math.PI * 2, 48));
  return { waterline, bowl: concat(parts), surfaceR };
}

export type TankLinePlan = {
  wallMeridians: Float32Array;
  bottomRim: Float32Array;
  topRim: Float32Array;
  domeMeridians: Float32Array;
  domeRings: Float32Array;
  coneTop: Float32Array;
  bottom: Float32Array;
  interior: Float32Array;
  waterline: Float32Array;
  bowl: Float32Array;
  hatchBase: Float32Array;
};

/**
 * Hatch on a flat lid (TankFlatLid): neck radius / height, lid thickness and
 * `neckY0`, where the open neck starts above the lid body top (`lidT` plus a
 * small lift so its base ring does not z-fight the lid disc).
 */
export const HATCH_BASE_LIFT = 0.0015;
export function flatLidHatch(tankR: number, p: Pick<TankParams, 'height' | 'capHeightRatio' | 'capRadiusRatio' | 'capLidThickness'>) {
  const lidT = Math.max(p.capLidThickness, 0.004);
  return {
    capH: Math.max(0.02, p.height * p.capHeightRatio * 0.35),
    capR: tankR * p.capRadiusRatio * 0.6,
    lidT,
    /** Neck bottom, relative to the body top. */
    neckY0: lidT + HATCH_BASE_LIFT,
  };
}

/** All of a (non-agitated, non-shouldered) Tank's line sets for `p`, `top`, size and fill level. */
export function tankLinePlan(p: TankParams, top: TankTop, tankH: number, tankR: number, level: number): TankLinePlan {
  const layout = tankLayout(tankH, tankR, p);
  const { y0, bodyTop } = layout;
  const segs = Math.max(3, Math.round(p.radialSegments));
  const { keepStart, keepLen } = tankWindow(p.windowDeg, p.windowYawDeg);
  const liner = tankR * p.linerRatio;
  const inner = tankR * p.innerRatio;
  const plan: TankLinePlan = {
    wallMeridians: empty,
    bottomRim: empty,
    topRim: empty,
    domeMeridians: empty,
    domeRings: empty,
    coneTop: empty,
    bottom: empty,
    interior: empty,
    waterline: empty,
    bowl: empty,
    hatchBase: empty,
  };
  if (p.showCage) {
    const pts: number[] = [];
    for (const th of facetThetasKept(segs, keepStart, keepLen, TANK_WALL_MERIDIAN_STEP)) {
      pts.push(tankR * Math.sin(th), y0, tankR * Math.cos(th), tankR * Math.sin(th), bodyTop, tankR * Math.cos(th));
    }
    plan.wallMeridians = new Float32Array(pts);
    plan.bottomRim = cylinderArcSegments(tankR, y0, 0, Math.PI * 2, BOTTOM_RIM_SEGMENTS);
    plan.topRim = cylinderArcSegments(tankR, bodyTop, keepStart, keepLen, segs);
  }
  if (top === 'dome' && p.showDome) {
    const domePhi = (p.domePhiDeg * Math.PI) / 180;
    const domeSegs = Math.max(1, Math.round(p.domeHeightSegments));
    const domeCapH = tankR * p.domeRadiusScale * (1 - Math.cos(Math.min(Math.max(domePhi, 0), Math.PI)));
    const domeScaleY = domeCapH > 1e-6 ? p.domeHeight / domeCapH : 1;
    const domeR = tankR * p.domeRadiusScale;
    const oy = bodyTop + p.domeYOffset;
    const thetas = facetThetasKept(segs, keepStart, keepLen, TANK_DOME_MERIDIAN_STEP);
    plan.domeMeridians = liftScaleY(
      sphereMeridiansFromCylinderThetas(domeR, thetas, 0, Math.max(0.05, domePhi), domeSegs),
      oy,
      domeScaleY,
    );
    // Latitude arcs at every stack INCLUDING the equator (polar = domePhi): the meridians' lower ends.
    const polars = Array.from({ length: domeSegs + 1 }, (_, i) => (domePhi * i) / domeSegs).filter((a) => a > 1e-6);
    plan.domeRings = liftScaleY(sphereLatitudeArcs(domeR, spherePhiFromCylinderTheta(keepStart), keepLen, polars, segs), oy, domeScaleY);
  }
  if (top === 'cone') {
    plan.coneTop = concat([
      frustumMeridianSegments(tankR, layout.topR, bodyTop, layout.apexY, keepStart, keepLen, segs, false),
      cylinderArcSegments(layout.topR, layout.apexY, keepStart, keepLen, segs),
    ]);
  }
  if (top === 'flat') {
    const hatch = flatLidHatch(tankR, p);
    // Neck vertices are at theta 2 pi i / segs (CylinderGeometry thetaStart 0): same vertices, exact ends.
    plan.hatchBase = cylinderArcSegments(hatch.capR, bodyTop + hatch.neckY0, 0, Math.PI * 2, segs);
  }
  if (p.bottom === 'cone') {
    const thetas = cylinderThetasEven(segs, 0, Math.PI * 2, true, 3);
    const pts: number[] = [];
    for (const th of thetas) {
      pts.push(tankR * Math.sin(th), y0, tankR * Math.cos(th), layout.bottomR * Math.sin(th), layout.bottomY, layout.bottomR * Math.cos(th));
    }
    plan.bottom = concat([new Float32Array(pts), cylinderArcSegments(layout.bottomR, layout.bottomY, 0, Math.PI * 2, segs)]);
  } else if (p.bottom === 'dish') {
    // Rim -> pole, pole included (flaskMeridianSegments drops a closing axis point, which left the dish
    // meridians one stack short of the pole).
    plan.bottom = profileMeridianSegments(dishProfile(tankR, y0, layout.bottomDepth, 3), cylinderThetasEven(segs, 0, Math.PI * 2, true, 3));
  }
  if (p.showInteriorRings && p.showLiner) {
    const heights = interiorRingHeights(y0 + 0.004, bodyTop - 0.004, p.interiorHoops);
    if (heights.length) {
      const arc = interiorRingArc(p.windowDeg, p.windowYawDeg);
      const r = liner * INTERIOR_RING_INSET;
      const facetStep = keepLen / segs;
      plan.interior = interiorLineSegments(r, heights, arc, keepStart, facetStep, p.interiorMeridianStep);
    }
  }
  if (p.showLiquid) {
    const shoulder = bodyShoulder(tankH, tankR, p);
    const outer = bodyOuterBowl(shoulder.cylH, p.outerBowlHeight);
    const flask = flaskBowl(y0, inner, outer.bowlH, p.bowlHeight, p.bowlYOffset);
    const liquid = liquidLines({
      inner,
      bowlH: flask.bowlH,
      originY: flask.originY,
      liquidTop: y0 + tankH * Math.min(1, Math.max(0.02, level)),
      stacks: Math.max(4, Math.round(p.bowlHeightSegments) * 4),
      thetas: cylinderThetasEven(segs, 0, LIQUID_THETA_LENGTH, true, TANK_BOWL_MERIDIAN_STEP),
      bowlLines: p.showBowl,
    });
    plan.waterline = liquid.waterline;
    plan.bowl = liquid.bowl;
  }
  return plan;
}
