import { describe, expect, it } from 'vitest';
import { OrthographicCamera } from 'three';
import { LIBRARY_OBJECTS } from '../../assets/process';
import { STEAM_NUT_BORE_SIDES, STEAM_NUT_EDGE_THRESHOLD, STEAM_NUT_INNER, STEAM_NUT_LEN, STEAM_NUT_R, STEAM_NUT_ROT, STEAM_NUT_ROT_ORDER } from '../../assets/process/EndCap';
import { ISO_LABEL_SCREEN_DEG, LABEL_BASE_DEG, LABEL_FONT_FAMILY, LABEL_FONT_WEIGHT, LABEL_LETTER_SPACING, LABEL_PLANE_Y, LABEL_REFERENCE_ZOOM, LABEL_SCREEN_PX_MIN, LABEL_SCREEN_PX_PER_SIZE, LABEL_TWO_LINE_ALIGN, LABEL_TWO_LINE_HEIGHT, screenToSlab } from '../../assets/process/Label';
import { AREA_Y } from '../../assets/process/Area';
import { DEFAULT_FITTING_PARAMS } from '../../assets/process/fitting-params';
import { ELBOW_RADIUS, PIPE_RADIUS, WEST_NIPPLE_ROLL, WEST_NIPPLE_SIDES, WEST_NUT_LEN, WEST_NUT_R, WEST_RING_EDGE_THRESHOLD, WEST_RING_LEN, WEST_RING_RADIAL, WEST_TANK_END } from '../../assets/process/pipe-math';
import { DEFAULT_TANK_PARAMS, LIQUID_THETA_LENGTH, TANK_INNER_RATIO, TANK_BOWL_Y_OFFSET, TANK_DOME_HEIGHT_SEGMENTS, TANK_BODY_RINGS, TANK_SHADE_MIN, TANK_HUB_WHITE, TANK_SHADE_MAX, MIXER_SHADE_MIN, MIXER_LIQUID_OPACITY, TANK_LIQUID_OPACITY, TANK_WALL_THRESHOLD, MIXER_WALL_THRESHOLD, MIXER_HUB_WHITE, MIXER_SHADE_MAX, MIXER_LINER_RATIO, TANK_LINER_RATIO, MIXER_LINER_COLOR, TANK_LINER_COLOR, TANK_WINDOW_DEG, TANK_WINDOW_YAW, MIXER_INNER_RATIO, MIXER_IMPELLER_BLADES, MIXER_IMPELLER_YAW, MIXER_IMPELLER_RADIUS, MIXER_IMPELLER_SIDES, MIXER_IMPELLER_SPAN, MIXER_IMPELLER_Y_FACTOR, MIXER_SHAFT_RADIUS, MIXER_SHAFT_LENGTH, MIXER_SHAFT_SIDES, MIXER_CAP_HEIGHT_RATIO, MIXER_CAP_LID_THICKNESS, MIXER_BODY_RINGS, MIXER_CAP_RADIUS_RATIO, MIXER_RADIAL_SEGMENTS, MIXER_HAT_LID_RING, MIXER_HAT_YAW, MIXER_AGITATOR_DEPTH_TEST, MIXER_AGITATOR_COLOR, MIXER_WINDOW_DEG, MIXER_WINDOW_YAW, MIXER_SHOULDER_RATIO, MIXER_SHOULDER_TOP, MIXER_OUTER_BOWL, MIXER_HEEL_OVERLAP, MIXER_SHOULDER_OVERLAP, MIXER_DOME_OVERLAP, FLASK_MERIDIAN_STEP, MIXER_WALL_MERIDIAN_STEP, flaskBowl, flaskLathePoints, bottleShoulderEase, bottleShoulderPoints, mixerUpperPoints, cylinderThetasEven, cylinderThetasKept, liquidCylinderHeight, mergeTankParams, mixerShaftLayout, mixerImpellerBladeLayout } from '../../assets/process/tank-params';
import { REFERENCE_ZOOM } from '../editor/ProcessSceneView';
import { PROCESS_SCENE, loadProcessScene } from './load-process-scene';
import { PROCESS_SNAPSHOT } from './ProcessLineSketch';
import { gridToWorld, parseSceneFile, sceneBounds, worldToGrid } from './scene';

describe('scene document', () => {
  it('loads placements from scene.json against the library', () => {
    expect(PROCESS_SCENE.objects.length).toBeGreaterThan(10);
    for (const obj of PROCESS_SCENE.objects) {
      expect(LIBRARY_OBJECTS).toContain(obj.object);
      expect(typeof obj.x).toBe('number');
      expect(typeof obj.y).toBe('number');
    }
  });

  it('reuses library objects at different cells', () => {
    const tanks = PROCESS_SCENE.objects.filter((o) => o.object === 'tank');
    expect(tanks.map((t) => t.id).sort()).toEqual(['holding', 'ingredient-a', 'ingredient-b']);
    expect(new Set(tanks.map((t) => `${t.x},${t.y}`)).size).toBe(tanks.length);
  });

  it('rejects placements without coordinates', () => {
    expect(() =>
      parseSceneFile({
        id: 'bad',
        name: 'bad',
        gridCellSize: 1,
        objects: [{ id: 'ghost', object: 'tank' }],
      }),
    ).toThrow(/missing numeric x,y/);
  });

  it('rejects unknown library objects', () => {
    expect(() =>
      loadProcessScene({
        id: 'bad',
        name: 'bad',
        gridCellSize: 1,
        objects: [{ id: 'ghost', object: 'spaceship', x: 0, y: 0 }],
      }),
    ).toThrow(/unknown library object/);
  });

  it('converts grid cells through the cell center', () => {
    expect(gridToWorld(0, 0, 10)).toEqual([5, 0, 5]);
    expect(worldToGrid(5, 5, 10)).toEqual({ x: 0, y: 0 });
  });

  it('places holding at the origin', () => {
    const holding = PROCESS_SCENE.objects.find((o) => o.id === 'holding');
    const mixer = PROCESS_SCENE.objects.find((o) => o.id === 'mixer');
    const a = PROCESS_SCENE.objects.find((o) => o.id === 'ingredient-a');
    const b = PROCESS_SCENE.objects.find((o) => o.id === 'ingredient-b');
    expect(holding).toMatchObject({ object: 'tank', x: 1, y: -1, params: { level: 0.12 } });
    expect(mixer).toMatchObject({ object: 'mixer', x: 3.9, y: -4.42, params: { level: 0.52 }, fillColor: '#18BAE6' });
    // 0.22 climbed the cylinder vs r-inga dish in the U. Freeze 0.12 with holding.
    expect(a).toMatchObject({ params: { level: 0.12 } });
    expect(b).toMatchObject({ params: { level: 0.12 } });
    expect(PROCESS_SNAPSHOT.mixerFill).toBeCloseTo(0.52);
    expect(PROCESS_SNAPSHOT.fillColor).toBe('#18BAE6');
    expect(LIQUID_THETA_LENGTH).toBeCloseTo(Math.PI * 2);
    expect(MIXER_INNER_RATIO).toBeCloseTo(0.72);
    expect(MIXER_IMPELLER_BLADES).toBe(3);
    expect(MIXER_IMPELLER_YAW).toBeCloseTo(Math.PI / 6);
    expect(MIXER_IMPELLER_RADIUS).toBeCloseTo(0.03);
    expect(MIXER_IMPELLER_RADIUS).toBeLessThan(0.042);
    expect(MIXER_IMPELLER_SIDES).toBe(4);
    expect(MIXER_IMPELLER_SIDES).toBeLessThan(6);
    expect(MIXER_SHAFT_RADIUS).toBeCloseTo(0.032);
    expect(MIXER_SHAFT_RADIUS).toBeLessThan(0.055);
    expect(MIXER_SHAFT_LENGTH).toBeCloseTo(0.77);
    expect(MIXER_SHAFT_LENGTH).toBeLessThan(0.95);
    expect(MIXER_IMPELLER_Y_FACTOR).toBeCloseTo(0.38);
    expect(MIXER_IMPELLER_Y_FACTOR).toBeLessThan(0.5);
    const mixShaft = mixerShaftLayout(2.7, 0.52, mergeTankParams({ shaftLength: MIXER_SHAFT_LENGTH }));
    expect(mixShaft.shaftBot).toBeLessThanOrEqual(mixShaft.liquidY + 1e-6);
    expect(mixShaft.liquidY).toBeLessThan(-0.7);
    expect(MIXER_SHAFT_SIDES).toBe(16);
    expect(MIXER_SHAFT_SIDES).toBeGreaterThan(8);
    expect(MIXER_IMPELLER_SPAN).toBeCloseTo(0.36);
    expect(MIXER_IMPELLER_SPAN).toBeLessThan(0.45);
    expect(MIXER_IMPELLER_SPAN).not.toBe(MIXER_IMPELLER_Y_FACTOR);
    expect(MIXER_IMPELLER_SPAN).toBeLessThan(MIXER_INNER_RATIO * 2);
    const mixBlades = mixerImpellerBladeLayout(MIXER_IMPELLER_SPAN, MIXER_SHAFT_RADIUS);
    expect(mixBlades.bladeLen).toBeLessThan(MIXER_IMPELLER_SPAN);
    expect(mixBlades.radial).toBeGreaterThan(MIXER_SHAFT_RADIUS);
    expect(MIXER_CAP_HEIGHT_RATIO).toBeCloseTo(0.1);
    expect(MIXER_CAP_HEIGHT_RATIO).toBeLessThan(0.18);
    expect(MIXER_CAP_LID_THICKNESS).toBeCloseTo(0.02);
    expect(MIXER_CAP_LID_THICKNESS).toBeLessThan(0.025);
    expect(MIXER_BODY_RINGS).toBe(0);
    expect(MIXER_BODY_RINGS).toBeLessThan(3);
    expect(MIXER_CAP_RADIUS_RATIO).toBeCloseTo(0.4);
    expect(MIXER_CAP_RADIUS_RATIO).toBeLessThan(0.5);
    expect(MIXER_RADIAL_SEGMENTS).toBe(15);
    expect(MIXER_RADIAL_SEGMENTS).toBeLessThan(24);
    expect(MIXER_HAT_LID_RING).toBe(false);
    expect(MIXER_HAT_YAW).toBeCloseTo(Math.PI / 8);
    expect(MIXER_AGITATOR_DEPTH_TEST).toBe(true);
    expect(MIXER_AGITATOR_COLOR).toBe('#666666');
    expect(TANK_INNER_RATIO).toBeCloseTo(0.74);
    expect(FLASK_MERIDIAN_STEP).toBe(3);
    expect(MIXER_WALL_MERIDIAN_STEP).toBe(3);
    expect(
      cylinderThetasKept(24, 0, Math.PI * 1.6, MIXER_WALL_MERIDIAN_STEP).length,
    ).toBeLessThan(cylinderThetasKept(24, 0, Math.PI * 1.6).length);
    expect(
      cylinderThetasEven(15, 0, LIQUID_THETA_LENGTH, true, FLASK_MERIDIAN_STEP).length,
    ).toBeLessThan(cylinderThetasEven(15, 0, LIQUID_THETA_LENGTH, true).length);
    expect(
      cylinderThetasEven(24, 0, LIQUID_THETA_LENGTH, true, FLASK_MERIDIAN_STEP).length,
    ).toBeLessThan(cylinderThetasEven(24, 0, LIQUID_THETA_LENGTH, true).length);
    expect(
      cylinderThetasKept(15, 0, Math.PI * 1.6, FLASK_MERIDIAN_STEP).length,
    ).toBeLessThan(cylinderThetasKept(15, 0, Math.PI * 1.6).length);
    expect(TANK_BOWL_Y_OFFSET).toBe(0);
    expect(TANK_DOME_HEIGHT_SEGMENTS).toBe(3); // round 3: 2 -> 3 latitude rings, denser cap like the reference
    expect(TANK_DOME_HEIGHT_SEGMENTS).toBeLessThan(4);
    expect(DEFAULT_TANK_PARAMS.domeHeightSegments).toBe(TANK_DOME_HEIGHT_SEGMENTS);
    expect(TANK_BODY_RINGS).toBe(0);
    expect(DEFAULT_TANK_PARAMS.bodyRings).toBe(TANK_BODY_RINGS);
    expect(TANK_SHADE_MIN).toBeCloseTo(0.22);
    expect(TANK_SHADE_MIN).toBeLessThan(0.27);
    expect(DEFAULT_TANK_PARAMS.shadeMin).toBe(TANK_SHADE_MIN);
    expect(TANK_HUB_WHITE).toBeCloseTo(0.85);
    expect(TANK_HUB_WHITE).toBeGreaterThan(0.77);
    expect(DEFAULT_TANK_PARAMS.hubWhite).toBe(TANK_HUB_WHITE);
    expect(TANK_SHADE_MAX).toBeCloseTo(0.95);
    expect(TANK_SHADE_MAX).toBeGreaterThan(0.92);
    expect(DEFAULT_TANK_PARAMS.shadeMax).toBe(TANK_SHADE_MAX);
    expect(MIXER_SHADE_MIN).toBeCloseTo(0.4);
    expect(MIXER_SHADE_MIN).toBeGreaterThan(TANK_SHADE_MIN);
    expect(MIXER_LIQUID_OPACITY).toBeCloseTo(0.84);
    expect(TANK_LIQUID_OPACITY).toBe(1); // solid: 0.88 with depthWrite off let back-wall lines print through the cutout
    expect(TANK_LIQUID_OPACITY).toBeGreaterThan(0.69);
    expect(DEFAULT_TANK_PARAMS.liquidOpacity).toBe(TANK_LIQUID_OPACITY);
    // Round 3 dropped the old MIXER > TANK invariant: tank liquid now has shaded side/surface, so it can be as solid as the mixer's.
    expect(TANK_WALL_THRESHOLD).toBe(15);
    expect(TANK_WALL_THRESHOLD).toBeGreaterThan(7);
    expect(DEFAULT_TANK_PARAMS.wallThreshold).toBe(TANK_WALL_THRESHOLD);
    expect(MIXER_WALL_THRESHOLD).toBe(7);
    expect(MIXER_HUB_WHITE).toBeCloseTo(0.88);
    expect(MIXER_HUB_WHITE).toBeGreaterThan(TANK_HUB_WHITE);
    expect(MIXER_SHADE_MAX).toBeCloseTo(0.97);
    expect(MIXER_SHADE_MAX).toBeGreaterThan(TANK_SHADE_MAX);
    expect(MIXER_LINER_RATIO).toBeCloseTo(0.99);
    expect(TANK_LINER_RATIO).toBeCloseTo(0.99);
    expect(TANK_LINER_RATIO).toBeGreaterThan(0.97);
    expect(DEFAULT_TANK_PARAMS.linerRatio).toBe(TANK_LINER_RATIO);
    expect(MIXER_LINER_COLOR).toBe('#ffffff');
    expect(TANK_LINER_COLOR).toBe('#ffffff');
    expect(DEFAULT_TANK_PARAMS.linerColor).toBe(TANK_LINER_COLOR);
    expect(DEFAULT_TANK_PARAMS.bowlYOffset).toBe(0);
    expect(DEFAULT_TANK_PARAMS.innerRatio).toBeCloseTo(TANK_INNER_RATIO);
    expect(MIXER_INNER_RATIO).toBeLessThan(DEFAULT_TANK_PARAMS.innerRatio);
    expect(TANK_WINDOW_DEG).toBe(91);
    expect(TANK_WINDOW_YAW).toBe(45);
    expect(DEFAULT_TANK_PARAMS.windowDeg).toBe(TANK_WINDOW_DEG);
    expect(DEFAULT_TANK_PARAMS.windowYawDeg).toBe(TANK_WINDOW_YAW);
    expect(MIXER_WINDOW_DEG).toBe(70);
    expect(MIXER_WINDOW_DEG).toBeLessThan(TANK_WINDOW_DEG);
    expect(MIXER_WINDOW_YAW).toBe(40);
    expect(MIXER_WINDOW_YAW).toBeLessThan(TANK_WINDOW_YAW);
    expect(MIXER_SHOULDER_RATIO).toBeCloseTo(0.18);
    expect(MIXER_SHOULDER_TOP).toBeCloseTo(0.82);
    expect(bottleShoulderEase(0)).toBeCloseTo(0);
    expect(bottleShoulderEase(1)).toBeCloseTo(1);
    expect(bottleShoulderEase(0.1)).toBeLessThan(0.1);
    const neckPts = bottleShoulderPoints(1, MIXER_SHOULDER_TOP, 0, 1, 8);
    expect(neckPts[0]?.[0]).toBeCloseTo(1);
    expect(neckPts[neckPts.length - 1]?.[0]).toBeCloseTo(MIXER_SHOULDER_TOP);
    const upper = mixerUpperPoints(1, MIXER_SHOULDER_TOP, -1 - MIXER_HEEL_OVERLAP, 0.5, 1, 1, MIXER_SHOULDER_TOP, 0.32, Math.PI / 2);
    expect(upper[0]?.[1]).toBeCloseTo(-1 - MIXER_HEEL_OVERLAP);
    expect(upper[0]?.[0]).toBeCloseTo(1);
    expect(upper[upper.length - 1]?.[0]).toBeCloseTo(0);
    expect(DEFAULT_TANK_PARAMS.shoulderRatio).toBe(0);
    expect(MIXER_OUTER_BOWL).toBeCloseTo(0.28);
    expect(MIXER_HEEL_OVERLAP).toBeCloseTo(0.06);
    expect(MIXER_SHOULDER_OVERLAP).toBeCloseTo(0.05);
    expect(MIXER_DOME_OVERLAP).toBeCloseTo(0.04);
    expect(DEFAULT_TANK_PARAMS.outerBowlHeight).toBe(0);
    const mixerY0 = -2.7 / 2;
    const mixerFlask = flaskBowl(mixerY0, MIXER_INNER_RATIO, MIXER_OUTER_BOWL, DEFAULT_TANK_PARAMS.bowlHeight, DEFAULT_TANK_PARAMS.bowlYOffset);
    expect(mixerFlask.bowlH).toBeCloseTo(MIXER_OUTER_BOWL);
    expect(mixerFlask.originY).toBeCloseTo(mixerY0 + MIXER_OUTER_BOWL);
    const tankH = DEFAULT_TANK_PARAMS.height;
    const y0 = -tankH / 2;
    const holdingTop = y0 + tankH * 0.21;
    const bowlOriginY = y0 + DEFAULT_TANK_PARAMS.bowlHeight + DEFAULT_TANK_PARAMS.bowlYOffset;
    const tankFlask = flaskBowl(y0, DEFAULT_TANK_PARAMS.innerRatio, 0, DEFAULT_TANK_PARAMS.bowlHeight, DEFAULT_TANK_PARAMS.bowlYOffset);
    expect(tankFlask.originY).toBeCloseTo(bowlOriginY);
    const lathe = flaskLathePoints(TANK_INNER_RATIO, tankFlask.bowlH, tankFlask.originY, holdingTop, 8);
    expect(lathe[0]?.[0]).toBeCloseTo(0);
    expect(lathe[lathe.length - 1]?.[0]).toBeCloseTo(0);
    expect(lathe[lathe.length - 1]?.[1]).toBeCloseTo(holdingTop);
    expect(lathe.some(([x, y]) => Math.abs(x - TANK_INNER_RATIO) < 0.02 && Math.abs(y - tankFlask.originY) < 0.02)).toBe(
      true,
    );
    const cylH = liquidCylinderHeight(holdingTop, bowlOriginY);
    const withCap = liquidCylinderHeight(holdingTop - DEFAULT_TANK_PARAMS.bowlHeight, bowlOriginY);
    expect(cylH).toBeGreaterThan(withCap);
    expect(cylH).toBeGreaterThan(DEFAULT_TANK_PARAMS.bowlHeight);
    expect(a).toMatchObject({ object: 'tank', x: 0.5, y: -10.72 });
    expect(b).toMatchObject({ object: 'tank', x: 6.82, y: -10.73 });
  });

  it('routes pipes on the grid axes', () => {
    const pipes = PROCESS_SCENE.objects.filter((o) => o.object === 'pipe');
    expect(pipes.length).toBeGreaterThan(5);
    for (const pipe of pipes) {
      const axisAligned = pipe.x === pipe.toX || pipe.y === pipe.toY;
      expect(axisAligned, `${pipe.id} is diagonal`).toBe(true);
    }
  });

  it('gives A and B each their own incoming run along -Y', () => {
    const a = PROCESS_SCENE.objects.find((o) => o.id === 'ingredient-a');
    const b = PROCESS_SCENE.objects.find((o) => o.id === 'ingredient-b');
    const aIn = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-a-in');
    const bIn = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-b-in');
    expect(aIn).toMatchObject({ object: 'pipe', x: 0.5, toX: 0.5 });
    expect(bIn).toMatchObject({ object: 'pipe', x: 6.82, toX: 6.82 });
    expect(aIn?.toY).toBeLessThan(aIn?.y ?? 0);
    expect(bIn?.toY).toBeLessThan(bIn?.y ?? 0);
    expect(aIn?.x).toBe(a?.x);
    expect(bIn?.x).toBe(b?.x);
    expect(aIn?.x).not.toBe(bIn?.x);
  });

  it('has exactly one mixer and no separate shaft placement', () => {
    const mixers = PROCESS_SCENE.objects.filter((o) => o.object === 'mixer');
    expect(mixers).toHaveLength(1);
    expect(mixers[0]?.id).toBe('mixer');
    expect(PROCESS_SCENE.objects.filter((o) => o.object === 'shaft')).toHaveLength(0);
    const tanks = PROCESS_SCENE.objects.filter((o) => o.object === 'tank');
    expect(tanks.map((t) => t.id).sort()).toEqual(['holding', 'ingredient-a', 'ingredient-b']);
  });

  it('runs A and B to the mixer on separate corridors', () => {
    expect(PROCESS_SCENE.objects.find((o) => o.id === 'pipe-a-b')).toBeUndefined();
    const aV = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-a-v');
    const bV = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-b-v');
    const aH = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-a-h');
    const bH = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-b-h');
    expect(aV).toMatchObject({ x: 4, toX: 4 });
    expect(bV).toMatchObject({ x: 5, toX: 5 });
    expect(aH?.toX).toBe(0.5);
    expect(bH?.toX).toBe(6.82);
    expect(aV?.x).not.toBe(bV?.x);
  });

  it('keeps the plant in a compact AABB', () => {
    const bounds = sceneBounds(PROCESS_SCENE.objects);
    expect(bounds.maxX - bounds.minX).toBeLessThan(40);
    expect(bounds.maxY - bounds.minY).toBeLessThan(40);
  });

  it('places labels on the supply-slab plane', () => {
    expect(LABEL_PLANE_Y).toBeGreaterThan(AREA_Y);
    expect(LABEL_PLANE_Y).toBeLessThan(0.2);
    const cam = new OrthographicCamera(-10, 10, 10, -10, 0.5, 4000);
    cam.position.set(18, 18, 18);
    cam.lookAt(0, 1.38, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const [, y] = screenToSlab(cam, 760, 540, 380, 270);
    expect(y).toBeCloseTo(LABEL_PLANE_Y);
  });

  it('scales live labels against the same ortho zoom the snapshot was pinned at', () => {
    expect(LABEL_REFERENCE_ZOOM).toBe(REFERENCE_ZOOM);
  });

  it('defaults label aisle, elbow cap roll, and mixer cap line width for the tuner', () => {
    expect(LABEL_BASE_DEG).toBe(0);
    expect(ISO_LABEL_SCREEN_DEG).toBe(30);
    expect(LABEL_SCREEN_PX_PER_SIZE).toBe(36);
    expect(LABEL_SCREEN_PX_MIN).toBe(8);
    expect(LABEL_TWO_LINE_HEIGHT).toBe(1.45);
    expect(LABEL_TWO_LINE_ALIGN).toBe('right');
    expect(LABEL_LETTER_SPACING).toBe('-0.03em');
    expect(LABEL_FONT_FAMILY).toContain('Helvetica');
    expect(LABEL_FONT_WEIGHT).toBe(300);
    expect(LABEL_FONT_WEIGHT).toBeLessThan(400);
    expect(DEFAULT_FITTING_PARAMS.labelAngleDeg).toBe(LABEL_BASE_DEG);
    expect(DEFAULT_FITTING_PARAMS.elbowCapDeg).toBe(0);
    expect(DEFAULT_FITTING_PARAMS.elbowOffset).toBeCloseTo(-ELBOW_RADIUS * Math.SQRT2);
  });

  it('orients 90° elbows: most +180° from the old rest pose, steam-out +90°', () => {
    const rot = (id: string) => PROCESS_SCENE.objects.find((o) => o.id === id)?.rotation;
    expect(rot('elbow-holding-mixer')).toBeCloseTo(0);
    expect(rot('elbow-packaging')).toBeCloseTo(0);
    expect(rot('elbow-a-turn')).toBeCloseTo(Math.PI / 2);
    expect(rot('elbow-b-turn')).toBeCloseTo(Math.PI);
    expect(rot('elbow-steam')).toBeCloseTo(Math.PI / 2);
    // Green-valve corner: runs leave toward −Y (steam riser) and +X (steam-out).
    // Torus is now centred on the inside of the L (ELBOW_OFFSET = −R·√2), so
    // elbowYawForDirs is right for every corner: −π/2 here (was a +π/2 hack
    // when the torus sat in the outer quadrant).
    expect(rot('elbow-steam-out')).toBeCloseTo(-Math.PI / 2);
  });

  it('extends the west packaging stub past the elbow so the mouth matches the reference span', () => {
    const end = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-packaging-end');
    expect(end).toMatchObject({ x: 1, y: 2.7, toY: 2.7 });
    expect(end?.toX).toBeCloseTo(-2);
    const chevron = PROCESS_SCENE.objects.find((o) => o.id === 'chevron-packaging');
    expect(chevron?.x).toBeCloseTo(-2);
    // r-west hex ridges, not the 8-gon sleeve stack that dualled in o-west.
    expect(WEST_NIPPLE_SIDES).toBe(6);
    expect(WEST_NIPPLE_ROLL).toBeCloseTo(Math.PI / 6);
    expect(WEST_NUT_R).toBeCloseTo(0.24);
    expect(WEST_NUT_LEN).toBeCloseTo(0.26);
    // Multiples are rescaled by LEGACY_PIPE_RADIUS/PIPE_RADIUS so the ring keeps
    // its absolute 2.52 × 0.11 size now that the pipe is fatter.
    expect(WEST_RING_RADIAL[2] * PIPE_RADIUS).toBeCloseTo(2.52 * 0.11);
    expect(WEST_RING_RADIAL[2]).toBeLessThan(2.9);
    expect(WEST_RING_LEN[0]).toBeCloseTo(0.11);
    expect(WEST_RING_LEN[2]).toBeCloseTo(0.13);
    expect(WEST_RING_LEN[0]).toBeGreaterThan(0.08);
    expect(WEST_RING_EDGE_THRESHOLD).toBe(15);
    expect(WEST_RING_EDGE_THRESHOLD).toBeGreaterThan(1);
    expect(WEST_TANK_END[0]).toBeCloseTo(1.28);
    expect(WEST_TANK_END[1]).toBeCloseTo(0.07);
    expect(WEST_TANK_END[0]).toBeLessThan(1.5);
  });

  it('runs the steam-out pipe through the hex so a stub remains under Steam Out', () => {
    const pipe = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-steam-out-b');
    const cap = PROCESS_SCENE.objects.find((o) => o.id === 'cap-steam');
    expect(pipe?.toX).toBeGreaterThan(cap?.x ?? 0);
    expect(pipe?.toX).toBeCloseTo(12.9);
  });

  it('keeps the steam hex smaller than the overlay-large 0.54 nut', () => {
    expect(STEAM_NUT_R).toBeGreaterThan(STEAM_NUT_INNER);
    expect(STEAM_NUT_R).toBeLessThan(0.54);
    expect(STEAM_NUT_R).toBeCloseTo(0.40);
    expect(STEAM_NUT_LEN).toBeCloseTo(0.50);
    expect(STEAM_NUT_ROT[0]).toBeCloseTo(Math.PI / 6);
    expect(STEAM_NUT_ROT[1]).toBeCloseTo(Math.PI / 12);
    expect(STEAM_NUT_ROT[2]).toBeCloseTo(-Math.PI / 2);
    expect(STEAM_NUT_ROT_ORDER).toBe('XYZ');
    expect(STEAM_NUT_BORE_SIDES).toBe(16);
    expect(STEAM_NUT_EDGE_THRESHOLD).toBe(15);
    expect(STEAM_NUT_EDGE_THRESHOLD).toBeGreaterThan(1);
  });

  it('carries screen-space label nudges from scene.json', () => {
    const holding = PROCESS_SCENE.objects.find((o) => o.id === 'label-holding');
    expect(holding).toMatchObject({ screenX: 218, screenY: 358 });
    const supply = PROCESS_SCENE.objects.find((o) => o.id === 'label-supply');
    expect(supply).toMatchObject({ screenX: 488, screenY: 208 });
    const ingredientA = PROCESS_SCENE.objects.find((o) => o.id === 'label-ingredient-a');
    expect(ingredientA).toMatchObject({ screenX: 330, screenY: 124 });
    const ingredientB = PROCESS_SCENE.objects.find((o) => o.id === 'label-ingredient-b');
    expect(ingredientB).toMatchObject({ screenX: 630, screenY: 294 });
    const aIn = PROCESS_SCENE.objects.find((o) => o.id === 'label-a-in');
    expect(aIn).toMatchObject({ screenX: 542, screenY: 133 });
    const bIn = PROCESS_SCENE.objects.find((o) => o.id === 'label-b-in');
    expect(bIn).toMatchObject({ screenX: 685, screenY: 211 });
    const packaging = PROCESS_SCENE.objects.find((o) => o.id === 'label-packaging');
    expect(packaging).toMatchObject({ screenX: 88, screenY: 343 });
    const chevPack = PROCESS_SCENE.objects.find((o) => o.id === 'chevron-packaging');
    expect(chevPack).toMatchObject({ screenX: 16, screenY: 334 });
    const chevA = PROCESS_SCENE.objects.find((o) => o.id === 'chevron-a');
    expect(chevA).toMatchObject({ screenX: 520, screenY: 132 });
    const chevB = PROCESS_SCENE.objects.find((o) => o.id === 'chevron-b');
    expect(chevB).toMatchObject({ screenX: 648, screenY: 207 });
    const pressure = PROCESS_SCENE.objects.find((o) => o.id === 'label-pressure');
    // 0.30 read large vs r-press; 0.22 clamped to LABEL_SCREEN_PX_MIN 8px.
    expect(pressure).toMatchObject({ screenX: 358, screenY: 420, size: 0.26 });
  });
});
