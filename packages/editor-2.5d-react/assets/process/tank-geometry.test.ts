import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TANK_PARAMS,
  angleOnArc,
  cylinderArcSegments,
  cylinderMeridianSegments,
  cylinderThetasKept,
  dishProfile,
  frustumMeridianSegments,
  frustumProfile,
  legPositions,
  heelSurfaceY,
  facetedRadiusAt,
  interiorRingArc,
  interiorRingHeights,
  interiorRingSegments,
  mergeTankParams,
  TANK_INTERIOR_HOOPS,
  MIXER_WINDOW_DEG,
  MIXER_WINDOW_YAW,
  segmentsInsideWindow,
  sphereLatitudeArcs,
  sphereMeridiansFromCylinderThetas,
  spherePhiFromCylinderTheta,
  tankLayout,
  tankWindow,
  vesselFootprint,
  vesselPorts,
  FLASK_MERIDIAN_STEP,
  TANK_WINDOW_DEG,
  TANK_WINDOW_YAW,
} from './tank-params';
import { TANK_PRESETS } from './tank-presets';

const win = tankWindow(TANK_WINDOW_DEG, TANK_WINDOW_YAW);

describe('cutout: outer outline geometry never enters the window arc', () => {
  it('wall meridians, top rim and dome lines are generated on the kept arc only', () => {
    const segs = DEFAULT_TANK_PARAMS.radialSegments;
    const wall = cylinderMeridianSegments(1, -1, 1, win.keepStart, win.keepLen, segs, false, FLASK_MERIDIAN_STEP);
    expect(wall.length).toBeGreaterThan(0);
    expect(segmentsInsideWindow(wall, win.windowStart, win.windowRad)).toBe(0);
    const rim = cylinderArcSegments(1, 1, win.keepStart, win.keepLen, segs);
    expect(segmentsInsideWindow(rim, win.windowStart, win.windowRad)).toBe(0);
    const dome = sphereMeridiansFromCylinderThetas(1, cylinderThetasKept(segs, win.keepStart, win.keepLen, 2), 0, 1.2, 3);
    expect(segmentsInsideWindow(dome, win.windowStart, win.windowRad)).toBe(0);
    const lat = sphereLatitudeArcs(1, spherePhiFromCylinderTheta(win.keepStart), win.keepLen, [0.4, 0.8], segs);
    expect(segmentsInsideWindow(lat, win.windowStart, win.windowRad)).toBe(0);
    const cone = frustumMeridianSegments(1, 0.3, 1, 1.3, win.keepStart, win.keepLen, segs, false);
    expect(segmentsInsideWindow(cone, win.windowStart, win.windowRad)).toBe(0);
  });

  it('a full-circle rim does enter the window (that is the floor outline the cutout needs)', () => {
    const rim = cylinderArcSegments(1, -1, 0, Math.PI * 2, 32);
    expect(segmentsInsideWindow(rim, win.windowStart, win.windowRad)).toBeGreaterThan(0);
  });

  it('the liner and liquid share the window definition: one tankWindow() call per tank', () => {
    // keepStart + keepLen wraps to the window start, so a lathe/cylinder cut on (keepStart, keepLen)
    // leaves exactly the arc (windowStart, windowRad) open.
    expect((win.keepStart + win.keepLen) % (Math.PI * 2)).toBeCloseTo(win.windowStart % (Math.PI * 2) + (win.windowStart < 0 ? Math.PI * 2 : 0));
    expect(win.keepLen + win.windowRad).toBeCloseTo(Math.PI * 2);
    expect(angleOnArc(TANK_WINDOW_YAW * (Math.PI / 180), win.windowStart, win.windowRad)).toBe(true);
  });

  it('inner mesh lines are off by default (they printed through the cutout)', () => {
    expect(DEFAULT_TANK_PARAMS.showBowl).toBe(false);
    expect(DEFAULT_TANK_PARAMS.showInnerCage).toBe(false);
    // Translucent since 2026-10-29 so the interior rings read through it; depthWrite stays on (Tank.tsx LiquidFill).
    expect(DEFAULT_TANK_PARAMS.liquidOpacity).toBeLessThan(1);
  });
});

describe('tankLayout', () => {
  it('flat bottom, no stand: floor is the shell floor; dome adds height on top', () => {
    const l = tankLayout(3, 1, mergeTankParams({ top: 'dome', bottom: 'flat', support: 'none' }));
    expect(l.y0).toBe(-1.5);
    expect(l.floorY).toBe(-1.5);
    expect(l.apexY).toBeCloseTo(1.5 + DEFAULT_TANK_PARAMS.domeHeight + DEFAULT_TANK_PARAMS.domeYOffset);
  });

  it('dish + legs lower the floor by the dish depth and the stand height', () => {
    const l = tankLayout(2, 1, mergeTankParams({ bottom: 'dish', dishBottomHeight: 0.12, support: 'legs', standHeight: 0.4 }));
    expect(l.bottomDepth).toBeCloseTo(0.12);
    expect(l.bottomY).toBeCloseTo(-1.12);
    expect(l.floorY).toBeCloseTo(-1.52);
  });

  it('cone bottom narrows to the outlet ratio; cone top to the lid ratio; flat top adds nothing', () => {
    const l = tankLayout(2, 0.5, mergeTankParams({ top: 'cone', bottom: 'cone', coneBottomRatio: 0.1, coneTopRatio: 0.3 }));
    expect(l.bottomR).toBeCloseTo(0.05);
    expect(l.topR).toBeCloseTo(0.15);
    expect(l.topHeight).toBeCloseTo(DEFAULT_TANK_PARAMS.coneTopHeight);
    expect(tankLayout(2, 1, mergeTankParams({ top: 'flat' })).topHeight).toBe(0);
  });

  it('a dish can never be deeper than the radius', () => {
    expect(tankLayout(2, 0.3, mergeTankParams({ bottom: 'dish', dishBottomHeight: 2 })).bottomDepth).toBeCloseTo(0.3);
  });
});

describe('profiles', () => {
  it('frustumProfile runs from (r0,y0) to (r1,y1)', () => {
    const pts = frustumProfile(1, 0, 0.2, -0.5, 2);
    expect(pts[0]).toEqual([1, 0]);
    expect(pts[pts.length - 1][0]).toBeCloseTo(0.2);
    expect(pts[pts.length - 1][1]).toBeCloseTo(-0.5);
    expect(pts).toHaveLength(3);
  });
  it('dishProfile starts on the rim and ends at the pole, depth below the rim', () => {
    const pts = dishProfile(1, -1, 0.2, 4);
    expect(pts[0][0]).toBeCloseTo(1);
    expect(pts[0][1]).toBeCloseTo(-1);
    expect(pts[pts.length - 1][0]).toBeCloseTo(0);
    expect(pts[pts.length - 1][1]).toBeCloseTo(-1.2);
    for (let i = 1; i < pts.length; i++) expect(pts[i][1]).toBeLessThanOrEqual(pts[i - 1][1] + 1e-9);
  });
  it('legPositions are evenly spaced inside the wall', () => {
    const legs = legPositions(1, 4);
    expect(legs).toHaveLength(4);
    for (const [x, z] of legs) expect(Math.hypot(x, z)).toBeLessThan(1);
  });
});

describe('vesselFootprint / vesselPorts follow the radius', () => {
  it('rounds the diameter up to whole cells', () => {
    expect(vesselFootprint(1)).toEqual({ w: 2, h: 2 });
    expect(vesselFootprint(0.65)).toEqual({ w: 2, h: 2 });
    expect(vesselFootprint(1.1)).toEqual({ w: 3, h: 3 });
    expect(vesselFootprint(0.4)).toEqual({ w: 1, h: 1 });
    expect(vesselFootprint(0)).toEqual({ w: 1, h: 1 });
  });
  it('ports sit on the footprint edge, east and west', () => {
    expect(vesselPorts(1)).toEqual({ east: { x: 1, y: 0, dir: 'e' }, west: { x: -1, y: 0, dir: 'w' } });
    expect(vesselPorts(1.4).east.x).toBe(1.5);
  });
});

describe('presets', () => {
  it('every preset has a positive size and a footprint that covers it', () => {
    for (const [id, p] of Object.entries(TANK_PRESETS)) {
      expect(p.radius, id).toBeGreaterThan(0);
      expect(p.height, id).toBeGreaterThan(0);
      expect(vesselFootprint(p.radius).w, id).toBeGreaterThanOrEqual(2 * p.radius - 1e-9);
    }
  });
  it('brewhouse presets keep the sizes the GLBs had (mash tun fills a 2x2, kettle ~0.63) and the HLT is 3 tall', () => {
    expect(TANK_PRESETS['mash-tun'].radius).toBeCloseTo(1, 1);
    expect(TANK_PRESETS.kettle.radius).toBeCloseTo(0.65, 1);
    expect(TANK_PRESETS.hlt.height).toBe(3);
    expect(TANK_PRESETS.whirlpool.radius * 2).toBeGreaterThan(TANK_PRESETS.whirlpool.height);
  });
});

/**
 * Des 2026-10-29: the interior back wall's horizontal lines (bottom inner rim,
 * body hoops, top inner rim) must show through the cutaway, like reference.jpg.
 * This reverses the earlier "no lines inside the window" rule for the INNER
 * back wall only: the outer cage above still never enters the window arc.
 */
describe('interior back-wall rings (seen through the window)', () => {
  const thetaOf = (x: number, z: number) => Math.atan2(x, z);
  const segs = 15;
  const facetStep = win.keepLen / segs;

  it('ring heights are the bottom rim, the hoops and the top rim, bottom to top', () => {
    const hs = interiorRingHeights(-1, 1, 2);
    expect(hs).toHaveLength(4);
    [-1, -1 / 3, 1 / 3, 1].forEach((h, i) => expect(hs[i]).toBeCloseTo(h));
    expect(interiorRingHeights(-1, 1, 0)).toEqual([-1, 1]);
    expect(interiorRingHeights(1, 1, 2)).toEqual([]);
    expect(TANK_INTERIOR_HOOPS).toBeGreaterThan(0);
    expect(DEFAULT_TANK_PARAMS.showInteriorRings).toBe(true);
    expect(DEFAULT_TANK_PARAMS.interiorHoops).toBe(TANK_INTERIOR_HOOPS);
  });

  it.each([
    ['tank', TANK_WINDOW_DEG, TANK_WINDOW_YAW],
    ['mixer', MIXER_WINDOW_DEG, MIXER_WINDOW_YAW],
  ])('%s: the ring arc is the back wall opposite the window', (_name, deg, yaw) => {
    const w = tankWindow(deg, yaw);
    const arc = interiorRingArc(deg, yaw);
    const mid = arc.start + arc.len / 2;
    // Centred half a turn from the window centre, at least as wide as the window.
    expect(Math.cos(mid - (w.windowStart + w.windowRad / 2))).toBeCloseTo(-1);
    expect(arc.len).toBeGreaterThanOrEqual(w.windowRad);
    expect(arc.len).toBeLessThan(w.windowRad + 0.5);
  });

  it('every ring segment is horizontal, on the back arc, and on the faceted liner', () => {
    const arc = interiorRingArc(TANK_WINDOW_DEG, TANK_WINDOW_YAW);
    const heights = interiorRingHeights(-1.5, 1.5, 2);
    const r = 0.99;
    const pts = interiorRingSegments(r, heights, arc, win.keepStart, facetStep);
    expect(pts.length % 6).toBe(0);
    const ys = new Set<number>();
    for (let i = 0; i < pts.length; i += 6) {
      // Horizontal: both ends at the same height.
      expect(pts[i + 1]).toBeCloseTo(pts[i + 4]);
      ys.add(Number(pts[i + 1].toFixed(4)));
      for (const o of [0, 3]) {
        const x = pts[i + o];
        const z = pts[i + o + 2];
        // atan2 wraps to (-pi, pi]; unwrap onto the arc so the facet index matches the generator's.
        let th = thetaOf(x, z);
        while (th < arc.start - 1e-6) th += Math.PI * 2;
        while (th > arc.start + Math.PI * 2) th -= Math.PI * 2;
        expect(angleOnArc(th, arc.start - 1e-4, arc.len + 2e-4)).toBe(true);
        // Never inside the window opening itself (that is the front, not the back wall).
        expect(angleOnArc(th, win.windowStart + 1e-3, win.windowRad - 2e-3)).toBe(false);
        // On the flat facet, not the circle: a circle bulges outside each facet and the
        // ring hid behind the liner as a dashed line (first render, 2026-10-29).
        expect(Math.hypot(x, z)).toBeCloseTo(facetedRadiusAt(r, th, win.keepStart, facetStep), 4);
      }
    }
    expect([...ys].sort((a, b) => a - b)).toEqual(heights.map((h) => Number(h.toFixed(4))));
  });

  it('facetedRadiusAt is the radius at facet vertices and the apothem mid-facet', () => {
    expect(facetedRadiusAt(1, 0, 0, 0.4)).toBeCloseTo(1);
    expect(facetedRadiusAt(1, 0.4, 0, 0.4)).toBeCloseTo(1);
    expect(facetedRadiusAt(1, 0.2, 0, 0.4)).toBeCloseTo(Math.cos(0.2));
    expect(facetedRadiusAt(1, 0.2, 0, 0)).toBe(1);
  });
});

describe('stand legs', () => {
  it('no leg stands under the cutaway centre (the iso camera axis, theta 45°)', () => {
    for (const [x, z] of legPositions(1, 4)) {
      const th = Math.atan2(x, z);
      expect(Math.abs(Math.cos(th - Math.PI / 4))).toBeLessThan(0.75);
    }
  });

  it('heelSurfaceY is the floor at the axis and rises toward the rim', () => {
    expect(heelSurfaceY(-1, 1, 0.3, 0)).toBeCloseTo(-1);
    expect(heelSurfaceY(-1, 1, 0.3, 1)).toBeCloseTo(-0.7);
    expect(heelSurfaceY(-1, 1, 0.3, 0.5)).toBeGreaterThan(-1);
    expect(heelSurfaceY(-1, 1, 0, 0.5)).toBe(-1);
  });
});
