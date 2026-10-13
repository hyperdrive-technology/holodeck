import { describe, expect, it } from 'vitest';
import { ELBOW_RADIUS, PIPE_RADIUS } from '../../assets/process/pipe-math';
import {
  buildPipeBoreGeometry,
  buildPipeGeometry,
  pipeEndStyles,
  PIPE_CUT_INNER,
} from '../../assets/process/pipe-geometry';
import { cutoutFromWindow, type VesselWall } from '../routing/vessel-ports';
import { pipe, registry, tank } from '../routing/test-helpers';
import { gridToWorld } from './grid';
import {
  bendKeysOf,
  fittingInsideVessel,
  MIN_DRAWN_RUN,
  pipeRunSpec,
  resolvePipeRuns,
} from './pipe-runs';
import type { IsoPlacement } from './scene';

const w = (x: number, y: number): [number, number] => {
  const [wx, , wz] = gridToWorld(x, y);
  return [wx, wz];
};

describe('pipeRunSpec', () => {
  it('no vessel, no bend: the authored run with flanges', () => {
    const run = pipeRunSpec(pipe('p', 0, 0, 3, 0), new Set())!;
    expect(run).toEqual({ from: w(0, 0), to: w(3, 0), ends: { from: 'flange', to: 'flange' }, hidden: false });
    expect(pipeRunSpec({ id: 'stub', object: 'pipe', x: 0, y: 0 }, undefined)).toBeNull();
  });

  it('bend ends trim ELBOW_RADIUS like trimRun', () => {
    const run = pipeRunSpec(pipe('p', 0, 0, 3, 0), new Set(['3,0']))!;
    expect(run.to[0]).toBeCloseTo(w(3, 0)[0] - ELBOW_RADIUS);
    expect(run.from).toEqual(w(0, 0));
  });

  it('a window clip moves the end to the wall and makes it a cut end', () => {
    const run = pipeRunSpec(pipe('p', 0.6, 0, 4, 0), undefined, {
      from: { vesselId: 't', contact: 'window', angleDeg: 90, trim: 0.4, cut: true },
    })!;
    expect(run.from[0]).toBeCloseTo(w(1, 0)[0]);
    expect(run.ends).toEqual({ from: 'cut', to: 'flange' });
    // Negative trim extends (end authored short of the wall).
    const ext = pipeRunSpec(pipe('p', 0, 1.1, 0, 4), undefined, {
      from: { vesselId: 't', contact: 'window', angleDeg: 0, trim: -0.1, cut: true },
    })!;
    expect(ext.from[1]).toBeCloseTo(w(0, 1)[1]);
  });

  it('a bend end ignores the vessel clip (the elbow owns that end)', () => {
    const run = pipeRunSpec(pipe('p', 1, 0, 4, 0), new Set(['1,0']), {
      from: { vesselId: 't', contact: 'window', angleDeg: 90, trim: 0.3, cut: true },
    })!;
    expect(run.ends.from).toBe('flange');
    expect(run.from[0]).toBeCloseTo(w(1, 0)[0] + ELBOW_RADIUS);
  });

  it('hides a run clipped to nothing', () => {
    const run = pipeRunSpec(pipe('p', 0, 0, 0.5, 0), undefined, {
      from: { vesselId: 't', contact: 'window', angleDeg: 90, trim: 0.5 - MIN_DRAWN_RUN / 2, cut: true },
    })!;
    expect(run.hidden).toBe(true);
    // A zero-length authored pipe is not hidden by this (it never was).
    expect(pipeRunSpec(pipe('z', 2, 2, 2, 2), undefined)!.hidden).toBe(false);
  });
});

describe('resolvePipeRuns', () => {
  it('clips window ends, keeps solid-wall ends, and hides fittings inside the vessel', () => {
    const objects: IsoPlacement[] = [
      tank('t', 0, 0),
      pipe('east', 0.5, 0, 4, 0), // authored inside the wall on the window side
      pipe('west', -4, 0, -1, 0), // solid wall
      { id: 'v-in', object: 'valve', x: 0.6, y: 0 }, // inside the open vessel
      { id: 'v-out', object: 'valve', x: 2, y: 0 },
      { id: 'cap-in', object: 'end-cap', x: 0, y: 0.5 },
    ];
    const { runs, hiddenFittings } = resolvePipeRuns(objects, registry);
    const east = runs.get('east')!;
    expect(east.from[0]).toBeCloseTo(w(1, 0)[0]);
    expect(east.ends.from).toBe('cut');
    expect(runs.get('west')).toMatchObject({ from: w(-4, 0), to: w(-1, 0), ends: { from: 'flange', to: 'flange' } });
    expect([...hiddenFittings].sort()).toEqual(['cap-in', 'v-in']);
  });

  it('reads auto elbows only once they are resolved (numeric rotation)', () => {
    const objects: IsoPlacement[] = [{ id: 'e', object: 'elbow', x: 3, y: 0, rotation: 0 }, pipe('p', 0, 0, 3, 0)];
    expect(bendKeysOf(objects)).toEqual(new Set(['3,0']));
    expect(bendKeysOf([{ id: 'e', object: 'elbow', x: 3, y: 0 }])).toEqual(new Set());
  });
});

describe('fittingInsideVessel', () => {
  const v: VesselWall = {
    id: 'v',
    x: 0,
    y: 0,
    radius: 1,
    cutout: cutoutFromWindow(45, 91),
    span: { bottomY: 0, topY: 3 },
  };
  it('inside the radius at pipe height', () => {
    expect(fittingInsideVessel({ x: 0.5, y: 0 }, v)).toBe(true);
    expect(fittingInsideVessel({ x: 1, y: 0 }, v)).toBe(false);
    // Under a raised vessel: not inside its wall.
    expect(fittingInsideVessel({ x: 0.5, y: 0 }, { ...v, span: { bottomY: 1.3, topY: 3 } })).toBe(false);
  });
});

describe('pipe geometry end styles', () => {
  const ys = (g: ReturnType<typeof buildPipeGeometry>) => {
    const pos = g.getAttribute('position');
    const out: Array<[number, number]> = [];
    for (let i = 0; i < pos.count; i++) out.push([Math.hypot(pos.getX(i), pos.getZ(i)), pos.getY(i)]);
    return out;
  };

  it('legacy endFlanges maps to flange / plain', () => {
    expect(pipeEndStyles(true)).toEqual({ from: 'flange', to: 'flange' });
    expect(pipeEndStyles(false)).toEqual({ from: 'plain', to: 'plain' });
    expect(pipeEndStyles(true, { to: 'cut' })).toEqual({ from: 'flange', to: 'cut' });
  });

  it('a cut end is an open ring: nothing nearer the axis than the bore at that end, no flange', () => {
    const g = buildPipeGeometry({ length: 2, ends: { from: 'flange', to: 'cut' } });
    const top = ys(g).filter(([, y]) => y > 1 - 1e-6);
    expect(Math.min(...top.map(([r]) => r))).toBeCloseTo(PIPE_RADIUS * PIPE_CUT_INNER);
    expect(Math.max(...top.map(([r]) => r))).toBeCloseTo(PIPE_RADIUS); // no 1.32x flange at the cut end
    // The flanged end still reaches the axis (closed disc) and the flange radius.
    const bottom = ys(g).filter(([, y]) => y < -1 + 0.04);
    expect(Math.min(...bottom.map(([r]) => r))).toBeCloseTo(0);
    expect(Math.max(...bottom.map(([r]) => r))).toBeGreaterThan(PIPE_RADIUS * 1.2);
    g.dispose();
  });

  it('the bore disc fills exactly the hole of each cut end, and is null without one', () => {
    expect(buildPipeBoreGeometry({ length: 2 })).toBeNull();
    expect(buildPipeBoreGeometry({ length: 2, ends: { from: 'flange', to: 'flange' } })).toBeNull();
    const bore = buildPipeBoreGeometry({ length: 2, ends: { from: 'cut', to: 'cut' } })!;
    const pts = ys(bore);
    expect(new Set(pts.map(([, y]) => Math.round(y * 1e6) / 1e6))).toEqual(new Set([-1, 1]));
    expect(Math.max(...pts.map(([r]) => r))).toBeCloseTo(PIPE_RADIUS * PIPE_CUT_INNER);
    bore.dispose();
  });
});
