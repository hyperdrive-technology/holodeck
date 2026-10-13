import { Euler, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ELBOW_RADIUS, elbowInstancePose, elbowYawForDirs } from '../../assets/process/pipe-math';
import type { IsoPlacement } from '../iso/scene';
import {
  ELBOW_REST_ARMS,
  checkElbows,
  elbowArms,
  elbowRotationForArms,
  headingOf,
  inferElbowRotation,
  isAutoElbow,
  isQuarterTurn,
  pipeArmsAt,
  resolveAutoElbows,
  sameElbowRotation,
} from './elbows';
import { HEADINGS, HEADING_VECTOR, rotateHeading, type Heading } from './grid';

const pipe = (id: string, x: number, y: number, toX: number, toY: number): IsoPlacement => ({
  id,
  object: 'pipe',
  x,
  y,
  toX,
  toY,
});
const elbow = (id: string, x: number, y: number, rotation?: number, auto = false): IsoPlacement => ({
  id,
  object: 'elbow',
  x,
  y,
  ...(rotation === undefined ? {} : { rotation }),
  ...(auto ? { params: { bend: 'auto' } } : {}),
});

/** An L at (0,0) whose pipes leave toward `a` and `b`, 3 cells each. */
const lAt = (a: Heading, b: Heading): IsoPlacement[] =>
  [a, b].map((h, i) => pipe(`p${i}`, 0, 0, HEADING_VECTOR[h].x * 3, HEADING_VECTOR[h].y * 3));

describe('elbow rotation table (all 8 ordered perpendicular pairs)', () => {
  const cases: Array<[Heading, Heading, number]> = [
    ['n', 'w', 0],
    ['w', 'n', 0],
    ['s', 'w', Math.PI / 2],
    ['w', 's', Math.PI / 2],
    ['s', 'e', Math.PI],
    ['e', 's', Math.PI],
    ['n', 'e', -Math.PI / 2],
    ['e', 'n', -Math.PI / 2],
  ];
  it.each(cases)('%s + %s -> %f', (a, b, rotation) => {
    expect(elbowRotationForArms(a, b)).toBe(rotation);
  });

  it('round-trips through elbowArms', () => {
    for (const [a, b, rotation] of cases) {
      expect(new Set(elbowArms(rotation))).toEqual(new Set([a, b]));
    }
  });

  it('equals the rest pose yawed like every other part (rotateHeading)', () => {
    for (const q of [0, 1, 2, 3, -1, 5]) {
      const r = (q * Math.PI) / 2;
      const yawed = ELBOW_REST_ARMS.map((h) => rotateHeading(h, r));
      expect(sameElbowRotation(elbowRotationForArms(yawed[0]!, yawed[1]!)!, r)).toBe(true);
    }
  });

  it('agrees with the legacy pipe-math elbowYawForDirs for every pair', () => {
    for (const [a, b, rotation] of cases) {
      const va = HEADING_VECTOR[a];
      const vb = HEADING_VECTOR[b];
      expect(elbowYawForDirs(va.x, va.y, vb.x, vb.y)).toBe(rotation);
    }
  });

  it('has no elbow for straight or doubled-back pairs', () => {
    for (const h of HEADINGS) {
      expect(elbowRotationForArms(h, h)).toBeNull();
      expect(elbowRotationForArms(h, rotateHeading(h, Math.PI))).toBeNull();
    }
  });

  it('elbowArms accepts any whole turn and rejects off-grid yaws', () => {
    expect(new Set(elbowArms(2 * Math.PI))).toEqual(new Set(['n', 'w']));
    expect(new Set(elbowArms((3 * Math.PI) / 2))).toEqual(new Set(['n', 'e']));
    expect(() => elbowArms(Math.PI / 4)).toThrow(RangeError);
    expect(() => elbowArms(Number.NaN)).toThrow(RangeError);
    expect(isQuarterTurn(-Math.PI / 2)).toBe(true);
    expect(isQuarterTurn(0.1)).toBe(false);
    expect(sameElbowRotation(Math.PI / 2, (-3 * Math.PI) / 2)).toBe(true);
    expect(sameElbowRotation(Math.PI / 2, -Math.PI / 2)).toBe(false);
  });
});

describe('the geometry really joins those arms', () => {
  /**
   * Build the pooled elbow's world transform and push the two torus mouths
   * through it. TorusGeometry sweeps from local +X (u = 0) to +Y (u = pi/2) at
   * the major radius; each mouth must land ELBOW_RADIUS from the corner along
   * one arm, i.e. exactly where `trimRun` ends the adjoining pipe.
   */
  const mouths = (yaw: number): Array<[number, number]> => {
    const pose = elbowInstancePose(0, 0, yaw);
    const m = new Matrix4().makeRotationFromEuler(new Euler(...pose.rotation, pose.rotationOrder));
    m.setPosition(pose.position[0], 0, pose.position[2]);
    return [new Vector3(ELBOW_RADIUS, 0, 0), new Vector3(0, ELBOW_RADIUS, 0)].map((v) => {
      const w = v.applyMatrix4(m);
      expect(Math.abs(w.y)).toBeLessThan(1e-9); // flat on the floor plane, never standing up
      return [w.x, w.z];
    });
  };

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('yaw %f puts both mouths on its arms', (yaw) => {
    const want = elbowArms(yaw).map((h) => [HEADING_VECTOR[h].x * ELBOW_RADIUS, HEADING_VECTOR[h].y * ELBOW_RADIUS]);
    const got = mouths(yaw);
    for (const [x, z] of got) {
      expect(want.some(([wx, wz]) => Math.abs(wx! - x) < 1e-9 && Math.abs(wz! - z) < 1e-9)).toBe(true);
    }
    expect(Math.hypot(got[0]![0] - got[1]![0], got[0]![1] - got[1]![1])).toBeCloseTo(ELBOW_RADIUS * Math.SQRT2);
  });

  it('the old XYZ order stood a +-pi/2 bend on its end (regression guard)', () => {
    const m = new Matrix4().makeRotationFromEuler(new Euler(Math.PI / 2, Math.PI / 2, 0, 'XYZ'));
    const mouth = new Vector3(ELBOW_RADIUS, 0, 0).applyMatrix4(m);
    expect(Math.abs(mouth.y)).toBeCloseTo(ELBOW_RADIUS);
  });
});

describe('headingOf', () => {
  it('maps axis vectors to the grid compass (n = -y)', () => {
    expect(headingOf(0, -2)).toBe('n');
    expect(headingOf(3.5, 0)).toBe('e');
    expect(headingOf(0, 0.2)).toBe('s');
    expect(headingOf(-1, 0)).toBe('w');
  });
  it('rejects zero-length and diagonal vectors', () => {
    expect(headingOf(0, 0)).toBeNull();
    expect(headingOf(1, 1)).toBeNull();
    expect(headingOf(1e-9, 0)).toBeNull();
  });
});

describe('inferElbowRotation', () => {
  it.each([
    ['n', 'w'],
    ['s', 'w'],
    ['s', 'e'],
    ['n', 'e'],
  ] as Array<[Heading, Heading]>)('reads %s + %s from the pipes', (a, b) => {
    const r = inferElbowRotation(lAt(a, b), { x: 0, y: 0 });
    expect(r).toMatchObject({ ok: true, rotation: elbowRotationForArms(a, b) });
  });

  it('reads arms from either pipe end (from or to on the cell)', () => {
    const objects = [pipe('in', 4, 8, 7, 8), pipe('up', 7, 8, 7, 5)];
    expect(inferElbowRotation(objects, { x: 7, y: 8 })).toMatchObject({ ok: true, rotation: 0, arms: ['n', 'w'] });
  });

  it('matches decimal coordinates within epsilon', () => {
    const objects = [pipe('a', 18.1, 5, 21, 5), pipe('b', 21, 5 + 1e-9, 21, 8)];
    expect(inferElbowRotation(objects, { x: 21, y: 5 })).toMatchObject({ ok: true, rotation: Math.PI / 2 });
  });

  it('a straight run needs no elbow', () => {
    expect(inferElbowRotation(lAt('e', 'w'), { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'straight' });
    expect(inferElbowRotation(lAt('n', 'n'), { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'straight' });
  });

  it('reports cells that are not a clean L', () => {
    expect(inferElbowRotation([], { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'no-pipes' });
    expect(inferElbowRotation([pipe('a', 0, 0, 3, 0)], { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'one-pipe' });
    const tee = [...lAt('n', 'w'), pipe('p2', 0, 0, 3, 0)];
    expect(inferElbowRotation(tee, { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'junction' });
    const diag = [pipe('a', 0, 0, 2, 2), pipe('b', 0, 0, -3, 0)];
    expect(inferElbowRotation(diag, { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'not-axis-aligned' });
    const zero = [pipe('a', 0, 0, 0, 0), pipe('b', 0, 0, -3, 0)];
    expect(inferElbowRotation(zero, { x: 0, y: 0 })).toMatchObject({ ok: false, reason: 'not-axis-aligned' });
  });

  it('ignores a pipe that only passes through the cell, and non-pipe parts', () => {
    const objects = [pipe('through', -3, 0, 3, 0), pipe('up', 0, 0, 0, -3), { id: 'v', object: 'valve', x: 0, y: 0 }];
    expect(pipeArmsAt(objects, { x: 0, y: 0 })).toEqual([{ pipeId: 'up', heading: 'n' }]);
  });
});

describe('resolveAutoElbows', () => {
  it('fills in auto elbows and leaves manual ones and knuckles alone', () => {
    const objects = [
      pipe('a', 4, 8, 7, 8),
      pipe('b', 7, 8, 7, 5),
      elbow('auto', 7, 8, undefined, true),
      elbow('manual', 7, 8, Math.PI),
      elbow('knuckle', 4, 8),
    ];
    const out = resolveAutoElbows(objects);
    expect(out.find((o) => o.id === 'auto')?.rotation).toBe(0);
    expect(out.find((o) => o.id === 'manual')?.rotation).toBe(Math.PI);
    expect(out.find((o) => o.id === 'knuckle')?.rotation).toBeUndefined();
    expect(objects[2]?.rotation).toBeUndefined(); // input untouched
  });

  it('auto overrides a stale numeric rotation', () => {
    const out = resolveAutoElbows([...lAt('s', 'e'), elbow('e', 0, 0, 0, true)]);
    expect(out[2]?.rotation).toBe(Math.PI);
  });

  it('an unresolvable auto elbow becomes a knuckle (no rotation)', () => {
    const out = resolveAutoElbows([pipe('a', 0, 0, 3, 0), elbow('e', 0, 0, 1, true)]);
    expect(out[1]).not.toHaveProperty('rotation');
  });

  it('returns the same array when there is nothing to resolve', () => {
    const objects = [...lAt('n', 'w'), elbow('e', 0, 0, 0)];
    expect(resolveAutoElbows(objects)).toBe(objects);
  });

  it('isAutoElbow only matches elbows', () => {
    expect(isAutoElbow({ id: 'p', object: 'pipe', x: 0, y: 0, params: { bend: 'auto' } })).toBe(false);
    expect(isAutoElbow(elbow('e', 0, 0, undefined, true))).toBe(true);
    expect(isAutoElbow(elbow('e', 0, 0, 0))).toBe(false);
  });
});

describe('checkElbows', () => {
  it('passes a correct L', () => {
    expect(checkElbows([...lAt('n', 'e'), elbow('e', 0, 0, -Math.PI / 2)])).toEqual([]);
    expect(checkElbows([...lAt('n', 'e'), elbow('e', 0, 0, (3 * Math.PI) / 2)])).toEqual([]);
  });

  it('flags a bend pointing the wrong way, with the rotation it wants', () => {
    const [issue] = checkElbows([...lAt('s', 'e'), elbow('e', 0, 0, 0)]);
    expect(issue).toMatchObject({ id: 'e', kind: 'mismatch', expected: Math.PI, actual: 0 });
  });

  it('flags off-grid rotations and bends that are not on an L', () => {
    expect(checkElbows([...lAt('s', 'e'), elbow('e', 0, 0, 0.3)])[0]).toMatchObject({ kind: 'not-right-angle' });
    expect(checkElbows([...lAt('e', 'w'), elbow('e', 0, 0, 0)])[0]).toMatchObject({ kind: 'unresolved' });
    expect(checkElbows([...lAt('e', 'w'), elbow('e', 0, 0, undefined, true)])[0]).toMatchObject({
      kind: 'unresolved',
      actual: 'auto',
    });
  });

  it('skips knuckles', () => {
    expect(checkElbows([pipe('a', 0, 0, 3, 0), elbow('k', 0, 0)])).toEqual([]);
  });
});
