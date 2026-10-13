import { describe, expect, it } from 'vitest';
import {
  ISO_VIEW_DISTANCE,
  initialIsoPose,
  posePosition,
  rotatePose,
  toggleTopDown,
} from './pose';

describe('iso pose', () => {
  it('starts on the space diagonal (D, D, D)', () => {
    const pose = initialIsoPose();
    const [x, y, z] = posePosition(pose);
    expect(y).toBe(ISO_VIEW_DISTANCE);
    expect(x).toBeCloseTo(ISO_VIEW_DISTANCE, 6);
    expect(z).toBeCloseTo(ISO_VIEW_DISTANCE, 6);
  });

  it('rotates in 90° steps without changing height or radius', () => {
    const start = initialIsoPose(12);
    const turned = rotatePose(start, 1);
    expect(turned.height).toBe(start.height);
    expect(turned.radius).toBeCloseTo(start.radius);
    expect(turned.yaw - start.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('collapses to a top-down camera and yaws +45°', () => {
    const iso = initialIsoPose(12);
    const flat = toggleTopDown(iso, iso.radius);
    expect(flat.radius).toBe(0);
    expect(flat.height).toBe(iso.height);
    expect(flat.yaw).toBeCloseTo(iso.yaw + Math.PI / 4);
    const back = toggleTopDown(flat, iso.radius);
    expect(back.radius).toBeCloseTo(iso.radius);
    expect(back.yaw).toBeCloseTo(iso.yaw);
  });
});
