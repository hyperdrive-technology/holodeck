/**
 * Every flange / ring must be perpendicular to its pipe axis (Des 2026-10-29,
 * reference.jpg rings). The rings are built along a local axis (pipe-geometry
 * along +Y; valve barrel along +X) and posed by a rotation; these tests apply
 * the real pose to the real geometry and check that each vertex keeps its
 * local axial coordinate along the world pipe direction, i.e. every ring
 * plane is perpendicular to the run.
 *
 * Regressions this pins: the whirlpool nozzle (was a group yaw + mesh roll
 * on X-axis cylinders, now `tankNozzlePose` + flange.ts `nozzleStubGeometry`) and
 * the steam-out nut (its Euler had a pi/12 yaw that tilted the nut 15° off
 * the +X run).
 */
import { describe, expect, it } from 'vitest';
import { BufferGeometry, CylinderGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { buildPipeGeometry } from './pipe-geometry';
import { NOZZLE_FLANGE_SCALE, flangeRingGeometry, nozzleStubGeometry } from './flange';
import { pipePose } from './pipe-math';
import { STEAM_NUT_LEN, STEAM_NUT_R, STEAM_NUT_ROT, STEAM_NUT_ROT_ORDER } from './EndCap';
import { sharedValveBody } from './valve-geometry';
import {
  DEFAULT_TANK_PARAMS,
  TANK_NOZZLE_JAMB_OFFSET,
  TANK_NOZZLE_LEAN,
  TANK_NOZZLE_RADIUS,
  mergeTankParams,
  tankLayout,
  tankNozzlePose,
  tankWindow,
} from './tank-params';
import { WHIRLPOOL_PRESET } from './tank-presets';
import { PROCESS_SCENE } from '../../src/iso/load-process-scene';
import { gridToWorld } from '../../src/iso/grid';

/**
 * For each vertex: axial coordinate after the pose (along `worldAxis`, from
 * `origin`) must equal its local coordinate along `localAxis`, and its
 * distance from the axis must be preserved. Both hold iff the pose maps
 * `localAxis` onto `worldAxis`, so every ring (constant local axial
 * coordinate) lands in a plane perpendicular to the world axis.
 */
function expectRingsPerpendicular(
  geometry: BufferGeometry,
  pose: Matrix4,
  localAxis: Vector3,
  worldAxis: Vector3,
) {
  const pos = geometry.getAttribute('position');
  const origin = new Vector3().setFromMatrixPosition(pose);
  const v = new Vector3();
  const w = new Vector3();
  const axisL = localAxis.clone().normalize();
  const axisW = worldAxis.clone().normalize();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const localAxial = v.dot(axisL);
    const localRadial = v.clone().addScaledVector(axisL, -localAxial).length();
    w.copy(v).applyMatrix4(pose).sub(origin);
    const worldAxial = w.dot(axisW);
    expect(worldAxial).toBeCloseTo(localAxial, 5);
    expect(w.clone().addScaledVector(axisW, -worldAxial).length()).toBeCloseTo(localRadial, 5);
  }
}

describe('tank nozzle flange', () => {
  const tankR = WHIRLPOOL_PRESET.radius;
  const p = mergeTankParams(WHIRLPOOL_PRESET.params);
  const { keepStart, keepLen } = tankWindow(p.windowDeg, p.windowYawDeg);
  const theta = keepStart + keepLen - TANK_NOZZLE_JAMB_OFFSET;
  const nozzleR = tankR * TANK_NOZZLE_RADIUS;
  const y0 = tankLayout(WHIRLPOOL_PRESET.height, tankR, p).y0;
  const pose = tankNozzlePose(tankR, theta, y0 + 0.4, 0.3, nozzleR);
  const axis = new Vector3(...pose.axis);
  const start = new Vector3(...pose.position);
  const end = start.clone().addScaledVector(axis, pose.length);

  it('the quaternion turns the geometry axis (+Y) onto the nozzle axis', () => {
    const y = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...pose.quaternion));
    expect(y.distanceTo(axis)).toBeLessThan(1e-9);
    expect(axis.y).toBeCloseTo(0);
    expect(axis.length()).toBeCloseTo(1);
  });

  it('leaves the wall outward, leaning TANK_NOZZLE_LEAN toward the tangent (away from the window)', () => {
    const normal = new Vector3(Math.sin(theta), 0, Math.cos(theta));
    const away = new Vector3(-Math.cos(theta), 0, Math.sin(theta));
    expect(axis.dot(normal)).toBeCloseTo(Math.cos(TANK_NOZZLE_LEAN));
    expect(axis.dot(away)).toBeCloseTo(Math.sin(TANK_NOZZLE_LEAN));
    expect(TANK_NOZZLE_LEAN).toBeGreaterThan(0);
    expect(TANK_NOZZLE_LEAN).toBeLessThan(Math.PI / 4);
  });

  it('every ring of the stub (tube + end flange) is perpendicular to the axis', () => {
    const geometry = nozzleStubGeometry({ length: pose.length, radius: nozzleR });
    const m = new Matrix4().compose(start, new Quaternion(...pose.quaternion), new Vector3(1, 1, 1));
    expectRingsPerpendicular(geometry, m, new Vector3(0, 1, 0), axis);
    geometry.dispose();
  });

  it('starts buried in the faceted shell (no open end shows) and sticks out the visible length', () => {
    const apothem = tankR * Math.cos(Math.PI / DEFAULT_TANK_PARAMS.radialSegments);
    // The tilted start disc reaches nozzleR * sin(lean) further out than its centre.
    expect(Math.hypot(start.x, start.z) + nozzleR * Math.sin(TANK_NOZZLE_LEAN)).toBeLessThan(apothem);
    expect(start.y).toBeCloseTo(y0 + 0.4);
    // `length` = buried part (to the circle of radius R) + the visible 0.3.
    const exit = start.clone().addScaledVector(axis, pose.length - 0.3);
    expect(Math.hypot(exit.x, exit.z)).toBeCloseTo(tankR, 6);
    expect(Math.hypot(end.x, end.z)).toBeGreaterThan(tankR + 0.2);
  });

  it('sits on the kept wall, clear of the window opening', () => {
    const w = tankWindow(p.windowDeg, p.windowYawDeg);
    const th = Math.atan2(start.x, start.z);
    const d = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
    expect(Math.min(d(th - w.windowStart), d(th - (w.windowStart + w.windowRad)))).toBeGreaterThan(0.3);
  });
});

describe('flange.ts primitives', () => {
  it('flangeRingGeometry is a ring of the given size centred at y on the +Y axis', () => {
    const g = flangeRingGeometry({ radius: 0.2, scale: 1.5, length: 0.1, sides: 8, y: 2 });
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(1.95);
    expect(b.max.y).toBeCloseTo(2.05);
    expect(Math.max(b.max.x, b.max.z)).toBeCloseTo(0.3);
    g.dispose();
  });

  it('nozzleStubGeometry runs from y 0 to length with a flush flange at the free end', () => {
    const g = nozzleStubGeometry({ length: 0.5, radius: 0.1 });
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(0.5);
    expect(b.max.x).toBeCloseTo(0.1 * NOZZLE_FLANGE_SCALE, 2);
    // The flange (widest vertices) only lives at the free end.
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i), pos.getZ(i)) > 0.11) expect(pos.getY(i)).toBeGreaterThan(0.45);
    }
    g.dispose();
  });
});

describe('routed pipe flanges and bands', () => {
  const runs: Array<[[number, number], [number, number]]> = [
    [[0, 0], [3, 0]],
    [[0, 0], [0, 3]],
    [[2, 1], [-1, 1]],
    [[1, 4], [1, -2]],
  ];

  it.each(runs)('pipePose %j -> %j maps the pipe geometry axis onto the run', (from, to) => {
    const pose = pipePose(from, to);
    const dir = new Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
    const m = new Matrix4().compose(
      new Vector3(...pose.mid),
      new Quaternion().setFromEuler(new Euler(...pose.rotation, pose.rotationOrder)),
      new Vector3(1, 1, 1),
    );
    const geometry = buildPipeGeometry({ length: pose.length, ends: { from: 'flange', to: 'flange' } });
    expectRingsPerpendicular(geometry, m, new Vector3(0, 1, 0), dir);
    geometry.dispose();
  });

  it.each(runs)('Pipe.tsx band ring %j -> %j: group yaw + X roll keeps the band on the run axis', (from, to) => {
    // Pipe.tsx: <group rotation=[0, yaw, 0]> <mesh rotation=[pi/2, 0, 0]> <cylinderGeometry .../>
    const { yaw } = pipePose(from, to);
    const dir = new Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
    const m = new Matrix4()
      .makeRotationFromEuler(new Euler(0, yaw, 0))
      .multiply(new Matrix4().makeRotationFromEuler(new Euler(Math.PI / 2, 0, 0)));
    const band = new CylinderGeometry(0.22, 0.22, 0.05, 6);
    expectRingsPerpendicular(band, m, new Vector3(0, 1, 0), dir);
    band.dispose();
  });
});

describe('steam-out nut', () => {
  it('is coaxial with its +X run (no yaw off the pipe)', () => {
    const steam = PROCESS_SCENE.objects.find((o) => o.id === 'pipe-steam-out-b');
    expect(steam).toBeDefined();
    const [ax, , az] = gridToWorld(steam!.x, steam!.y);
    const [bx, , bz] = gridToWorld(steam!.toX!, steam!.toY!);
    const dir = new Vector3(bx - ax, 0, bz - az).normalize();
    const m = new Matrix4().makeRotationFromEuler(new Euler(...STEAM_NUT_ROT, STEAM_NUT_ROT_ORDER));
    const nut = new CylinderGeometry(STEAM_NUT_R, STEAM_NUT_R, STEAM_NUT_LEN, 6);
    expectRingsPerpendicular(nut, m, new Vector3(0, 1, 0), dir);
    nut.dispose();
  });
});

describe('valve flanges', () => {
  // valve-geometry.ts builds the barrel + flanges along local +X; valvePose (InstancedLibrary) yaws by
  // placement.rotation. Every valve sitting on a pipe must line its flanges up with that pipe.
  const pipes = new Map(PROCESS_SCENE.objects.filter((o) => o.object === 'pipe').map((o) => [o.id, o]));
  const onPipe = PROCESS_SCENE.objects.filter((o) => o.object === 'valve' && o.onPipe);

  it('the scene has valves on pipes to check', () => {
    expect(onPipe.length).toBeGreaterThan(2);
  });

  it.each(onPipe.map((v) => [v.id, v] as const))('%s flanges are perpendicular to its pipe', (_id, valve) => {
    const pipe = pipes.get(valve.onPipe!);
    expect(pipe).toBeDefined();
    const [ax, , az] = gridToWorld(pipe!.x, pipe!.y);
    const [bx, , bz] = gridToWorld(pipe!.toX!, pipe!.toY!);
    const dir = new Vector3(bx - ax, 0, bz - az).normalize();
    const m = new Matrix4().makeRotationFromEuler(new Euler(0, valve.rotation ?? 0, 0));
    // The barrel axis is local +X; a flange is perpendicular iff +X maps onto +-dir.
    const x = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(Math.abs(x.dot(dir))).toBeCloseTo(1);
    expect(sharedValveBody().getAttribute('position').count).toBeGreaterThan(0);
  });
});
