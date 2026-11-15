import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ELBOW_RADIUS, PIPE_RADIUS, pipeWorldY } from '../../assets/process/pipe-math';
import { mergeTankParams, tankLayout, tankWallSpan } from '../../assets/process/tank-params';
import { TANK_PRESETS } from '../../assets/process/tank-presets';
import { createCutawayRegistry } from '../editor/pipe-cutaway-parts';
import { gridToWorld } from '../iso/grid';
import { pipeRunSpec, resolvePipeRuns } from '../iso/pipe-runs';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { resolveAutoElbows } from './elbows';
import {
  clipPipeEnd as clipFor,
  cutoutFromWindow,
  resolvePipeClips,
  vesselWalls,
  type PipeClip,
  type VesselWall,
} from './vessel-ports';
import {
  nozzleAxisY,
  planRiserEnd,
  planRisers,
  riserAppearance,
  vesselUndersideY,
  RISER_MIN_RUN,
  RISER_NOZZLE_LEN,
  RISER_NOZZLE_MIN,
  type PipeRiser,
} from './vessel-risers';

const rp = PIPE_RADIUS;
const runY = pipeWorldY();
const TOL = 1e-6;

/** A fermenter-like vessel: wall 1.3..3.2, cone tip at 0.75 with a 0.072 outlet. */
function raised(over: Partial<VesselWall> = {}): VesselWall {
  return {
    id: 'fv',
    x: 0,
    y: 0,
    radius: 0.6,
    cutout: cutoutFromWindow(45, 91),
    span: { bottomY: 1.3, topY: 3.2, outletY: 0.75, outletRadius: 0.072 },
    ...over,
  };
}

const pipe = (id: string, x: number, y: number, toX: number, toY: number): IsoPlacement => ({ id, object: 'pipe', x, y, toX, toY });

function plan(objects: IsoPlacement[], walls: VesselWall[], bends: Set<string> = new Set()) {
  // planRisers only needs the clips; build them against the hand-made walls.
  const clips = new Map<string, PipeClip>();
  for (const p of objects) {
    if (p.object !== 'pipe') continue;
    const from = { x: p.x, y: p.y };
    const to = { x: p.toX!, y: p.toY! };
    const clip: PipeClip = {};
    for (const w of walls) {
      const f = clipFor(from, to, w);
      const t = clipFor(to, from, w);
      if (f) clip.from = f;
      if (t) clip.to = t;
    }
    if (clip.from || clip.to) clips.set(p.id, clip);
  }
  return planRisers(objects, clips, walls, bends);
}

/** Runs as main draws them (clip only) and with risers, for the same scene. */
function runsFor(objects: IsoPlacement[], walls: VesselWall[]) {
  const clips = new Map<string, PipeClip>();
  for (const p of objects) {
    const from = { x: p.x, y: p.y };
    const to = { x: p.toX!, y: p.toY! };
    const clip: PipeClip = {};
    // Same "best contact" rule as resolvePipeClips, simplified: first contact wins.
    for (const w of walls) {
      clip.from ??= clipFor(from, to, w) ?? undefined;
      clip.to ??= clipFor(to, from, w) ?? undefined;
    }
    if (!clip.from) delete clip.from;
    if (!clip.to) delete clip.to;
    if (clip.from || clip.to) clips.set(p.id, clip);
  }
  const { risers, trims } = planRisers(objects, clips, walls);
  const main = new Map(objects.map((p) => [p.id, pipeRunSpec(p, new Set(), clips.get(p.id))!]));
  const next = new Map(objects.map((p) => [p.id, pipeRunSpec(p, new Set(), clips.get(p.id), trims.get(p.id))!]));
  return { objects, risers, trims, main, next };
}

function assertNoNewlyHidden({ objects, risers, trims, main, next }: ReturnType<typeof runsFor>) {
  const label = objects.map((o) => `${o.id}:${o.x},${o.y}->${o.toX},${o.toY}`).join(' ');
  for (const p of objects) {
    const m = main.get(p.id)!;
    const n = next.get(p.id)!;
    if (m.hidden || Math.hypot(p.toX! - p.x, p.toY! - p.y) < 1e-9) continue;
    expect(n.hidden, `${p.id} hidden by risers; ${label}`).toBe(false);
    const dot = (n.to[0] - n.from[0]) * (p.toX! - p.x) + (n.to[1] - n.from[1]) * (p.toY! - p.y);
    expect(dot, `${p.id} flipped; ${label}`).toBeGreaterThan(0);
  }
  // Every drawn riser is fed by a run that is trimmed to it.
  for (const r of risers) {
    expect(r.pipes.length).toBeGreaterThan(0);
    for (const pe of r.pipes) expect(trims.get(pe.pipeId)?.[pe.end], `${r.id} <- ${pe.pipeId}.${pe.end}`).toBeDefined();
  }
}

/** World (x, z) of grid (x, y). */
const w = (x: number, y: number): [number, number] => {
  const [wx, , wz] = gridToWorld(x, y);
  return [wx, wz];
};

/** Horizontal world distance from a riser axis to the vessel axis. */
const radial = (r: PipeRiser, v: VesselWall) => Math.hypot(r.at[0] - w(v.x, v.y)[0], r.at[1] - w(v.x, v.y)[1]);

describe('vesselUndersideY', () => {
  it('is flat over the cone outlet, then climbs linearly to the wall bottom at the rim', () => {
    const v = raised();
    expect(vesselUndersideY(v, 0)).toBe(0.75);
    expect(vesselUndersideY(v, 0.072)).toBe(0.75);
    expect(vesselUndersideY(v, 0.6)).toBeCloseTo(1.3);
    expect(vesselUndersideY(v, 0.336)).toBeCloseTo(0.75 + (0.55 * (0.336 - 0.072)) / (0.6 - 0.072));
    expect(vesselUndersideY(v, 5)).toBeCloseTo(1.3); // clamped to the rim
  });

  it('treats an outlet as wide as the shell as a dish pole, and no outlet as a flat bottom', () => {
    const dish = raised({ span: { bottomY: 0.55, topY: 2.75, outletY: 0.45, outletRadius: 0.6 } });
    expect(vesselUndersideY(dish, 0)).toBe(0.45);
    expect(vesselUndersideY(dish, 0.3)).toBeCloseTo(0.5);
    const flat = raised({ span: { bottomY: 0.4, topY: 2 } });
    expect(vesselUndersideY(flat, 0)).toBe(0.4);
  });
});

describe('tankWallSpan outlet', () => {
  it('reports the cone tip and its radius from the full layout', () => {
    const preset = TANK_PRESETS.fermenter;
    const layout = tankLayout(preset.height, preset.radius, mergeTankParams(preset.params));
    const span = tankWallSpan(layout);
    expect(span.bottomY).toBeCloseTo(0.75 + 0.55);
    expect(span.outletY).toBeCloseTo(0.75);
    expect(span.outletRadius).toBeCloseTo(0.6 * 0.12);
  });

  it('stays the two-field span for a flat bottom or a layout without the closure (old callers)', () => {
    const hlt = TANK_PRESETS.hlt;
    const layout = tankLayout(hlt.height, hlt.radius, mergeTankParams(hlt.params));
    expect(tankWallSpan(layout)).toEqual({ bottomY: 0, topY: 3 });
    expect(tankWallSpan({ y0: layout.y0, bodyTop: layout.bodyTop, floorY: layout.floorY })).toEqual({ bottomY: 0, topY: 3 });
  });
});

describe('planRiserEnd', () => {
  it('a rim end under a raised wall gets a side riser one nozzle length outside the shell', () => {
    const v = raised();
    const end = { x: 0.8, y: 0 };
    const clip = clipFor(end, { x: 3, y: 0 }, v)!;
    expect(clip.contact).toBe('under');
    const r = planRiserEnd(end, { x: 3, y: 0 }, clip, v)!;
    expect(r.kind).toBe('side');
    expect(r.at.x).toBeCloseTo(0.6 + rp + RISER_NOZZLE_LEN);
    expect(r.at.y).toBeCloseTo(0);
  });

  it('a centre end under a raised vessel gets a bottom riser right under the outlet', () => {
    const v = raised();
    const clip = clipFor({ x: 0, y: 0 }, { x: 0, y: 3.5 }, v)!;
    expect(clip.contact).toBe('outlet');
    const r = planRiserEnd({ x: 0, y: 0 }, { x: 0, y: 3.5 }, clip, v)!;
    expect(r).toMatchObject({ kind: 'bottom', tAxis: 0 });
    expect(r.at).toEqual({ x: 0, y: 0 });
  });

  it('no riser when the run is already at the nozzle height (vessel on the floor: wall / window contact)', () => {
    const floor = raised({ span: { bottomY: 0, topY: 3 } });
    const clip = clipFor({ x: 0.8, y: 0 }, { x: 3, y: 0 }, floor)!;
    expect(['wall', 'window']).toContain(clip.contact);
    expect(planRiserEnd({ x: 0.8, y: 0 }, { x: 3, y: 0 }, clip, floor)).toBeNull();
  });

  it('no riser when the vessel underside sits right on the run (nothing to climb)', () => {
    // Bottom outlet only RISER_MIN_RISE / 2 above the run's top.
    const low = raised({ span: { bottomY: 1.3, topY: 3, outletY: runY + rp + 0.01, outletRadius: 0.1 } });
    const clip = clipFor({ x: 0, y: 0 }, { x: 0, y: 3 }, low)!;
    expect(clip.contact).toBe('outlet');
    expect(planRiserEnd({ x: 0, y: 0 }, { x: 0, y: 3 }, clip, low)).toBeNull();
  });

  it('no riser when the run is too short to keep a length past the riser', () => {
    const v = raised();
    const end = { x: 0.8, y: 0 };
    // Even the shortest nozzle puts the riser at 0.85 and the run end at 1.05: nothing left of 1.1.
    const other = { x: 1.1, y: 0 };
    expect(planRiserEnd(end, other, clipFor(end, other, v)!, v)).toBeNull();
    // An elbow at the far end takes ELBOW_RADIUS more.
    const longer = { x: 1.6, y: 0 };
    expect(planRiserEnd(end, longer, clipFor(end, longer, v)!, v)).not.toBeNull();
    expect(planRiserEnd(end, longer, clipFor(end, longer, v)!, v, {}, ELBOW_RADIUS)).toBeNull();
  });
});

describe('planRiserEnd nozzle length', () => {
  it('shrinks the nozzle to fit a short run that ends in an elbow (FV glycol stub)', () => {
    const v = raised();
    const end = { x: 0.8, y: 0 };
    const other = { x: 1.8, y: 0 };
    const r = planRiserEnd(end, other, clipFor(end, other, v)!, v, {}, ELBOW_RADIUS)!;
    expect(r.kind).toBe('side');
    // Riser as far out as the run allows: drawn end (axis + rp) leaves RISER_MIN_RUN before the elbow trim.
    expect(r.at.x + rp).toBeCloseTo(1.8 - ELBOW_RADIUS - RISER_MIN_RUN);
    expect(r.at.x - 0.6 - rp).toBeLessThan(RISER_NOZZLE_LEN);
    expect(r.at.x - 0.6 - rp).toBeGreaterThanOrEqual(RISER_NOZZLE_MIN);
  });
});

describe('planRisers', () => {
  it('side riser: lands on the nozzle, stub ends on the shell, run trimmed flush with the riser', () => {
    const v = raised();
    const { risers, trims } = plan([pipe('p', 0.8, 0, 3, 0)], [v]);
    expect(risers).toHaveLength(1);
    const r = risers[0]!;
    expect(r).toMatchObject({ vesselId: 'fv', kind: 'side', pipes: [{ pipeId: 'p', end: 'from' }] });
    const ny = nozzleAxisY(v);
    expect(r.bottomY).toBeCloseTo(runY - rp);
    expect(r.topY).toBeCloseTo(ny + rp);
    // Nozzle axis sits on the straight wall, just above its bottom edge.
    expect(ny - rp).toBeGreaterThan(v.span.bottomY);
    expect(ny + rp).toBeLessThan(v.span.topY);
    // Stub: from the riser's side to the shell surface (radius R from the vessel axis).
    const centre = w(0, 0);
    expect(Math.hypot(r.nozzle!.to[0] - centre[0], r.nozzle!.to[1] - centre[1])).toBeCloseTo(v.radius, 6);
    expect(Math.hypot(r.nozzle!.from[0] - r.at[0], r.nozzle!.from[1] - r.at[1])).toBeCloseTo(rp, 6);
    expect(r.nozzle!.y).toBeCloseTo(ny);
    // The east side is in the default window: the stub enters it as a cut section.
    expect(r.nozzle!.shellEnd).toBe('cut');
    // Run end trimmed to the riser's side: riser at x = 1.0, flush at 1.2, authored end 0.8.
    expect(trims.get('p')!.from).toBeCloseTo(0.4);
  });

  it('a side nozzle on solid wall is flanged on the shell', () => {
    const v = raised();
    const { risers } = plan([pipe('p', -0.8, 0, -3, 0)], [v]); // west: outside the s/e window
    expect(risers[0]!.nozzle!.shellEnd).toBe('flange');
  });

  it('bottom riser: on the run axis under the outlet, climbing to the cone tip', () => {
    const v = raised();
    const { risers, trims } = plan([pipe('branch', 0, 0, 0, 3.5)], [v]);
    expect(risers).toHaveLength(1);
    const r = risers[0]!;
    expect(r.kind).toBe('bottom');
    expect(r.nozzle).toBeUndefined();
    expect(radial(r, v)).toBeLessThan(TOL);
    expect(r.topY).toBeCloseTo(0.75); // the cone tip
    expect(trims.get('branch')!.from).toBeCloseTo(rp); // flush with the riser side
  });

  it('bottom riser off-axis climbs to the cone at that radius', () => {
    const v = raised();
    // Run passes 0.2 off the vessel axis, ending past it.
    const { risers } = plan([pipe('p', -0.1, 0.2, -3, 0.2)], [v]);
    const r = risers[0]!;
    expect(r.kind).toBe('bottom');
    expect(r.at[0]).toBeCloseTo(w(0, 0.2)[0]);
    expect(r.topY).toBeCloseTo(vesselUndersideY(v, 0.2));
  });

  it('no riser at all when heights match (vessel standing on the floor)', () => {
    const floor = raised({ span: { bottomY: 0, topY: 3 } });
    const { risers, trims } = plan([pipe('a', 0.8, 0, 3, 0), pipe('b', -0.6, 0, -3, 0)], [floor]);
    expect(risers).toEqual([]);
    expect(trims.size).toBe(0);
  });

  it('several pipes on one vessel: one riser per side, each run to its own', () => {
    const v = raised();
    const { risers, trims } = plan(
      [pipe('east', 0.8, 0, 3, 0), pipe('west', -3, 0, -0.8, 0), pipe('south', 0, 0.8, 0, 3), pipe('branch', 0, 0, 0, -3)],
      [v],
    );
    expect(risers.map((r) => `${r.kind}:${r.pipes.map((p) => `${p.pipeId}.${p.end}`).join('+')}`)).toEqual([
      'side:east.from',
      'side:west.to',
      'side:south.from',
      'bottom:branch.from',
    ]);
    expect(new Set(risers.map((r) => r.id)).size).toBe(4);
    for (const r of risers.filter((x) => x.kind === 'side')) {
      expect(radial(r, v)).toBeCloseTo(v.radius + rp + RISER_NOZZLE_LEN, 6);
    }
    expect(trims.get('west')!.to).toBeCloseTo(0.4);
  });

  it('header: ends that land on the same spot share one riser (cone outlet in + out)', () => {
    const v = raised();
    const { risers, trims } = plan([pipe('out', 0, 0, 0, 3), pipe('in', 0, -3, 0, 0)], [v]);
    expect(risers).toHaveLength(1);
    expect(risers[0]!.pipes).toEqual([
      { pipeId: 'out', end: 'from' },
      { pipeId: 'in', end: 'to' },
    ]);
    expect(trims.get('out')!.from).toBeCloseTo(rp);
    expect(trims.get('in')!.to).toBeCloseTo(rp);
  });

  it('regression (holodeck#320): a short run between two raised vessels stays visible with ordered ends', () => {
    // GPT review case: radius-1 vessels at (0,0) and (3,0), pipe (1,0) -> (2,0).
    const span = { bottomY: 1.3, topY: 3.2, outletY: 0.75, outletRadius: 0.1 };
    const a = raised({ id: 'a', radius: 1, span });
    const b = raised({ id: 'b', x: 3, radius: 1, span });
    const objects = [pipe('p', 1, 0, 2, 0)];
    const { risers, trims } = plan(objects, [a, b]);
    const t = trims.get('p') ?? {};
    // Both trims together leave at least RISER_MIN_RUN of drawn run.
    expect((t.from ?? 0) + (t.to ?? 0)).toBeLessThanOrEqual(1 - RISER_MIN_RUN + 1e-9);
    // Every riser drawn is one whose run end is actually trimmed to it.
    for (const r of risers) for (const pe of r.pipes) expect(t[pe.end]).toBeDefined();
    // And through the real run resolver: visible, from before to.
    const clips = new Map<string, PipeClip>();
    clips.set('p', { from: clipFor({ x: 1, y: 0 }, { x: 2, y: 0 }, a)!, to: clipFor({ x: 2, y: 0 }, { x: 1, y: 0 }, b)! });
    const spec = pipeRunSpec(objects[0]!, new Set(), clips.get('p'), t)!;
    expect(spec.hidden).toBe(false);
    expect(spec.to[0] - spec.from[0]).toBeGreaterThanOrEqual(RISER_MIN_RUN - 1e-9);
  });

  it('a run too short for two risers keeps the plain clips at both ends (no floating risers)', () => {
    const span = { bottomY: 1.3, topY: 3.2 };
    const a = raised({ id: 'a', radius: 1, span });
    const b = raised({ id: 'b', x: 2.5, radius: 1, span });
    const { risers, trims } = plan([pipe('p', 1, 0, 1.5, 0)], [a, b]);
    expect(risers).toEqual([]);
    expect(trims.size).toBe(0);
  });

  it('regression (holodeck#321): offset parallel outlet branches keep their own risers, each flush', () => {
    const v = raised();
    const { risers, trims } = plan([pipe('a', 0, 0, 0, 3), pipe('b', 0.39, 0, 0.39, 3)], [v]);
    expect(risers).toHaveLength(2);
    for (const r of risers) {
      expect(r.pipes).toHaveLength(1);
      expect(trims.get(r.pipes[0]!.pipeId)!.from).toBeCloseTo(rp);
    }
  });

  it('regression: header grouping cannot deepen both trims of a run until it hides (GPT case, branches first)', () => {
    const a = raised({ id: 'a' });
    const b = raised({ id: 'b', y: 1.2 });
    const between = pipe('ab', 0, 0.395, 0, 0.805);
    const objects = [pipe('br1', 0, 0.395, 3, 0.395), pipe('br2', 0, 0.805, 3, 0.805), between];
    const result = runsFor(objects, [a, b]);
    expect(result.main.get('ab')!.hidden).toBe(false);
    expect(result.next.get('ab')!.hidden).toBe(false);
    assertNoNewlyHidden(result);
  });

  it('property: no input order or layout hides a run (or flips it) that main draws', () => {
    // Small seeded PRNG (mulberry32) so a failure is reproducible.
    let seed = 0x5eed;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    let checked = 0;
    const POSITIONS = [[1.25, 0], [1.5, 0], [2, 0], [3, 0], [1.5, 0.4], [0, 1.2], [0, 1.5], [0, 2]] as const;
    const INSETS = [0.395, 0.6, 0.8];
    const BRANCH_OFFSETS = [0.2, 0.39, 0.395, 0.6];
    for (const [vx, vy] of POSITIONS) {
      for (const inset of INSETS) {
        for (const off of BRANCH_OFFSETS) {
          const vessels = [raised({ id: 'v0' }), raised({ id: 'v1', x: vx, y: vy })];
          const d = Math.hypot(vx, vy);
          const [ux, uy] = [vx / d, vy / d];
          // Branches leave each vessel perpendicular to the link, `off` along it towards the other vessel
          // (GPT's case: off = inset = 0.395, so the branch risers sit right on the link's ends).
          const objects: IsoPlacement[] = [
            pipe('b0', ux * off, uy * off, ux * off - uy * 3, uy * off + ux * 3),
            pipe('b1', vx - ux * off, vy - uy * off, vx - ux * off - uy * 3, vy - uy * off + ux * 3),
          ];
          // Plus two random stubs near a vessel.
          for (let i = 0; i < 2; i++) {
            const v = pick(vessels);
            const sgn = rnd() < 0.5 ? -1 : 1;
            const r = pick([0, 0.2, 0.6, 0.8]);
            const len = pick([0.3, 0.5, 1, 2]);
            const x = v.x + sgn * r;
            const y = v.y + pick([0, 0.39, -0.395]);
            objects.push(pipe(`p${i}`, x, y, x + sgn * len, y));
          }
          const link = pipe('link', ux * inset, uy * inset, vx - ux * inset, vy - uy * inset);
          for (let at = 0; at <= objects.length; at++) {
            const order = [...objects.slice(0, at), link, ...objects.slice(at)];
            for (const list of [order, [...order].reverse()]) {
              assertNoNewlyHidden(runsFor(list, vessels));
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(POSITIONS.length * INSETS.length * BRANCH_OFFSETS.length * 5 * 2);
  });

  it('ends on an elbow cell are the elbow\'s business: no riser', () => {
    const v = raised();
    const { risers } = plan([pipe('p', 0.8, 0, 3, 0)], [v], new Set(['0.8,0']));
    expect(risers).toEqual([]);
  });

  it('two vessels: risers keep their own vessel ids', () => {
    const a = raised();
    const b = raised({ id: 'fv2', x: 5 });
    const { risers } = plan([pipe('ab', 0.8, 0, 4.2, 0)], [a, b]);
    expect(risers.map((r) => r.vesselId).sort()).toEqual(['fv', 'fv2']);
    expect(risers.every((r) => r.kind === 'side')).toBe(true);
  });
});

describe('brewery scenes (vendored fixtures, mirrored vessel parts)', () => {
  const registry = createCutawayRegistry();
  const load = (name: string): IsoSceneFile =>
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../tests/fixtures/brewery/${name}.iso.json`), 'utf8')) as IsoSceneFile;

  it.each(['brewhouse', 'cellar'])('%s: every under / outlet pipe end meets its vessel through a riser', (name) => {
    const objects = resolveAutoElbows(load(name).objects);
    const clips = resolvePipeClips(objects, registry);
    const walls = new Map(vesselWalls(objects, registry).map((v) => [v.id, v]));
    const { runs, risers } = resolvePipeRuns(objects, registry);
    const joined = new Set(risers.flatMap((r) => r.pipes.map((p) => `${p.pipeId}.${p.end}`)));
    let raisedEnds = 0;
    for (const [pipeId, clip] of clips) {
      for (const end of ['from', 'to'] as const) {
        const c = clip[end];
        if (!c || (c.contact !== 'under' && c.contact !== 'outlet')) continue;
        raisedEnds += 1;
        expect(joined.has(`${pipeId}.${end}`), `${pipeId}.${end} (${c.contact}) has a riser`).toBe(true);
        expect(runs.get(pipeId)!.hidden).toBe(false);
      }
    }
    expect(raisedEnds).toBeGreaterThan(0);
    for (const r of risers) {
      const v = walls.get(r.vesselId)!;
      // The riser's run end is flush with the riser: the drawn end is one pipe radius from its axis.
      for (const p of r.pipes) {
        const [x, z] = runs.get(p.pipeId)![p.end];
        expect(Math.hypot(x - r.at[0], z - r.at[1]), `${p.pipeId}.${p.end}`).toBeCloseTo(PIPE_RADIUS, 6);
      }
      if (r.kind === 'side') {
        // The stub lands on the shell, on the straight wall.
        const [cx, cz] = w(v.x, v.y);
        expect(Math.hypot(r.nozzle!.to[0] - cx, r.nozzle!.to[1] - cz)).toBeCloseTo(v.radius, 6);
        expect(r.nozzle!.y - PIPE_RADIUS).toBeGreaterThan(v.span.bottomY);
      } else {
        expect(r.topY).toBeCloseTo(vesselUndersideY(v, radial(r, v)), 6);
      }
      expect(r.topY).toBeGreaterThan(r.runY + PIPE_RADIUS);
    }
  });

  it('cellar: each fermenter gets a cone-outlet riser and a glycol side riser', () => {
    const objects = resolveAutoElbows(load('cellar').objects);
    const { risers } = resolvePipeRuns(objects, registry);
    for (const fv of ['fv1', 'fv2', 'fv3']) {
      const mine = risers.filter((r) => r.vesselId === fv);
      expect(mine.map((r) => `${r.kind}:${r.pipes.map((p) => p.pipeId).join('+')}`).sort(), fv).toEqual([
        `bottom:p-${fv}-branch`,
        `side:p-${fv}-gly`,
      ]);
      const bottom = mine.find((r) => r.kind === 'bottom')!;
      const preset = TANK_PRESETS.fermenter;
      expect(bottom.topY).toBeCloseTo(mergeTankParams(preset.params).standHeight, 6); // the cone tip
    }
  });

  it('brewhouse: the kettle on legs is fed and drained through side risers', () => {
    const objects = resolveAutoElbows(load('brewhouse').objects);
    const { risers } = resolvePipeRuns(objects, registry);
    const kettle = risers.filter((r) => r.vesselId === 'kettle');
    expect(kettle.map((r) => r.pipes.map((p) => p.pipeId).join('+')).sort()).toEqual(['p-k-out', 'p-mt-out']);
    expect(kettle.every((r) => r.kind === 'side')).toBe(true);
  });
});

describe('riserAppearance (holodeck#326)', () => {
  const r = (...ids: string[]) => ({ pipes: ids.map((pipeId) => ({ pipeId, end: 'from' as const })) });
  it('takes the feeding pipe\'s opacity and z (defaults 1 / 0)', () => {
    expect(riserAppearance(r('a'), new Map([['a', {}]]))).toEqual({ opacity: 1, z: 0 });
    expect(riserAppearance(r('a'), new Map([['a', { opacity: 0.3, z: -2 }]]))).toEqual({ opacity: 0.3, z: -2 });
  });
  it('a zero-opacity pipe gives a zero-opacity (undrawn) riser', () => {
    expect(riserAppearance(r('a'), new Map([['a', { opacity: 0 }]])).opacity).toBe(0);
  });
  it('a shared header takes the most visible, frontmost member', () => {
    const byId = new Map([
      ['a', { opacity: 0, z: 1 }],
      ['b', { opacity: 0.5, z: -1 }],
    ]);
    expect(riserAppearance(r('a', 'b'), byId)).toEqual({ opacity: 0.5, z: 1 });
  });
  it('clamps out-of-range opacity', () => {
    expect(riserAppearance(r('a'), new Map([['a', { opacity: 4 }]])).opacity).toBe(1);
  });
});
