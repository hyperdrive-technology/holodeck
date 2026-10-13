import { describe, expect, it } from 'vitest';
import { EdgesGeometry } from 'three';
import { buildPipeGeometry } from './pipe-geometry';
import { buildValveBodyGeometry, buildValveWheelGeometry, VALVE_WHEEL_Y } from './valve-geometry';
import { ELBOW_OFFSET, ELBOW_RADIUS, PIPE_FLANGE_SCALE, PIPE_RADIUS, PIPE_SIDES, elbowOffsetShift, trimRun } from './pipe-math';
import { HOLODECK_STYLE } from './style';

describe('buildPipeGeometry', () => {
  it('spans the run length along Y, centred, with flanges poking half a flange past each end', () => {
    const g = buildPipeGeometry({ length: 3 });
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeGreaterThan(1.5);
    expect(g.boundingBox!.max.y).toBeCloseTo(-g.boundingBox!.min.y, 6);
    // Z carries the sin/cos vertex at theta = 0 for any side count (X only reaches r*sin(60deg) on a hexagon).
    expect(g.boundingBox!.max.z).toBeCloseTo(PIPE_RADIUS * PIPE_FLANGE_SCALE, 2);
  });

  it('adds interior joint rings, so the outline has more edges on a long run than a short one', () => {
    const edges = (len: number) =>
      new EdgesGeometry(buildPipeGeometry({ length: len, endFlanges: false }), HOLODECK_STYLE.edges.thresholds.pipe).getAttribute('position').count;
    expect(edges(4)).toBeGreaterThan(edges(0.8));
  });

  it('survives a zero-length run', () => {
    expect(() => buildPipeGeometry({ length: 0 })).not.toThrow();
  });
});

describe('valve geometry', () => {
  it('puts the handwheel above the body, on the stem', () => {
    const body = buildValveBodyGeometry();
    body.computeBoundingBox();
    const wheel = buildValveWheelGeometry();
    wheel.computeBoundingBox();
    expect(body.boundingBox!.max.y).toBeLessThanOrEqual(VALVE_WHEEL_Y + 1e-6); // stem ends inside the wheel centre
    expect(wheel.boundingBox!.min.y).toBeGreaterThan(body.boundingBox!.max.y - 0.5);
    expect(wheel.boundingBox!.max.y).toBeGreaterThan(VALVE_WHEEL_Y);
  });

  it('lays the barrel along X (pipe axis) and is wider than the pipe', () => {
    const body = buildValveBodyGeometry();
    body.computeBoundingBox();
    expect(body.boundingBox!.max.x).toBeGreaterThan(body.boundingBox!.max.z);
    expect(body.boundingBox!.max.z).toBeGreaterThan(PIPE_RADIUS);
  });
});

describe('elbow centring', () => {
  it('puts the torus mouths exactly where trimRun ends the adjoining pipes (yaw 0: runs go -X and -Z)', () => {
    const [ox, oz] = elbowOffsetShift(0, ELBOW_OFFSET);
    // Torus after Rx(pi/2): mouths at centre + (R,0,0) and centre + (0,0,R).
    const mouthA: [number, number] = [ox + ELBOW_RADIUS, oz];
    const mouthB: [number, number] = [ox, oz + ELBOW_RADIUS];
    const runX = trimRun([-3, 0], [0, 0], false, true).to; // arrives from -X
    const runZ = trimRun([0, -3], [0, 0], false, true).to; // arrives from -Z
    expect(mouthB[0]).toBeCloseTo(runX[0]);
    expect(mouthB[1]).toBeCloseTo(runX[1]);
    expect(mouthA[0]).toBeCloseTo(runZ[0]);
    expect(mouthA[1]).toBeCloseTo(runZ[1]);
  });

  it('keeps the elbow crease threshold under the 15 degree sweep step', () => {
    expect(HOLODECK_STYLE.edges.thresholds.elbow).toBeLessThan(90 / 6);
  });
});

describe('pipe joint bump (round 3)', () => {
  it('has foot creases below and crest creases above the pipe threshold, so one line draws per joint', async () => {
    const { PIPE_RING_FOOT_DEG, PIPE_RING_CREST_DEG } = await import('./pipe-math');
    const t = HOLODECK_STYLE.edges.thresholds.pipe;
    expect(PIPE_RING_FOOT_DEG).toBeLessThan(t);
    expect(PIPE_RING_CREST_DEG).toBeGreaterThan(t);
  });

  it('draws exactly one horizontal ring per interior joint (crest only, no foot lines), PIPE_SIDES segments each', () => {
    const t = HOLODECK_STYLE.edges.thresholds.pipe;
    const len = 3; // 3 cells -> 3 segments -> interior joints at y = -0.5 and +0.5
    const pos = new EdgesGeometry(buildPipeGeometry({ length: len, endFlanges: false }), t).getAttribute('position');
    const rings = new Map<string, number>();
    for (let i = 0; i < pos.count; i += 2) {
      const y0 = pos.getY(i);
      const y1 = pos.getY(i + 1);
      if (Math.abs(y0 - y1) > 1e-6 || Math.abs(Math.abs(y0) - len / 2) < 1e-3) continue; // skip longitudinal + end caps
      const key = y0.toFixed(3);
      rings.set(key, (rings.get(key) ?? 0) + 1);
    }
    expect([...rings.keys()].sort()).toEqual(['-0.500', '0.500']);
    expect([...rings.values()]).toEqual([PIPE_SIDES, PIPE_SIDES]);
  });
});
