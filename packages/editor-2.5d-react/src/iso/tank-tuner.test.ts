import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM } from '../test-support/chromium';
import { launchRenderBrowser } from '../test-support/render-harness';
import { DEFAULT_TANK_PARAMS, LIQUID_THETA_LENGTH, TANK_INNER_RATIO, TANK_BOWL_Y_OFFSET, MIXER_INNER_RATIO, MIXER_WINDOW_DEG, MIXER_SHOULDER_RATIO, MIXER_SHOULDER_TOP, MIXER_OUTER_BOWL, MIXER_HEEL_OVERLAP, MIXER_SHOULDER_OVERLAP, MIXER_DOME_OVERLAP, angleOnArc, bodyShoulder, bodyOuterBowl, flaskBowl, heelOverlap, shoulderOverlap, bowlThetaForLiquid, cylinderThetasEven, cylinderThetasKept, innerCageSpan, liquidCylinderHeight, liquidSurfaceRadius, mergeTankParams, mixerHatLayout, mixerShaftLayout, MIXER_IMPELLER_FLOOR_CLEARANCE, MIXER_HAT_ASPECT, spherePhiFromCylinderTheta, tankWindow, tunedVesselHeight, windowFillSegments } from '../../assets/process/tank-params';

const pkgRoot = path.resolve(import.meta.dirname, '../..');

let server: ViteDevServer;

beforeAll(async () => {
  if (!CHROMIUM) return; // only the browser test below uses the server
  server = await createServer({
    root: path.join(pkgRoot, 'src/iso'),
    configFile: path.join(pkgRoot, 'src/iso/vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [pkgRoot] } },
    logLevel: 'error',
    esbuild: { jsx: 'automatic' },
  });
  await server.listen();
}, 30_000);

afterAll(async () => {
  await server?.close();
});

describe('tank tuner', () => {
  it('clips the bowl sphere to the waterline', () => {
    const full = bowlThetaForLiquid(1, 0.5, 0, 0, 0.5);
    expect(full?.thetaStart).toBeCloseTo(Math.PI / 2);
    expect(full?.thetaLength).toBeCloseTo(Math.PI / 2);
    expect(bowlThetaForLiquid(1, 0.5, 0, 0, -0.1)).toBeNull();
  });

  it('shrinks the waterline radius inside the bowl and uses the inner radius above the equator', () => {
    expect(liquidSurfaceRadius(1, 0.5, 0, 0, 0.5)).toBeCloseTo(1);
    expect(liquidSurfaceRadius(1, 0.5, 0, 0, 0.25)).toBeCloseTo(Math.sqrt(0.75));
  });

  it('uses the same even world meridians on the open back wall as on the dome', () => {
    const keepStart = Math.PI / 2;
    const keepLen = (Math.PI * 2 * 269) / 360;
    const wall = cylinderThetasKept(15, keepStart, keepLen);
    expect(wall[0]).toBeCloseTo(keepStart);
    expect(wall[1]).toBeCloseTo(keepStart + keepLen);
    expect(wall.length).toBeGreaterThan(3);
  });

  it('keeps inner-cage meridians on the back wall, not in the window', () => {
    const { windowStart, windowRad, keepStart, keepLen } = tankWindow(
      DEFAULT_TANK_PARAMS.windowDeg,
      DEFAULT_TANK_PARAMS.windowYawDeg,
    );
    const inner = cylinderThetasKept(DEFAULT_TANK_PARAMS.radialSegments, keepStart, keepLen);
    const around = cylinderThetasEven(DEFAULT_TANK_PARAMS.radialSegments, 0, Math.PI * 2, true);
    const leaked = around.filter((th) => angleOnArc(th, windowStart, windowRad));
    expect(leaked.length).toBeGreaterThan(0);
    for (const th of inner) {
      expect(angleOnArc(th, keepStart, keepLen)).toBe(true);
    }
    for (const th of leaked) {
      expect(inner.some((t) => Math.abs(t - th) < 1e-4)).toBe(false);
    }
    const nearJamb = (96 * Math.PI) / 180;
    expect(inner.some((t) => Math.abs(t - nearJamb) < 1e-4)).toBe(false);
  });

  it('does not run the inner cage through the liquid, and smooths the window fill', () => {
    expect(innerCageSpan(-1.5, 1.5, -0.5)).toEqual({ y0: -0.5, y1: 1.5 });
    expect(innerCageSpan(-1.5, 1.5, 1.5)).toBeNull();
    expect(windowFillSegments(DEFAULT_TANK_PARAMS.radialSegments)).toBeGreaterThanOrEqual(32);
    const { windowStart, windowRad, keepStart } = tankWindow(
      DEFAULT_TANK_PARAMS.windowDeg,
      DEFAULT_TANK_PARAMS.windowYawDeg,
    );
    expect(keepStart).toBeCloseTo(windowStart + windowRad);
  });

  it('draws liquid as a closed flask, not a window pie', () => {
    expect(LIQUID_THETA_LENGTH).toBeCloseTo(Math.PI * 2);
    const { windowStart, windowRad } = tankWindow(
      DEFAULT_TANK_PARAMS.windowDeg,
      DEFAULT_TANK_PARAMS.windowYawDeg,
    );
    const flaskThetas = cylinderThetasEven(DEFAULT_TANK_PARAMS.radialSegments, 0, LIQUID_THETA_LENGTH, true);
    expect(flaskThetas.some((th) => angleOnArc(th, windowStart, windowRad))).toBe(true);
    expect(MIXER_INNER_RATIO).toBeLessThanOrEqual(DEFAULT_TANK_PARAMS.innerRatio);
    expect(DEFAULT_TANK_PARAMS.innerRatio).toBeCloseTo(TANK_INNER_RATIO);
    const silo = bodyShoulder(2.7, 1, DEFAULT_TANK_PARAMS);
    expect(silo.shoulderH).toBe(0);
    expect(silo.topR).toBeCloseTo(1);
    const neck = bodyShoulder(2.7, 1, {
      shoulderRatio: MIXER_SHOULDER_RATIO,
      shoulderTopRatio: MIXER_SHOULDER_TOP,
    });
    expect(neck.shoulderH).toBeGreaterThan(0.3);
    expect(neck.topR).toBeCloseTo(MIXER_SHOULDER_TOP);
    expect(neck.topR).toBeLessThan(1);
    const heel = bodyOuterBowl(neck.cylH, MIXER_OUTER_BOWL);
    expect(heel.bowlH).toBeCloseTo(MIXER_OUTER_BOWL);
    expect(heel.cylH).toBeLessThan(neck.cylH);
    expect(bodyOuterBowl(2.7, 0).bowlH).toBe(0);
    expect(heelOverlap(0)).toBe(0);
    expect(heelOverlap(MIXER_OUTER_BOWL)).toBeCloseTo(MIXER_HEEL_OVERLAP);
    expect(shoulderOverlap(0)).toBe(0);
    expect(shoulderOverlap(MIXER_SHOULDER_RATIO * 2.7)).toBeCloseTo(MIXER_SHOULDER_OVERLAP);
    expect(MIXER_DOME_OVERLAP).toBeCloseTo(0.04);
    const mixerFlask = flaskBowl(-1.35, MIXER_INNER_RATIO, MIXER_OUTER_BOWL, 0.24, -0.2);
    expect(mixerFlask.originY).toBeCloseTo(-1.35 + MIXER_OUTER_BOWL);
    expect(flaskBowl(-1.525, 0.9, 0, 0.24, TANK_BOWL_Y_OFFSET).originY).toBeCloseTo(-1.525 + 0.24);
    const tankH = DEFAULT_TANK_PARAMS.height;
    const y0 = -tankH / 2;
    const holdingTop = y0 + tankH * 0.21;
    const bowlOriginY = y0 + DEFAULT_TANK_PARAMS.bowlHeight + DEFAULT_TANK_PARAMS.bowlYOffset;
    expect(liquidCylinderHeight(holdingTop, bowlOriginY)).toBeGreaterThan(
      liquidCylinderHeight(holdingTop - DEFAULT_TANK_PARAMS.bowlHeight, bowlOriginY),
    );
  });

  it('aligns sphere phi with cylinder theta so the dome cut matches the body window', () => {
    const theta = Math.PI / 4;
    const phi = spherePhiFromCylinderTheta(theta);
    const r = 1;
    const cyl = { x: r * Math.sin(theta), z: r * Math.cos(theta) };
    const sph = { x: -r * Math.cos(phi), z: r * Math.sin(phi) };
    expect(sph.x).toBeCloseTo(cyl.x);
    expect(sph.z).toBeCloseTo(cyl.z);
  });

  it('keeps defaults that match the current scene tank', () => {
    expect(DEFAULT_TANK_PARAMS.innerRatio).toBeCloseTo(TANK_INNER_RATIO);
    expect(DEFAULT_TANK_PARAMS.radialSegments).toBe(15);
    expect(DEFAULT_TANK_PARAMS.cageThreshold).toBe(1);
    expect(DEFAULT_TANK_PARAMS.domeHeightSegments).toBe(3);
    expect(DEFAULT_TANK_PARAMS.domeHeight).toBeCloseTo(0.32);
    expect(DEFAULT_TANK_PARAMS.domeYOffset).toBeCloseTo(-0.02);
    expect(DEFAULT_TANK_PARAMS.bowlHeight).toBeCloseTo(0.24);
    expect(DEFAULT_TANK_PARAMS.bowlYOffset).toBe(0);
    expect(DEFAULT_TANK_PARAMS.bowlYOffset).toBeCloseTo(TANK_BOWL_Y_OFFSET);
    expect(DEFAULT_TANK_PARAMS.capHeightRatio).toBeCloseTo(0.14);
    expect(DEFAULT_TANK_PARAMS.capLineWidth).toBeCloseTo(1.5);
    expect(DEFAULT_TANK_PARAMS.lineWidth).toBeCloseTo(1.5);
    expect(DEFAULT_TANK_PARAMS.shoulderRatio).toBe(0);
    expect(DEFAULT_TANK_PARAMS.shoulderTopRatio).toBe(1);
    expect(DEFAULT_TANK_PARAMS.outerBowlHeight).toBe(0);
  });

  it('scales scene.json vessel height from the Shape Height slider', () => {
    expect(tunedVesselHeight(2.7)).toBeCloseTo(2.7);
    expect(tunedVesselHeight(2.7, { height: 6.1 })).toBeCloseTo(5.4);
  });

  it('drops the impeller shaftLength × tank height below the dome apex, clamped above the floor', () => {
    const short = mixerShaftLayout(2.7, mergeTankParams({ shaftLength: 0.5 }));
    const long = mixerShaftLayout(2.7, mergeTankParams({ shaftLength: 0.9 }));
    expect(long.shaftH).toBeGreaterThan(short.shaftH);
    expect(long.domeApex - long.impellerY).toBeCloseTo(2.7 * 0.9);
    // A slider past the floor clamps instead of running the blades through the heel.
    const through = mixerShaftLayout(2.7, mergeTankParams({ shaftLength: 1.5 }));
    expect(through.impellerY).toBeCloseTo(-1.35 + 2.7 * MIXER_IMPELLER_FLOOR_CLEARANCE);
    // Shaft always ends at the hub: no floating impeller at any length.
    for (const l of [0.1, 0.5, 0.9, 1.5]) {
      const lay = mixerShaftLayout(2.7, mergeTankParams({ shaftLength: l }));
      expect(lay.shaftBot).toBeCloseTo(lay.impellerY);
      expect(lay.shaftTop).toBeGreaterThan(lay.shaftBot);
    }
    expect(long.lidH).toBeCloseTo(DEFAULT_TANK_PARAMS.capLidThickness);
    const thick = mixerShaftLayout(2.7, mergeTankParams({ capLidThickness: 0.1 }));
    expect(thick.lidH).toBeCloseTo(0.1);
    expect(thick.lidTop).toBeGreaterThan(long.lidTop);
  });

  it('re-seats the hat and shaft on an explicit apex (flat / cone lids)', () => {
    const p = mergeTankParams({});
    const base = mixerShaftLayout(2.7, p);
    const raised = mixerShaftLayout(2.7, p, base.domeApex + 0.5);
    expect(raised.lidTop - base.lidTop).toBeCloseTo(0.5);
    expect(raised.shaftTop - base.shaftTop).toBeCloseTo(0.5);
    expect(raised.shaftBot).toBeCloseTo(raised.impellerY);
  });

  it('draws the hat as a drum, not a flat puck', () => {
    const hat = mixerHatLayout(2.7, mergeTankParams({ capRadiusRatio: 0.4 }));
    expect(hat.drumH / hat.capR).toBeCloseTo(MIXER_HAT_ASPECT);
    expect(hat.drumH).toBeGreaterThan(hat.lidH * 4);
    expect(hat.neckR).toBeLessThan(hat.capR);
    // Neck sinks into the dome so the hat never floats over a faceted apex.
    expect(hat.neckMidY - hat.neckH / 2).toBeLessThan(hat.domeApex);
  });

  it('keeps the mixer hat squat on the dome, not a chimney', () => {
    const hat = mixerHatLayout(2.7, mergeTankParams({ capHeightRatio: 0.14 }));
    expect(hat.neckH).toBeLessThan(2.7 * 0.14 * 0.5);
    expect(hat.neckH).toBeGreaterThan(0.02);
  });

  it.skipIf(!CHROMIUM)('serves sliders for meridians, dome, fill, and shade', async () => {
    const http = server.httpServer;
    if (!http) {
      throw new Error('vite did not bind a port');
    }
    const address = http.address();
    if (!address || typeof address === 'string') {
      throw new Error('vite did not bind a port');
    }
    const browser = await launchRenderBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`http://127.0.0.1:${address.port}/tank-tuner.html`);
      await page.getByTestId('tank-tuner').waitFor();
      await page.waitForSelector('canvas');
      expect(await page.getByTestId('tank-tuner').getAttribute('data-scene-id')).toBe('process-line');
      expect(await page.getByTestId('slider-labelAngleDeg').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-elbowCapDeg').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-elbowOffset').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-capLineWidth').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-shaftLength').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-capLidThickness').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-valveGlobe').isVisible()).toBe(true);
      expect(await page.getByTestId('show-pipes').isVisible()).toBe(true);
      expect(await page.getByTestId('show-valves').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-domeHeightSegments').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-domeHeight').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-domeYOffset').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-bowlHeight').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-bowlYOffset').isVisible()).toBe(true);
      expect(await page.getByTestId('slider-height').isVisible()).toBe(true);
      await page.getByTestId('slider-radialSegments').fill('16');
      const box = await page.locator('canvas').boundingBox();
      expect(box?.width).toBeGreaterThan(100);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
