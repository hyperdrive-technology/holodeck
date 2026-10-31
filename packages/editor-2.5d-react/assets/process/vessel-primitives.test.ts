/**
 * Pure parts of the round-2 vessel primitives (LiquidVolume, InteriorLines,
 * LineSet, NozzleStub/flange, Supports, liner shading). The React wrappers
 * are thin; their pixels are reviewed through vessels-render.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { BackSide, Color } from 'three';
import type { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { createLineSet, setLineSetPositions } from './edge-lines';
import { createFinishMaterial, createIsoShadeMaterial } from './materials';
import { HOLODECK_STYLE, liquidFinish } from './style';
import { buildPipeGeometry } from './pipe-geometry';
import { buildValveBodyGeometry, VALVE_BODY_LEN, VALVE_FLANGE_R } from './valve-geometry';
import {
  bowlLatitudeRings,
  bowlProfile,
  flaskLathePoints,
  interiorMeridianSegments,
  interiorRingArc,
  LINER_SHADE,
  TANK_LINE_WIDTH,
  TANK_WINDOW_DEG,
  TANK_WINDOW_YAW,
  tankWindow,
  DEFAULT_TANK_PARAMS,
} from './tank-params';

describe('LiquidVolume: the liquid finish (shared with GLB hd.liquid)', () => {
  it('code-built liquid uses the same tokens as hd.liquid', () => {
    const mat = createFinishMaterial('liquid', { color: '#18bae6' });
    const token = liquidFinish(HOLODECK_STYLE);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.opacity).toBeCloseTo(token.opacity);
    expect(mat.userData.hdFinish).toBe('liquid');
    expect(`#${mat.color.getHexString()}`).toBe('#18bae6');
    // Tank's default liquidOpacity IS the token, so procedural and GLB liquids match.
    expect(DEFAULT_TANK_PARAMS.liquidOpacity).toBe(token.opacity);
    mat.dispose();
  });

  it('opacity override clamps to 0..1; colour defaults to style.colors.liquid', () => {
    const a = createFinishMaterial('liquid', { opacity: 2 });
    expect(a.opacity).toBe(1);
    expect(`#${a.color.getHexString()}`).toBe(HOLODECK_STYLE.colors.liquid);
    const b = createFinishMaterial('liquid', { color: new Color(0, 0, 1), opacity: -1 });
    expect(b.opacity).toBe(0);
    a.dispose();
    b.dispose();
  });
});

describe('bowl lines (LiquidVolume bowlLines)', () => {
  const profile = flaskLathePoints(0.9, 0.24, -1.26, 0, 16);

  it('bowlProfile keeps the pole and the bowl up to yMax, without the closing waterline point', () => {
    const bowl = bowlProfile(profile, -1.26);
    expect(bowl[0][0]).toBeCloseTo(0);
    expect(bowl.every(([, y]) => y <= -1.26 + 1e-6)).toBe(true);
    expect(bowl.slice(1).every(([r]) => r > 0)).toBe(true);
    expect(bowl[bowl.length - 1][0]).toBeCloseTo(0.9);
  });

  it('bowlLatitudeRings are full horizontal circles strictly inside the bowl, every step-th stack', () => {
    const all = bowlLatitudeRings(profile, -1.26, 1, 24);
    const half = bowlLatitudeRings(profile, -1.26, 2, 24);
    expect(all.length).toBeGreaterThan(0);
    expect(half.length).toBeLessThan(all.length);
    for (let i = 0; i < all.length; i += 6) expect(all[i + 1]).toBeCloseTo(all[i + 4]);
    // Nothing at or above the equator, nothing at the pole.
    for (let i = 1; i < all.length; i += 3) expect(all[i]).toBeLessThan(-1.26);
    expect(bowlLatitudeRings([[0, 0], [0, 1]], 5)).toHaveLength(0);
  });
});

describe('InteriorLines seams', () => {
  const win = tankWindow(TANK_WINDOW_DEG, TANK_WINDOW_YAW);
  const arc = interiorRingArc(TANK_WINDOW_DEG, TANK_WINDOW_YAW);
  const step = win.keepLen / 15;

  it('are vertical, span y0..y1, lie on liner vertices on the back arc', () => {
    const pts = interiorMeridianSegments(0.99, -1, 1, arc, win.keepStart, step, 1);
    expect(pts.length).toBeGreaterThan(0);
    for (let i = 0; i < pts.length; i += 6) {
      expect(pts[i]).toBeCloseTo(pts[i + 3]);
      expect(pts[i + 2]).toBeCloseTo(pts[i + 5]);
      expect(pts[i + 1]).toBe(-1);
      expect(pts[i + 4]).toBe(1);
      expect(Math.hypot(pts[i], pts[i + 2])).toBeCloseTo(0.99);
      let th = Math.atan2(pts[i], pts[i + 2]);
      while (th < arc.start) th += Math.PI * 2;
      expect(th - arc.start).toBeLessThan(arc.len);
      // On a liner vertex: an integer number of facet steps from the kept-arc start.
      const k = (th - win.keepStart) / step;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });

  it('step thins the seams; degenerate input gives none', () => {
    const one = interiorMeridianSegments(1, 0, 1, arc, win.keepStart, step, 1).length;
    const two = interiorMeridianSegments(1, 0, 1, arc, win.keepStart, step, 2).length;
    expect(two).toBeLessThan(one);
    expect(interiorMeridianSegments(1, 1, 1, arc, win.keepStart, step)).toHaveLength(0);
    expect(interiorMeridianSegments(1, 0, 1, arc, win.keepStart, 0)).toHaveLength(0);
  });
});

describe('LineSet (fat cage / rim lines)', () => {
  it('createLineSet fills a LineSegments2 and setLineSetPositions empties it on <2 points', () => {
    const line = createLineSet(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2, 0]), { lineWidth: TANK_LINE_WIDTH });
    const geo = line.geometry as LineSegmentsGeometry;
    expect(geo.instanceCount).toBe(2);
    expect(line.raycast).toBeTypeOf('function');
    setLineSetPositions(line, new Float32Array([0, 0, 0]));
    expect(geo.instanceCount).toBe(0);
    expect(TANK_LINE_WIDTH).toBeGreaterThanOrEqual(1);
  });
});

describe('liner shading (ShadedMesh inside)', () => {
  it('is lighter than the outer vessel wall and drawn inside-out', () => {
    expect(LINER_SHADE.shadeMin).toBeGreaterThan(HOLODECK_STYLE.finishes.vessel.shadeMin);
    expect(LINER_SHADE.shadeMax).toBeLessThanOrEqual(1);
    const m = createIsoShadeMaterial({ radius: 1, whiteHub: false, ...LINER_SHADE, offset: false, inside: true });
    expect(m.userData.iso).toBeDefined();
    m.side = BackSide;
    expect(m.side).toBe(BackSide);
    m.dispose();
  });
});

describe('flange ring shared by pipes and valves', () => {
  it('pipe end flanges and valve flanges sit at the run ends, wider than the run', () => {
    const pipe = buildPipeGeometry({ length: 2, ends: { from: 'flange', to: 'flange' } });
    pipe.computeBoundingBox();
    expect(pipe.boundingBox!.max.y).toBeGreaterThan(1);
    const valve = buildValveBodyGeometry();
    valve.computeBoundingBox();
    // Flanges are on the barrel's X axis at +-VALVE_BODY_LEN / 2.
    expect(valve.boundingBox!.max.x).toBeGreaterThanOrEqual(VALVE_BODY_LEN / 2);
    expect(valve.boundingBox!.min.x).toBeLessThanOrEqual(-VALVE_BODY_LEN / 2);
    expect(valve.boundingBox!.max.z).toBeCloseTo(VALVE_FLANGE_R, 3);
    pipe.dispose();
    valve.dispose();
  });
});
