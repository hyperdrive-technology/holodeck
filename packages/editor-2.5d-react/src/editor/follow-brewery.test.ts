/**
 * Pipes follow on core's brewery scenes (vendored in tests/fixtures/brewery,
 * kept identical by brewery-fixtures.test.ts). These scenes predate `attach`
 * and `onPipe`: every attachment and every valve / pump on a run is inferred.
 * The fixtures are only read, never written.
 *
 * Also the drag-frame performance budget (FOLLOW_MAX_EXPANSIONS, follow.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { TANK_PRESETS, vesselFootprint, vesselPorts } from '../../assets/process';
import { parseSceneFile, type IsoPlacement, type IsoSceneFile } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { endsAttachedTo, resolvePipeEnd } from '../routing/attach';
import { hostPipeOf } from '../routing/inline';
import { createEditorState, editorReducer, type EditorState } from './editor-state';
import { applyFollow, planFollow } from './follow';
import { nextId } from './editor-state';

const fixtures = path.resolve(import.meta.dirname, '../../tests/fixtures/brewery');

/**
 * Stand-ins for core's hyperdrive-ext-brewery parts with the SAME geometry
 * contract (footprint from radius, `vesselPorts`, the 2x1 pump), which this
 * repo cannot import.
 */
function breweryRegistry() {
  const registry = createIsoRegistryWithBuiltins();
  const presets: Record<string, keyof typeof TANK_PRESETS> = {
    'brewery:hlt': 'hlt', 'brewery:mash-tun': 'mash-tun', 'brewery:kettle': 'kettle',
    'brewery:whirlpool': 'whirlpool', 'brewery:fermenter': 'fermenter', 'brewery:brite-tank': 'brite-tank',
  };
  const parts: IsoPartDefinition[] = [
    ...Object.entries(presets).map(([id, preset]) => ({
      id,
      label: id,
      footprint: vesselFootprint(TANK_PRESETS[preset].radius),
      footprintOf: (p: IsoPlacement) => vesselFootprint(Number(p.params?.radius ?? TANK_PRESETS[preset].radius)),
      ports: vesselPorts(TANK_PRESETS[preset].radius),
      params: {},
    }) as IsoPartDefinition),
    { id: 'brewery:pump', label: 'Pump', footprint: { w: 2, h: 1 }, params: {} } as IsoPartDefinition,
  ];
  registry.install({ id: 'brewery-stand-ins', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: parts } });
  return registry;
}

const registry = breweryRegistry();
const load = (name: string): IsoSceneFile => parseSceneFile(JSON.parse(readFileSync(path.join(fixtures, `${name}.iso.json`), 'utf8')), registry);
const byId = (objects: readonly IsoPlacement[], id: string) => objects.find((o) => o.id === id)!;
const drag = (s: EditorState, id: string, dx: number, dy: number) => {
  const o = byId(s.scene.objects, id);
  let next = editorReducer(s, { type: 'select', id });
  next = editorReducer(next, { type: 'drag-start', id, x: o.x, y: o.y });
  next = editorReducer(next, { type: 'drag-move', x: o.x + dx, y: o.y + dy });
  return next;
};

/** Pipe ends that touch nothing (no port, part, other pipe end or pipe body). */
function looseEnds(objects: readonly IsoPlacement[]): string[] {
  const pipes = objects.filter((o) => o.object === 'pipe');
  const out: string[] = [];
  for (const p of pipes) {
    for (const end of ['from', 'to'] as const) {
      const pt = end === 'from' ? { x: p.x, y: p.y } : { x: p.toX!, y: p.toY! };
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
      const joined = pipes.some((q) => q !== p && ((near(q.x, pt.x) && near(q.y, pt.y)) || (near(q.toX!, pt.x) && near(q.toY!, pt.y))
        || (Math.min(q.x, q.toX!) - 1e-6 <= pt.x && pt.x <= Math.max(q.x, q.toX!) + 1e-6 && Math.min(q.y, q.toY!) - 1e-6 <= pt.y && pt.y <= Math.max(q.y, q.toY!) + 1e-6)));
      if (!joined && !resolvePipeEnd(objects, registry, p, end)) out.push(`${p.id}.${end}`);
    }
  }
  return out.sort();
}

describe('brewery scenes: inferred attachments (read-only fixtures)', () => {
  it('brewhouse: every vessel nozzle pipe is found without any attach record', () => {
    const { objects } = load('brewhouse');
    expect(objects.some((o) => o.attach)).toBe(false);
    const ends = (id: string) => endsAttachedTo(objects, registry, new Set([id])).map((e) => `${e.pipe.id}.${e.end}:${e.attach.port}`);
    expect(ends('hlt')).toEqual(['p-hlt-out.from:east']);
    expect(ends('mash-tun')).toEqual(['p-mt-in.to:west', 'p-mt-out.from:east']);
    // Kettle r=0.65: ports at the 2-cell footprint edge (16.5 / 18.5), pipes stop at its wall (16.8 / 18.1).
    expect(ends('kettle')).toEqual(['p-mt-out.to:west', 'p-k-out.from:east']);
    expect(ends('whirlpool')).toEqual(['p-wp-in.to:west', 'p-wp-out.from:east']);
  });

  it('cellar: fermenter bottom outlets attach at the centre, glycol nozzles at the east port', () => {
    const { objects } = load('cellar');
    const ends = endsAttachedTo(objects, registry, new Set(['fv1'])).map((e) => `${e.pipe.id}.${e.end}:${e.attach.port ?? 'centre'}`);
    expect(ends).toEqual(['p-fv1-branch.from:centre', 'p-fv1-gly.from:east']);
  });

  it('a mid-pipe tee (fv2 glycol riser on the header) pins the header: moving fv1 never re-routes past it', () => {
    const { objects } = load('cellar');
    const plan = planFollow(objects, registry, new Set(['fv1']), () => true);
    const glycol = plan.runs.find((r) => r.run.ids.includes('p-fv1-gly'))!;
    expect(glycol.run.ids).toContain('p-gly-header');
    expect(glycol.run.ids).not.toContain('p-fv3-gly'); // the run stops at the tee
    expect(plan.base!.filter((o) => o.object === 'pipe').length).toBe(objects.filter((o) => o.object === 'pipe').length + 1);
  });
});

describe('brewery scenes: dragging vessels', () => {
  it('kettle down two cells: both runs re-route, valves and the pump ride along, nothing is left dangling', () => {
    const s0 = createEditorState(load('brewhouse'), { registry });
    const before = looseEnds(s0.scene.objects);
    const s = drag(s0, 'kettle', 0, 2);
    expect(s.drag?.blocked).toEqual([]);
    const objects = s.scene.objects;
    expect(byId(objects, 'kettle')).toMatchObject({ x: 17.5, y: 7 });
    // The authored wall offsets survive: the pipe still stops at 16.8 / 18.1, now at y = 7.
    expect(objects.some((o) => o.object === 'pipe' && o.toX === 16.8 && o.toY === 7)).toBe(true);
    expect(objects.some((o) => o.object === 'pipe' && o.x === 18.1 && o.y === 7)).toBe(true);
    for (const id of ['v-mt-out', 'v-k-in', 'pump-wort', 'v-k-out']) {
      expect(hostPipeOf(byId(objects, id), objects), id).not.toBeNull();
    }
    expect(looseEnds(objects)).toEqual(before);
    // Pipe ids survive (hosts bind flow animation to them).
    for (const id of ['p-mt-out', 'p-k-out']) expect(objects.some((o) => o.id === id)).toBe(true);
    const committed = editorReducer(s, { type: 'drag-end' });
    expect(committed.past).toHaveLength(1);
    expect(editorReducer(committed, { type: 'undo' }).scene.objects).toEqual(s0.scene.objects);
  });

  it('whirlpool with its capped outlet: the outlet stub and cap ride along rigidly', () => {
    const s0 = createEditorState(load('brewhouse'), { registry });
    const s = drag(s0, 'whirlpool', 1, 2);
    expect(byId(s.scene.objects, 'p-wp-out')).toMatchObject({ x: 26, y: 10, toX: 30, toY: 10 });
    expect(byId(s.scene.objects, 'cap-wp-out')).toMatchObject({ x: 30, y: 10 });
  });

  it.each([['brewhouse'], ['cellar']])('%s: every vessel can be dragged around without throwing or loosening pipes', (name) => {
    const s0 = createEditorState(load(name), { registry });
    const before = looseEnds(s0.scene.objects);
    const vessels = s0.scene.objects.filter((o) => o.object.startsWith('brewery:') && o.object !== 'brewery:pump');
    for (const v of vessels) {
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [2, 2], [0, 3]] as const) {
        const s = editorReducer(drag(s0, v.id, dx, dy), { type: 'drag-end' });
        // Either the move landed (pipes followed) or it was refused / snapped: never loose ends.
        expect(looseEnds(s.scene.objects), `${v.id} by ${dx},${dy}`).toEqual(before);
      }
    }
  });
});

describe('drag-frame performance', () => {
  /** The brewhouse tiled `n` x `n` times (ids suffixed), so routes cross a realistic, larger plant. */
  function tiled(n: number): IsoPlacement[] {
    const base = load('brewhouse').objects;
    const out: IsoPlacement[] = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        for (const o of base) {
          const moved: IsoPlacement = { ...o, id: `${o.id}@${i},${j}`, x: o.x + i * 34, y: o.y + j * 16 };
          if (o.toX !== undefined) moved.toX = o.toX + i * 34;
          if (o.toY !== undefined) moved.toY = o.toY + j * 16;
          out.push(moved);
        }
      }
    }
    return out;
  }

  const timeFrames = (objects: IsoPlacement[], id: string, path: Array<[number, number]>) => {
    const plan = planFollow(objects, registry, new Set([id]), () => true);
    const times: number[] = [];
    let routed = 0;
    for (const [dx, dy] of path) {
      const t0 = performance.now();
      const frame = applyFollow(objects, registry, plan, dx, dy, { editable: () => true, nextId });
      times.push(performance.now() - t0);
      if (frame.blocked.length === 0) routed += 1;
    }
    times.sort((a, b) => a - b);
    return { median: times[Math.floor(times.length / 2)]!, max: times[times.length - 1]!, runs: plan.runs.length, routed };
  };

  /** Every whole-cell offset in a 5 x 11 box: a drag sweeping the kettle around its neighbours. */
  const path: Array<[number, number]> = [];
  for (let dy = -4; dy <= 6; dy += 1) for (let dx = -2; dx <= 2; dx += 1) path.push([dx, dy]);

  it('brewhouse (41 objects): a kettle frame re-routes its two runs well inside a 60 fps budget', () => {
    const { median, max, runs, routed } = timeFrames(load('brewhouse').objects, 'kettle', path);
    expect(runs).toBe(2);
    // The timing is only meaningful if most frames really route (not fast failures).
    expect(routed).toBeGreaterThan(path.length / 2);
    // Measured ~1-3 ms median on an M-series Mac. Bounds are loose for CI runners.
    console.info(`[perf] brewhouse kettle frame: median ${median.toFixed(2)} ms, max ${max.toFixed(2)} ms, ${routed}/${path.length} routed`);
    expect(median).toBeLessThan(16);
    expect(max).toBeLessThan(150);
  });

  it('a 9x brewhouse plant (369 objects): frames stay interactive', () => {
    const objects = tiled(3);
    const { median, max, routed } = timeFrames(objects, 'kettle@1,1', path);
    console.info(`[perf] 9x brewhouse (${objects.length} objects) frame: median ${median.toFixed(2)} ms, max ${max.toFixed(2)} ms, ${routed}/${path.length} routed`);
    expect(routed).toBeGreaterThan(path.length / 2);
    expect(median).toBeLessThan(50);
    expect(max).toBeLessThan(400);
  });
});

describe('drag-frame performance: failing searches are capped', () => {
  it('an unreachable port in a wide scene gives up within the interactive budget', () => {
    // b's west port at (59, 4) can only be entered from (58, 4), which `w` blocks:
    // A* exhausts (or hits FOLLOW_MAX_EXPANSIONS) before reporting the run blocked.
    const objects: IsoPlacement[] = [
      { id: 'a', object: 'tank', x: 0, y: 0 },
      { id: 'b', object: 'tank', x: 60, y: 0 },
      { id: 'p', object: 'pipe', x: 1, y: 0, toX: 59, toY: 0 },
      { id: 'w', object: 'tank', x: 57, y: 4 },
      ...Array.from({ length: 40 }, (_, i): IsoPlacement => ({ id: `t${i}`, object: 'tank', x: 4 + (i % 10) * 5, y: -12 + Math.floor(i / 10) * 8 })),
    ];
    const plan = planFollow(objects, registry, new Set(['b']), () => true);
    const t0 = performance.now();
    const frame = applyFollow(objects, registry, plan, 0, 4, { editable: () => true, nextId });
    const ms = performance.now() - t0;
    console.info(`[perf] capped failing search: ${ms.toFixed(2)} ms`);
    expect(frame.blocked).toHaveLength(1);
    expect(ms).toBeLessThan(250);
  });
});
