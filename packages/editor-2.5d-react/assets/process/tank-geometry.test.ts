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
  mergeTankParams,
  segmentsInsideWindow,
  sphereLatitudeArcs,
  sphereMeridiansFromCylinderThetas,
  spherePhiFromCylinderTheta,
  tankLayout,
  tankWindow,
  backWallThetas,
  visibleBackThetas,
  bowlProfile,
  flaskLathePoints,
  backWallRadius,
  cylinderMeridianSegmentsAt,
  TANK_LIQUID_OPACITY,
  vesselFootprint,
  vesselPorts,
  FLASK_MERIDIAN_STEP,
  TANK_WINDOW_DEG,
  TANK_WINDOW_YAW,
} from './tank-params';
import { TANK_PRESETS } from './tank-presets';

const win = tankWindow(TANK_WINDOW_DEG, TANK_WINDOW_YAW);

describe('cutout: outline geometry never enters the window arc', () => {
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
    expect(DEFAULT_TANK_PARAMS.liquidOpacity).toBe(TANK_LIQUID_OPACITY);
  });
});

describe('back-wall verticals seen through the window', () => {
  const segs = DEFAULT_TANK_PARAMS.radialSegments;
  const thetas = backWallThetas(segs, win.keepStart, win.keepLen);
  const wrap = (t: number) => ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  it('are centred directly opposite the window and one facet apart', () => {
    const opposite = wrap((TANK_WINDOW_YAW * Math.PI) / 180 + Math.PI);
    expect(thetas.length % 2).toBe(1);
    expect(wrap(thetas[(thetas.length - 1) / 2]!)).toBeCloseTo(opposite);
    for (let i = 1; i < thetas.length; i++) expect(thetas[i]! - thetas[i - 1]!).toBeCloseTo((Math.PI * 2) / segs);
  });

  it('stay inside the kept wall and within the window width, so each is visible through the opening', () => {
    expect(thetas.length).toBeGreaterThanOrEqual(3);
    for (const th of thetas) {
      expect(angleOnArc(th, win.keepStart, win.keepLen)).toBe(true);
      const opposite = (TANK_WINDOW_YAW * Math.PI) / 180 + Math.PI;
      expect(Math.abs(wrap(th - opposite + Math.PI) - Math.PI)).toBeLessThanOrEqual(win.windowRad / 2 + 1e-6);
    }
  });

  it('stay on the wall that is left when the cutout is wide, and vanish with it', () => {
    for (const deg of [91, 150, 210, 270, 330, 359, 360]) {
      const w = tankWindow(deg, TANK_WINDOW_YAW);
      const ths = backWallThetas(segs, w.keepStart, w.keepLen);
      if (deg === 360) expect(ths).toEqual([]);
      for (const th of ths) expect(angleOnArc(th, w.keepStart, w.keepLen), `${deg} deg cutout`).toBe(true);
    }
  });

  it('sit inside the liner prism at every supported segment count (the faces are nearer than the corners)', () => {
    const liner = 0.99;
    for (const n of [3, 5, 7, 12, 15, 24]) {
      const r = backWallRadius(liner, n);
      // Distance from the axis to the liner's flat face along any direction is >= its apothem.
      expect(r).toBeLessThan(liner * Math.cos(Math.PI / n));
      expect(r).toBeGreaterThan(liner * Math.cos(Math.PI / n) * 0.95);
      for (const th of backWallThetas(n, win.keepStart, win.keepLen)) {
        // Polygon radius in direction th (vertices at multiples of 2π/n).
        const local = ((th % ((Math.PI * 2) / n)) + (Math.PI * 2) / n) % ((Math.PI * 2) / n) - Math.PI / n;
        const faceR = (liner * Math.cos(Math.PI / n)) / Math.cos(local);
        expect(r).toBeLessThan(faceR);
      }
    }
  });

  it('build one vertical per angle at the given radius and height', () => {
    const pts = cylinderMeridianSegmentsAt(0.7, 0.1, 1.2, thetas);
    expect(pts.length).toBe(thetas.length * 6);
    for (let i = 0; i < thetas.length; i++) {
      const [x0, y0, z0, x1, y1, z1] = Array.from(pts.slice(i * 6, i * 6 + 6));
      expect(Math.hypot(x0!, z0!)).toBeCloseTo(0.7);
      expect([x1, z1]).toEqual([x0, z0]);
      expect([y0, y1]).toEqual([expect.closeTo(0.1), expect.closeTo(1.2)]);
    }
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

describe('one set of lines: dome meridians, back-wall verticals and liquid-bowl meridians', () => {
  const segs = DEFAULT_TANK_PARAMS.radialSegments;
  const dome = cylinderThetasKept(segs, win.keepStart, win.keepLen, 2);

  it('back-wall verticals are the dome angles seen through the window, nearest-first around the back', () => {
    const back = visibleBackThetas(dome, win.keepStart, win.keepLen);
    expect(back.length).toBeGreaterThanOrEqual(2);
    for (const th of back) {
      expect(dome).toContain(th);
      expect(angleOnArc(th, win.keepStart, win.keepLen)).toBe(true);
    }
    expect(visibleBackThetas(dome, 0, 0)).toEqual([]);
  });

  it('the bowl profile runs from the pole up to the ring and converges on the axis', () => {
    const profile = flaskLathePoints(0.7, 0.24, 0.24, 1.5, 8);
    const bowl = bowlProfile(profile, 0.24);
    expect(bowl[0]![0]).toBeCloseTo(0);
    expect(bowl[0]![1]).toBeCloseTo(0);
    expect(bowl[bowl.length - 1]![1]).toBeCloseTo(0.24);
    expect(bowl[bowl.length - 1]![0]).toBeCloseTo(0.7);
    for (const [, y] of bowl) expect(y).toBeLessThanOrEqual(0.24 + 1e-6);
  });
});
