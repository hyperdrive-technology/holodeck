import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  cameraBasis,
  cameraOffset,
  clampZoom,
  classifyWheel,
  MAX_ZOOM,
  MIN_ZOOM,
  panTarget,
  screenDeltaToTargetDelta,
  wheelZoomFactor,
  WHEEL_ZOOM_STEP,
  zoomAtScreenPoint,
} from './pan';
import { initialIsoPose, rotatePose, toggleTopDown, type IsoPose } from './pose';
import type { Vector3Tuple } from 'three';

const W = 800;
const H = 600;
const HOME = initialIsoPose(18);
const YAW_SNAPS: Array<[string, IsoPose]> = [0, 1, 2, 3].map((k) => {
  let p = HOME;
  for (let i = 0; i < k; i++) p = rotatePose(p, 1);
  return [`iso yaw snap ${k}`, p];
});
const TOP_DOWN_SNAPS: Array<[string, IsoPose]> = YAW_SNAPS.map(([name, p]) => [
  `2D from ${name}`,
  toggleTopDown(p, HOME.radius),
]);
const ALL_POSES = [...YAW_SNAPS, ...TOP_DOWN_SNAPS];

/**
 * The real camera IsoRig builds: R3F sizes the ortho frustum in CSS px, so
 * `zoom` = px per world unit. Projects a world point to CSS px (+y down).
 */
function camera(pose: IsoPose, zoom: number, target: Vector3Tuple): OrthographicCamera {
  const cam = new OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.5, 4000);
  const [x, y, z] = cameraOffset(pose);
  cam.position.set(x + target[0], y + target[1], z + target[2]);
  cam.lookAt(target[0], target[1], target[2]);
  cam.zoom = zoom;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

function toScreen(cam: OrthographicCamera, p: Vector3Tuple): [number, number] {
  const v = new Vector3(...p).project(cam);
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
}

const PROBES: Vector3Tuple[] = [
  [0, 0, 0],
  [3.5, 0, -2],
  [-4, 2.5, 1], // a point up a tank wall: ortho pans move every height equally
];

describe('screen-space pan', () => {
  it.each(ALL_POSES)('%s: world points follow the pointer exactly', (_name, pose) => {
    const zoom = 30;
    const target: Vector3Tuple = [1.2, 1.28, -0.7];
    const before = camera(pose, zoom, target);
    const [dx, dy] = [37, -21];
    const next = panTarget(target, pose, zoom, dx, dy);
    const after = camera(pose, zoom, next);
    for (const p of PROBES) {
      const [x0, y0] = toScreen(before, p);
      const [x1, y1] = toScreen(after, p);
      expect(x1 - x0).toBeCloseTo(dx, 4);
      expect(y1 - y0).toBeCloseTo(dy, 4);
    }
  });

  it.each(ALL_POSES)('%s: never changes the target height', (_name, pose) => {
    const d = screenDeltaToTargetDelta(pose, 20, 120, 80);
    expect(d[1]).toBe(0);
    expect(panTarget([0, 1.28, 0], pose, 20, -50, 300)[1]).toBe(1.28);
  });

  it.each(ALL_POSES)('%s: pure horizontal drag moves along screen-right only', (_name, pose) => {
    const { right } = cameraBasis(pose);
    const d = screenDeltaToTargetDelta(pose, 10, 50, 0);
    // Opposite to screen-right, length = px / zoom.
    expect(d[0]).toBeCloseTo(-right[0] * 5, 9);
    expect(d[2]).toBeCloseTo(-right[2] * 5, 9);
  });

  it('scales with 1 / zoom', () => {
    const a = screenDeltaToTargetDelta(HOME, 10, 40, 25);
    const b = screenDeltaToTargetDelta(HOME, 40, 40, 25);
    expect(b[0]).toBeCloseTo(a[0] / 4, 9);
    expect(b[2]).toBeCloseTo(a[2] / 4, 9);
  });

  it('is linear: two half drags equal one full drag', () => {
    const t: Vector3Tuple = [0, 1, 0];
    const once = panTarget(t, HOME, 25, 60, -40);
    const twice = panTarget(panTarget(t, HOME, 25, 30, -20), HOME, 25, 30, -20);
    once.forEach((v, i) => expect(twice[i]).toBeCloseTo(v, 9));
  });

  it('a zero drag is a no-op', () => {
    for (const [, pose] of ALL_POSES) {
      const d = screenDeltaToTargetDelta(pose, 20, 0, 0);
      expect(Math.abs(d[0]) + Math.abs(d[2])).toBe(0);
    }
  });

  it('iso vertical drags travel further on the ground than 2D ones (foreshortening)', () => {
    const iso = screenDeltaToTargetDelta(HOME, 10, 0, 10);
    const flat = screenDeltaToTargetDelta(toggleTopDown(HOME, HOME.radius), 10, 0, 10);
    expect(Math.hypot(flat[0], flat[2])).toBeCloseTo(1, 6);
    // 1 / sin(35.26 deg) = sqrt(3)
    expect(Math.hypot(iso[0], iso[2])).toBeCloseTo(Math.sqrt(3), 4);
  });

  it('screen-right is horizontal and unit length for every pose', () => {
    for (const [, pose] of ALL_POSES) {
      const { right, up, forward } = cameraBasis(pose);
      expect(right[1]).toBe(0);
      expect(Math.hypot(...right)).toBeCloseTo(1, 9);
      expect(Math.hypot(...up)).toBeCloseTo(1, 9);
      expect(right[0] * forward[0] + right[2] * forward[2]).toBeCloseTo(0, 9);
    }
  });
});

describe('camera offset', () => {
  it('matches three.js lookAt fallback for the default 2D pose, so the default 2D view is unchanged', () => {
    const flat = toggleTopDown(HOME, HOME.radius);
    const nudged = camera(flat, 20, [0, 0, 0]);
    const raw = new OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.5, 4000);
    raw.position.set(0, flat.height, 0); // radius 0: degenerate lookAt
    raw.lookAt(0, 0, 0);
    raw.updateMatrixWorld();
    nudged.quaternion.toArray().forEach((v, i) => expect(raw.quaternion.toArray()[i]).toBeCloseTo(v, 3));
  });

  it('2D views rotate with the yaw', () => {
    const a = cameraBasis(toggleTopDown(YAW_SNAPS[0]![1], HOME.radius)).right;
    const b = cameraBasis(toggleTopDown(YAW_SNAPS[1]![1], HOME.radius)).right;
    expect(a[0] * b[0] + a[2] * b[2]).toBeCloseTo(0, 6);
  });
});

describe('zoom about a screen point', () => {
  it.each(ALL_POSES)('%s: keeps the point under the cursor fixed', (_name, pose) => {
    const target: Vector3Tuple = [2, 1.28, -1];
    const zoom = 20;
    const cursor: [number, number] = [W / 2 + 150, H / 2 - 90];
    const before = camera(pose, zoom, target);
    // World point on the target's height plane that sits under the cursor.
    const ndc = new Vector3((cursor[0] / W) * 2 - 1, 1 - (cursor[1] / H) * 2, 0).unproject(before);
    const res = zoomAtScreenPoint(target, pose, zoom, zoom * 1.5, cursor[0] - W / 2, cursor[1] - H / 2);
    expect(res.zoom).toBe(30);
    expect(res.target[1]).toBe(target[1]);
    const after = camera(pose, res.zoom, res.target);
    const [x, y] = toScreen(after, [ndc.x, ndc.y, ndc.z]);
    expect(x).toBeCloseTo(cursor[0], 3);
    expect(y).toBeCloseTo(cursor[1], 3);
  });

  it('zooming at the canvas centre leaves the target alone', () => {
    const t: Vector3Tuple = [1, 1, 1];
    expect(zoomAtScreenPoint(t, HOME, 20, 24, 0, 0).target).toEqual([1, 1, 1]);
  });

  it('clamps, and does not drift the target once the clamp is hit', () => {
    const t: Vector3Tuple = [1, 1, 1];
    const atMax = zoomAtScreenPoint(t, HOME, MAX_ZOOM, MAX_ZOOM * 2, 200, 100);
    expect(atMax.zoom).toBe(MAX_ZOOM);
    expect(atMax.target).toBe(t);
    expect(zoomAtScreenPoint(t, HOME, 10, 1, 0, 0).zoom).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
  });
});

describe('wheel mapping', () => {
  const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false };

  it('pinch (ctrlKey) zooms smoothly in proportion to deltaY', () => {
    expect(classifyWheel({ ...base, deltaY: 3.2, ctrlKey: true })).toBe('pinch');
    expect(classifyWheel({ ...base, deltaY: -100, ctrlKey: true, wheelDeltaY: 120 })).toBe('pinch');
    expect(wheelZoomFactor('pinch', -10)).toBeCloseTo(Math.exp(0.1), 9);
    expect(wheelZoomFactor('pinch', 10)).toBeLessThan(1);
    expect(wheelZoomFactor('pinch', 0)).toBe(1);
  });

  it('two-finger trackpad scroll pans', () => {
    // Chromium trackpad: wheelDeltaY === -3 * deltaY, fractional deltas, deltaX present.
    expect(classifyWheel({ ...base, deltaY: 4, wheelDeltaY: -12 })).toBe('pan');
    expect(classifyWheel({ ...base, deltaY: 40, wheelDeltaY: -120 })).toBe('pan');
    expect(classifyWheel({ ...base, deltaX: 3, deltaY: 0.5 })).toBe('pan');
    expect(classifyWheel({ ...base, deltaY: 2.5 })).toBe('pan');
    expect(classifyWheel({ ...base, deltaY: 100, shiftKey: true, wheelDeltaY: 120 })).toBe('pan');
  });

  it('a mouse wheel notch zooms by the fixed step', () => {
    expect(classifyWheel({ ...base, deltaY: 100, wheelDeltaY: -120 })).toBe('zoom');
    expect(classifyWheel({ ...base, deltaY: -125, wheelDeltaY: 150 })).toBe('zoom');
    expect(classifyWheel({ ...base, deltaY: 3, deltaMode: 1 })).toBe('zoom');
    expect(classifyWheel({ ...base, deltaY: 100 })).toBe('zoom');
    expect(wheelZoomFactor('zoom', 100)).toBeCloseTo(1 / WHEEL_ZOOM_STEP, 9);
    expect(wheelZoomFactor('zoom', -100)).toBe(WHEEL_ZOOM_STEP);
  });
});
