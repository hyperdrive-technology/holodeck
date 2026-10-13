import { describe, expect, it } from 'vitest';
import { ELBOW_RADIUS, PIPE_GRID_GAP, PIPE_RADIUS, PIPE_WIRE_WIDTH, elbowOffsetShift, elbowYawForDirs, pipePose, pipeWorldY, trimRun } from '../../assets/process/pipe-math';

describe('trimRun', () => {
  it('shortens both ends of a horizontal run by the torus radius', () => {
    const { from, to } = trimRun([0, 0], [4, 0], true, true);
    expect(from[0]).toBeCloseTo(ELBOW_RADIUS);
    expect(from[1]).toBeCloseTo(0);
    expect(to[0]).toBeCloseTo(4 - ELBOW_RADIUS);
    expect(to[1]).toBeCloseTo(0);
  });

  it('leaves a run alone when neither end is a bend', () => {
    expect(trimRun([0, 0], [4, 0], false, false)).toEqual({ from: [0, 0], to: [4, 0] });
  });

  it('does not invert a short segment', () => {
    const { from, to } = trimRun([0, 0], [0.2, 0], true, true, 0.4);
    expect(from).toEqual([0, 0]);
    expect(to).toEqual([0.2, 0]);
  });
});

describe('pipePose', () => {
  it('lifts the bore above the grid so the tube does not sit on y=0', () => {
    const { mid } = pipePose([0, 0], [4, 0]);
    expect(mid[1]).toBeCloseTo(pipeWorldY());
    expect(mid[1]).toBeGreaterThan(PIPE_RADIUS);
    expect(pipeWorldY() - PIPE_RADIUS).toBeCloseTo(PIPE_GRID_GAP, 10);
  });

  it('uses Line2 pixel width so pipe mesh edges are thicker than WebGL’s 1px wireframe', () => {
    expect(PIPE_WIRE_WIDTH).toBeCloseTo(1.5);
  });
});

describe('elbowYawForDirs (deprecated; see routing/elbows.ts)', () => {
  it('returns the true yaw whose arms are the two run directions (rest pose n + w)', () => {
    expect(elbowYawForDirs(-1, 0, 0, -1)).toBeCloseTo(0); // w + n
    expect(elbowYawForDirs(1, 0, 0, 1)).toBeCloseTo(Math.PI); // e + s
    expect(elbowYawForDirs(0, 1, -1, 0)).toBeCloseTo(Math.PI / 2); // s + w
    expect(elbowYawForDirs(-1, 0, 0, 1)).toBeCloseTo(Math.PI / 2); // w + s
    // Steam-out at the green valve: riser toward -Y (n), stub toward +X (e).
    expect(elbowYawForDirs(0, -1, 1, 0)).toBeCloseTo(-Math.PI / 2);
  });
  it('returns 0 for a straight pair', () => {
    expect(elbowYawForDirs(1, 0, -1, 0)).toBe(0);
  });
});

describe('elbowOffsetShift', () => {
  it('slides along the default +X/+Z mouth bisector at yaw 0', () => {
    expect(elbowOffsetShift(0, 0)).toEqual([0, 0]);
    const [x, z] = elbowOffsetShift(0, Math.SQRT2);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(1);
  });
});
