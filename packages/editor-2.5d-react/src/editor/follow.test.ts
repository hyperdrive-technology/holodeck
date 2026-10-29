/**
 * Drag-and-drop building: pipes attached to a part's ports follow it
 * (follow.ts, wired into editor-state.ts drag-move / drag-end / nudge / cancel).
 */
import { describe, expect, it } from 'vitest';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { resolvePipeEnd } from '../routing/attach';
import { headingOf } from '../routing/elbows';
import { positionOnPipe, segOf } from '../routing/inline';
import { pipe, registry, tank } from '../routing/test-helpers';
import { createEditorState, editorReducer, emptyScene, NUDGE_BLOCKED_NOTICE, type EditorAction, type EditorState } from './editor-state';
import { FOLLOW_BLOCKED_NOTICE, FOLLOW_CANCELLED_NOTICE, FOLLOW_LOCKED_NOTICE, FOLLOW_SNAPPED_NOTICE, planFollow } from './follow';

const sceneOf = (objects: IsoPlacement[], extra: Partial<IsoSceneFile> = {}): IsoSceneFile => ({ ...emptyScene('doc'), objects, ...extra });
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const pipesOf = (s: EditorState) => s.scene.objects.filter((o) => o.object === 'pipe');
const byId = (s: EditorState, id: string) => s.scene.objects.find((o) => o.id === id);

/** Every pipe end touches a port, another pipe end, or an inline part (no dangling ends from the move). */
function endsConnected(objects: readonly IsoPlacement[]) {
  const pipes = objects.filter((o) => o.object === 'pipe');
  const free: string[] = [];
  for (const p of pipes) {
    for (const end of ['from', 'to'] as const) {
      const pt = end === 'from' ? { x: p.x, y: p.y } : { x: p.toX!, y: p.toY! };
      const joined = pipes.some((q) => q !== p && ((q.x === pt.x && q.y === pt.y) || (q.toX === pt.x && q.toY === pt.y)));
      if (!joined && !resolvePipeEnd(objects, registry, p, end)) free.push(`${p.id}.${end}`);
    }
  }
  return free;
}

/** Two tanks joined east -> west by one straight pipe, an inline valve on it. */
function twoTanks(extra: IsoPlacement[] = []) {
  return createEditorState(sceneOf([
    tank('a', 0, 0),
    tank('b', 10, 0),
    { ...pipe('p', 1, 0, 9, 0), band: '#123456', meta: { tag: 'P-101' } },
    { id: 'v', object: 'valve', x: 5, y: 0, onPipe: 'p', at: 0.5 },
    ...extra,
  ]));
}

describe('pipes follow a dragged vessel', () => {
  it('re-routes the attached run live, keeps ports, headings, ids and fields, and commits ONE undo step', () => {
    const s0 = twoTanks();
    const s1 = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 });
    // Live preview: the scene already shows the re-routed run, nothing committed yet.
    expect(byId(s1, 'b')).toMatchObject({ x: 10, y: 4 });
    expect(s1.revision).toBe(s0.revision);
    expect(s1.past).toHaveLength(0);
    const pipes = pipesOf(s1);
    expect(pipes.length).toBeGreaterThan(1);
    // Starts on a's east port leaving east, ends on b's (moved) west port arriving eastbound.
    const first = pipes.find((p) => p.x === 1 && p.y === 0)!;
    const last = pipes.find((p) => p.toX === 9 && p.toY === 4)!;
    expect(headingOf(first.toX! - first.x, first.toY! - first.y)).toBe('e');
    expect(headingOf(last.toX! - last.x, last.toY! - last.y)).toBe('e');
    expect(first.attach?.from).toEqual({ object: 'a', port: 'east' });
    expect(last.attach?.to).toEqual({ object: 'b', port: 'west' });
    // The first pipe keeps id `p` and its own fields; the valve rides along on the new route.
    expect(first.id).toBe('p');
    expect(first).toMatchObject({ band: '#123456', meta: { tag: 'P-101' } });
    const valve = byId(s1, 'v')!;
    const host = byId(s1, valve.onPipe!)!;
    expect(positionOnPipe(segOf(host), valve.x, valve.y)).not.toBeNull();
    expect(endsConnected(s1.scene.objects)).toEqual([]);
    expect(s1.scene.objects.filter((o) => o.object === 'elbow').length).toBe(pipes.length - 1);

    const s2 = run(s1, { type: 'drag-end' });
    expect(s2.past).toHaveLength(1);
    expect(s2.revision).toBe(s0.revision + 1);
    expect(s2.scene.objects).toEqual(s1.scene.objects);
    // Undo restores vessel AND pipes in one step; redo brings both back.
    const undone = run(s2, { type: 'undo' });
    expect(undone.scene.objects).toEqual(s0.scene.objects);
    expect(run(undone, { type: 'redo' }).scene.objects).toEqual(s2.scene.objects);
  });

  it('moving straight along the pipe axis just shortens / stretches the straight', () => {
    const s = run(twoTanks(), { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 13, y: 0 }, { type: 'drag-end' });
    expect(pipesOf(s)).toEqual([expect.objectContaining({ id: 'p', x: 1, y: 0, toX: 12, toY: 0 })]);
    expect(s.scene.objects.some((o) => o.object === 'elbow')).toBe(false);
  });

  it('keeps scene order stable across frames (no reshuffling while dragging)', () => {
    const s = run(twoTanks(), { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 });
    expect(s.scene.objects.slice(0, 3).map((o) => o.id)).toEqual(['a', 'b', 'p']);
  });

  it('translates the run (no reroute) when both ends move together (multi-select)', () => {
    const s0 = run(twoTanks(), { type: 'select-many', ids: ['a', 'b'] });
    const s = run(s0, { type: 'drag-start', id: 'a', x: 0, y: 0 }, { type: 'drag-move', x: 3, y: 2 }, { type: 'drag-end' });
    expect(byId(s, 'p')).toMatchObject({ x: 4, y: 2, toX: 12, toY: 2 });
    expect(byId(s, 'v')).toMatchObject({ x: 8, y: 2, onPipe: 'p' });
    expect(s.scene.objects).toHaveLength(s0.scene.objects.length);
    expect(s.past).toHaveLength(1);
  });

  it('translates a dangling stub with its vessel', () => {
    const s0 = createEditorState(sceneOf([tank('a', 0, 0), pipe('stub', 1, 0, 4, 0)]));
    const s = run(s0, { type: 'drag-start', id: 'a', x: 0, y: 0 }, { type: 'drag-move', x: 0, y: 3 }, { type: 'drag-end' });
    expect(byId(s, 'stub')).toMatchObject({ x: 1, y: 3, toX: 4, toY: 3 });
  });

  it('carries an inline valve that has no onPipe record (hand-authored scenes)', () => {
    const s0 = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 10, 0), pipe('p', 1, 0, 9, 0), { id: 'v', object: 'valve', x: 5, y: 0 }]));
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 5 }, { type: 'drag-end' });
    const valve = byId(s, 'v')!;
    expect(valve.onPipe).toBeDefined();
    expect(positionOnPipe(segOf(byId(s, valve.onPipe!)!), valve.x, valve.y)).not.toBeNull();
  });

  it('a part on the pipe joint (valve between two runs) drags both runs with it', () => {
    const s0 = createEditorState(sceneOf([
      tank('a', 0, 0), tank('b', 12, 0),
      pipe('p1', 1, 0, 6, 0), pipe('p2', 6, 0, 11, 0),
      { id: 'v', object: 'valve', x: 6, y: 0 },
    ]));
    const s = run(s0, { type: 'drag-start', id: 'v', x: 6, y: 0 }, { type: 'drag-move', x: 6, y: 4 }, { type: 'drag-end' });
    expect(byId(s, 'v')).toMatchObject({ x: 6, y: 4 });
    expect(endsConnected(s.scene.objects)).toEqual([]);
    const atValve = pipesOf(s).filter((p) => (p.x === 6 && p.y === 4) || (p.toX === 6 && p.toY === 4));
    expect(atValve).toHaveLength(2);
  });

  it('snaps the delta to whole cells while pipes follow (routes live on grid nodes)', () => {
    const s = run(twoTanks(), { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10.5, y: 3.5 });
    expect(byId(s, 'b')).toMatchObject({ x: 11, y: 4 });
  });

  it('repeated pointer events in the same cell do not recompute the frame', () => {
    const s1 = run(twoTanks(), { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 });
    const s2 = run(s1, { type: 'drag-move', x: 10.2, y: 4.1 });
    expect(s2.scene).toBe(s1.scene);
    expect(s2.cursor).toEqual({ x: 10.2, y: 4.1 });
  });

  it('Esc mid-drag restores the vessel and every pipe, with no history', () => {
    const s0 = twoTanks();
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 }, { type: 'cancel' }, { type: 'drag-end' });
    expect(s.scene.objects).toEqual(s0.scene.objects);
    expect(s.past).toHaveLength(0);
    expect(s.revision).toBe(s0.revision);
    expect(s.drag).toBeNull();
  });

  it('a drag out and back commits nothing', () => {
    const s0 = twoTanks();
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 }, { type: 'drag-move', x: 10, y: 0 }, { type: 'drag-end' });
    expect(s.scene.objects).toBe(s0.scene.objects);
    expect(s.past).toHaveLength(0);
  });
});

describe('Alt-drag detaches', () => {
  it('moves the vessel alone, leaves the pipes and frees explicit records naming it', () => {
    const s0 = createEditorState(sceneOf([
      tank('a', 0, 0), tank('b', 10, 0),
      { ...pipe('p', 1, 0, 9, 0), attach: { from: { object: 'a', port: 'east' }, to: { object: 'b', port: 'west' } } },
    ]));
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10.5, y: 4, detach: true }, { type: 'drag-end' });
    expect(byId(s, 'b')).toMatchObject({ x: 10.5, y: 4 }); // no whole-cell snap when nothing follows
    expect(byId(s, 'p')).toMatchObject({ x: 1, y: 0, toX: 9, toY: 0, attach: { from: { object: 'a', port: 'east' } } });
    expect(s.past).toHaveLength(1);
  });

  it('toggling Alt mid-drag switches between follow and detach on the next frame', () => {
    const s1 = run(twoTanks(), { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4, detach: true });
    expect(byId(s1, 'p')).toMatchObject({ x: 1, y: 0, toX: 9, toY: 0 });
    const s2 = run(s1, { type: 'drag-move', x: 10, y: 4 });
    expect(pipesOf(s2).some((p) => p.toX === 9 && p.toY === 4)).toBe(true);
  });
});

describe('locked / hidden layers (holodeck#122)', () => {
  const lockedPipe = (hidden = false) => createEditorState(sceneOf([
    tank('a', 0, 0), tank('b', 10, 0), { ...pipe('p', 1, 0, 9, 0), layer: 'pipes' },
  ], { layers: [{ id: 'pipes', name: 'Pipes', ...(hidden ? { hidden: true } : { locked: true }) }] }));

  it.each([['locked', false], ['hidden', true]])('refuses to move a vessel whose pipe is %s, with a notice, and commits nothing', (_label, hidden) => {
    const s0 = lockedPipe(hidden);
    const s1 = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 });
    expect(s1.notice).toBe(FOLLOW_LOCKED_NOTICE);
    expect(s1.scene.objects).toBe(s0.scene.objects);
    const s2 = run(s1, { type: 'drag-end' });
    expect(s2.past).toHaveLength(0);
    expect(s2.scene.objects).toBe(s0.scene.objects);
    expect(s2.notice).toBe(FOLLOW_LOCKED_NOTICE);
  });

  it('Alt still moves the part alone (the locked pipe is untouched)', () => {
    const s = run(lockedPipe(), { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4, detach: true }, { type: 'drag-end' });
    expect(byId(s, 'b')).toMatchObject({ x: 10, y: 4 });
    expect(byId(s, 'p')).toMatchObject({ x: 1, y: 0, toX: 9, toY: 0, layer: 'pipes' });
  });

  it('a nudge refuses too', () => {
    const s = run(lockedPipe(), { type: 'select', id: 'b' }, { type: 'nudge', dx: 0, dy: 1 });
    expect(s.notice).toBe(FOLLOW_LOCKED_NOTICE);
    expect(s.past).toHaveLength(0);
  });
});

describe('unroutable drop positions', () => {
  // Tank `w` walls off the west side of b's port at y = 4: the port at (9, 4)
  // must be entered eastbound from (8, 4), which w's footprint (6..8) blocks.
  const walled = () => createEditorState(sceneOf([tank('a', 0, 0), tank('b', 10, 0), pipe('p', 1, 0, 9, 0), tank('w', 7, 4)]));

  it('shows the blocked run as a ghost with a notice, and keeps the original run in the scene', () => {
    const s0 = walled();
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 });
    expect(byId(s, 'b')).toMatchObject({ x: 10, y: 4 });
    expect(s.drag?.blocked).toHaveLength(1);
    expect(s.drag?.blocked[0]!.points[0]).toEqual({ x: 1, y: 0 });
    expect(s.drag?.blocked[0]!.points[s.drag.blocked[0]!.points.length - 1]).toEqual({ x: 9, y: 4 });
    expect(byId(s, 'p')).toMatchObject({ x: 1, y: 0, toX: 9, toY: 0 });
    expect(s.notice).toBe(FOLLOW_BLOCKED_NOTICE);
  });

  it('dropping there lands on the last position every pipe could follow (one undo step)', () => {
    const s = run(walled(),
      { type: 'drag-start', id: 'b', x: 10, y: 0 },
      { type: 'drag-move', x: 10, y: 2 },
      { type: 'drag-move', x: 10, y: 4 },
      { type: 'drag-end' });
    expect(byId(s, 'b')).toMatchObject({ x: 10, y: 2 });
    expect(pipesOf(s).some((p) => p.toX === 9 && p.toY === 2)).toBe(true);
    expect(s.notice).toBe(FOLLOW_SNAPPED_NOTICE);
    expect(s.past).toHaveLength(1);
    expect(endsConnected(s.scene.objects)).toEqual([]);
  });

  it('with no routable frame at all, the move is cancelled', () => {
    const s0 = walled();
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 }, { type: 'drag-end' });
    expect(s.scene.objects).toBe(s0.scene.objects);
    expect(s.past).toHaveLength(0);
    expect(s.notice).toBe(FOLLOW_CANCELLED_NOTICE);
  });

  it('moving back to a routable cell clears the blocked state and notice', () => {
    const s = run(walled(), { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 }, { type: 'drag-move', x: 10, y: 1 });
    expect(s.drag?.blocked).toEqual([]);
    expect(s.notice).toBeNull();
  });

  it('a nudge into an unroutable spot is refused', () => {
    const s0 = walled();
    const s = run(s0, { type: 'select', id: 'b' }, { type: 'nudge', dx: 0, dy: 4 });
    expect(s.notice).toBe(NUDGE_BLOCKED_NOTICE);
    expect(s.scene.objects).toBe(s0.scene.objects);
  });
});

describe('arrow-key nudge follows too', () => {
  it('moves the vessel and re-routes its pipe as one undo step', () => {
    const s0 = twoTanks();
    const s = run(s0, { type: 'select', id: 'b' }, { type: 'nudge', dx: 0, dy: 3 });
    expect(byId(s, 'b')).toMatchObject({ x: 10, y: 3 });
    expect(pipesOf(s).some((p) => p.toX === 9 && p.toY === 3)).toBe(true);
    expect(s.past).toHaveLength(1);
    expect(run(s, { type: 'undo' }).scene.objects).toEqual(s0.scene.objects);
  });
});

describe('attachment survives copy / paste / duplicate / delete', () => {
  const attached = () => createEditorState(sceneOf([
    tank('a', 0, 0), tank('b', 10, 0),
    { ...pipe('p', 1, 0, 9, 0), attach: { from: { object: 'a', port: 'east' }, to: { object: 'b', port: 'west' } } },
  ]));

  it('pasting a vessel with its pipe remaps the record to the new vessel and drops the end left behind', () => {
    const s = run(attached(), { type: 'select-many', ids: ['a', 'p'] }, { type: 'copy' }, { type: 'paste' });
    const pasted = pipesOf(s).find((p) => p.id !== 'p')!;
    const newTank = s.scene.objects.find((o) => o.object === 'tank' && !['a', 'b'].includes(o.id))!;
    expect(pasted.attach).toEqual({ from: { object: newTank.id, port: 'east' } });
  });

  it('a pasted copy follows its own vessel, not the original', () => {
    let s = run(attached(), { type: 'select-many', ids: ['a', 'b', 'p'] }, { type: 'duplicate' });
    const copyIds = s.selectedIds;
    const copyPipe = copyIds.find((id) => id.startsWith('pipe'))!;
    expect(byId(s, copyPipe)!.attach?.from?.object).not.toBe('a');
    const copyTank = byId(s, byId(s, copyPipe)!.attach!.to!.object)!;
    s = run(s, { type: 'select', id: copyTank.id }, { type: 'drag-start', id: copyTank.id, x: copyTank.x, y: copyTank.y }, { type: 'drag-move', x: copyTank.x, y: copyTank.y + 4 }, { type: 'drag-end' });
    expect(byId(s, 'p')).toMatchObject({ x: 1, y: 0, toX: 9, toY: 0 });
    expect(endsConnected(s.scene.objects)).toEqual([]);
  });

  it('deleting a vessel frees the pipe end (geometry kept)', () => {
    const s = run(attached(), { type: 'select', id: 'b' }, { type: 'delete' });
    expect(byId(s, 'p')).toMatchObject({ x: 1, y: 0, toX: 9, toY: 0, attach: { from: { object: 'a', port: 'east' } } });
  });

  it('undo after delete restores the record', () => {
    const s0 = attached();
    expect(run(s0, { type: 'select', id: 'b' }, { type: 'delete' }, { type: 'undo' }).scene.objects).toEqual(s0.scene.objects);
  });
});

describe('drawing and rerouting record attachments', () => {
  it('a pipe drawn from one tank port to another records both ends', () => {
    const s0 = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 10, 0)]));
    const s = run(s0, { type: 'pipe-mode' }, { type: 'floor-click', x: 1, y: 0 }, { type: 'floor-click', x: 9, y: 0 });
    const pipes = pipesOf(s);
    expect(pipes[0]!.attach?.from).toEqual({ object: 'a', port: 'east' });
    expect(pipes[pipes.length - 1]!.attach?.to).toEqual({ object: 'b', port: 'west' });
  });

  it('a pipe from a bare cell records nothing at that end', () => {
    const s = run(createEditorState(sceneOf([tank('b', 10, 0)])), { type: 'pipe-mode' }, { type: 'floor-click', x: 2, y: 0 }, { type: 'floor-click', x: 9, y: 0 });
    expect(pipesOf(s)[0]!.attach).toEqual({ to: { object: 'b', port: 'west' } });
  });

  it('Reroute (R) keeps explicit records on the new terminal pipes', () => {
    const s0 = createEditorState(sceneOf([
      tank('a', 0, 0), tank('b', 10, 0), tank('x', 5, 0),
      { ...pipe('p', 1, 0, 9, 0), attach: { from: { object: 'a', port: 'east' }, to: { object: 'b', port: 'west' } } },
    ]));
    const s = run(s0, { type: 'select', id: 'p' }, { type: 'reroute-selected' });
    const pipes = pipesOf(s);
    expect(pipes.length).toBeGreaterThan(1);
    expect(pipes.find((p) => p.x === 1 && p.y === 0)!.attach).toEqual({ from: { object: 'a', port: 'east' } });
    expect(pipes.find((p) => p.toX === 9 && p.toY === 0)!.attach).toEqual({ to: { object: 'b', port: 'west' } });
    // Records are route-owned: a middle segment never inherits them.
    expect(pipes.filter((p) => p.attach).length).toBe(2);
  });
});

describe('planFollow', () => {
  const editable = () => true;

  it('ignores runs the user is dragging themselves', () => {
    const objects = [tank('a', 0, 0), tank('b', 10, 0), pipe('p', 1, 0, 9, 0)];
    expect(planFollow(objects, registry, new Set(['b', 'p']), editable).runs).toEqual([]);
    expect(planFollow(objects, registry, new Set(['b']), editable).runs.map((r) => r.mode)).toEqual(['reroute']);
  });

  it('a run to a tee keeps the tee fixed and re-routes into it with the old heading', () => {
    // b's west port (9, 2) runs up -> left -> down into a tee at (5, 6) on the header.
    const scene = [tank('b', 10, 2), pipe('main', 0, 6, 5, 6), pipe('main2', 5, 6, 10, 6), pipe('up', 5, 6, 5, 2), pipe('in', 5, 2, 9, 2), pipe('stem', 5, 6, 5, 9)];
    const plan = planFollow(scene, registry, new Set(['b']), editable);
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]!.mode).toBe('reroute');
    const fixed = plan.runs[0]!.start.moves ? plan.runs[0]!.end : plan.runs[0]!.start;
    expect(fixed.point).toEqual({ x: 5, y: 6 });
    expect(fixed.heading).toBe('n');
  });
});

describe('mid-pipe tees pin the run (splitAtMidTees)', () => {
  // `main` runs (0,0) -> (10,0) into b's west port; `branch` tees into its middle at (5,0) without a joint.
  const teed = (extra: IsoPlacement[] = []) => createEditorState(sceneOf([
    tank('b', 11, 0),
    { ...pipe('main', 0, 0, 10, 0), band: '#00aa00', meta: { tag: 'M-1' } },
    pipe('branch', 5, 0, 5, -4),
    ...extra,
  ]));

  it('only the section between the moved port and the tee re-routes; the tee and the far side stay', () => {
    const s = run(teed(), { type: 'drag-start', id: 'b', x: 11, y: 0 }, { type: 'drag-move', x: 11, y: 3 }, { type: 'drag-end' });
    expect(byId(s, 'main')).toMatchObject({ x: 0, y: 0, toX: 5, toY: 0, band: '#00aa00', meta: { tag: 'M-1' } });
    expect(byId(s, 'branch')).toMatchObject({ x: 5, y: 0, toX: 5, toY: -4 });
    const fromTee = pipesOf(s).filter((p) => p.x === 5 && p.y === 0 && p.id !== 'branch');
    expect(fromTee).toHaveLength(1);
    expect(fromTee[0]!.band).toBe('#00aa00');
    expect(fromTee[0]!.meta).toBeUndefined(); // identity bags stay on the original id
    expect(pipesOf(s).some((p) => p.toX === 10 && p.toY === 3)).toBe(true);
    expect(endsConnected(s.scene.objects)).toEqual(['main.from', 'branch.to']); // the two authored free ends, nothing new
  });

  it('riders keep the piece they sit on; undo restores the unsplit pipe', () => {
    const s0 = teed([{ id: 'v1', object: 'valve', x: 2, y: 0, onPipe: 'main', at: 0.2 }, { id: 'v2', object: 'valve', x: 8, y: 0, onPipe: 'main', at: 0.8 }]);
    const s = run(s0, { type: 'drag-start', id: 'b', x: 11, y: 0 }, { type: 'drag-move', x: 11, y: 3 }, { type: 'drag-end' });
    expect(byId(s, 'v1')).toMatchObject({ x: 2, y: 0, onPipe: 'main' });
    const v2 = byId(s, 'v2')!;
    expect(v2.onPipe).not.toBe('main');
    expect(positionOnPipe(segOf(byId(s, v2.onPipe!)!), v2.x, v2.y)).not.toBeNull();
    expect(run(s, { type: 'undo' }).scene.objects).toEqual(s0.scene.objects);
  });

  it('an Alt-drag never splits anything', () => {
    const s0 = teed();
    const s = run(s0, { type: 'drag-start', id: 'b', x: 11, y: 0 }, { type: 'drag-move', x: 11, y: 3, detach: true }, { type: 'drag-end' });
    expect(pipesOf(s)).toEqual(pipesOf(s0));
  });
});


describe('PR #212 review fixes', () => {
  it('[P1] a follow that would drop a surplus segment carrying bindings / meta is refused, never silently deleted', () => {
    // a -> b through three collinear segments; p2 carries a live binding and metadata.
    const s0 = createEditorState(sceneOf([
      tank('a', 0, 0), tank('b', 10, 0),
      pipe('p1', 1, 0, 4, 0),
      { ...pipe('p2', 4, 0, 6, 0), meta: { tag: 'FT-2' }, bindings: { flow: { connection: 'plc', source: 'FT2' } } },
      pipe('p3', 6, 0, 9, 0),
    ]));
    const s1 = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 11, y: 0 });
    // Straightening into one pipe would remove p2: the frame is blocked, nothing is deleted.
    expect(s1.drag?.blocked).toHaveLength(1);
    expect(s1.drag?.blocked[0]!.reason).toBe('identity');
    expect(s1.notice).toMatch(/p2/);
    expect(byId(s1, 'p2')).toMatchObject({ meta: { tag: 'FT-2' }, bindings: { flow: { connection: 'plc', source: 'FT2' } } });
    const s2 = run(s1, { type: 'drag-end' });
    expect(s2.scene.objects).toEqual(s0.scene.objects);
    expect(s2.past).toHaveLength(0);
  });

  it('[P1] surplus segments without data still collapse (no needless refusal)', () => {
    const s0 = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 10, 0), pipe('p1', 1, 0, 4, 0), pipe('p2', 4, 0, 6, 0), pipe('p3', 6, 0, 9, 0)]));
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 11, y: 0 }, { type: 'drag-end' });
    expect(pipesOf(s)).toEqual([expect.objectContaining({ id: 'p1', x: 1, y: 0, toX: 10, toY: 0 })]);
  });

  it('[P1] a surplus segment referenced by another placement (connector anchor) is refused', () => {
    const s0 = createEditorState(sceneOf([
      tank('a', 0, 0), tank('b', 10, 0), pipe('p1', 1, 0, 4, 0), pipe('p2', 4, 0, 6, 0), pipe('p3', 6, 0, 9, 0),
      { id: 'c', object: 'connector', x: 5, y: 3, link: { from: { object: 'p2' }, to: { x: 5, y: 6 } } },
    ]));
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 11, y: 0 });
    expect(s.drag?.blocked[0]?.reason).toBe('identity');
  });

  it('#217 releasing Alt then dropping on a blocked spot never lands on the detached frame', () => {
    const s0 = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 10, 0), pipe('p', 1, 0, 9, 0), tank('w', 7, 4)]));
    const s = run(s0,
      { type: 'drag-start', id: 'b', x: 10, y: 0 },
      { type: 'drag-move', x: 10, y: 2, detach: true },
      { type: 'drag-move', x: 10, y: 4 },
      { type: 'drag-end' });
    // No follow frame ever routed: the move is cancelled, truthfully.
    expect(s.scene.objects).toEqual(s0.scene.objects);
    expect(s.notice).toBe(FOLLOW_CANCELLED_NOTICE);
  });

  it('#217 a routable follow frame before the Alt frames is still the fallback', () => {
    const s0 = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 10, 0), pipe('p', 1, 0, 9, 0), tank('w', 7, 4)]));
    const s = run(s0,
      { type: 'drag-start', id: 'b', x: 10, y: 0 },
      { type: 'drag-move', x: 10, y: 2 },
      { type: 'drag-move', x: 10, y: 3, detach: true },
      { type: 'drag-move', x: 10, y: 4 },
      { type: 'drag-end' });
    expect(byId(s, 'b')).toMatchObject({ x: 10, y: 2 });
    expect(pipesOf(s).some((p) => p.toX === 9 && p.toY === 2)).toBe(true);
    expect(s.notice).toBe(FOLLOW_SNAPPED_NOTICE);
  });

  it('#221 Esc clears the follow notice', () => {
    const s0 = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 10, 0), pipe('p', 1, 0, 9, 0), tank('w', 7, 4)]));
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 10, y: 4 });
    expect(s.notice).toBe(FOLLOW_BLOCKED_NOTICE);
    expect(run(s, { type: 'cancel' }).notice).toBeNull();
  });

  it('[P2] splitting at a mid-pipe tee refuses when a rider it would rewrite is on a locked layer', () => {
    const s0 = createEditorState(sceneOf([
      // b's east port (0, 0) feeds `main`; the locked valve sits on the far (stationary) side of the tee,
      // so the split would rewrite its onPipe to the new piece without it being part of the moving run.
      tank('b', -1, 0),
      pipe('main', 0, 0, 10, 0),
      pipe('branch', 5, 0, 5, -4),
      { id: 'v', object: 'valve', x: 8, y: 0, onPipe: 'main', at: 0.8, layer: 'locked' },
    ], { layers: [{ id: 'locked', name: 'Locked', locked: true }] }));
    const s = run(s0, { type: 'drag-start', id: 'b', x: -1, y: 0 }, { type: 'drag-move', x: -1, y: 3 });
    expect(s.notice).toBe(FOLLOW_LOCKED_NOTICE);
    expect(s.scene.objects).toBe(s0.scene.objects);
  });

  it('[P2] a palette drop is one action: places, selects, returns to select and reports `placed`', () => {
    const s0 = createEditorState(sceneOf([]));
    const s = run(s0, { type: 'palette-drop', object: 'tank', x: 2, y: 3 });
    expect(byId(s, 'tank-1')).toMatchObject({ x: 2, y: 3 });
    expect(s.placed).toBe('tank-1');
    expect(s.mode).toBe('select');
    expect(s.placing).toBeNull();
    expect(s.selectedIds).toEqual(['tank-1']);
    expect(s.past).toHaveLength(1);
  });
});

describe('PR #212 second review fixes', () => {
  const threeSegments = (middle: Partial<IsoPlacement>, extra: IsoPlacement[] = []) => createEditorState(sceneOf([
    tank('a', 0, 0), tank('b', 10, 0),
    { ...pipe('p1', 1, 0, 4, 0), band: '#e74c3c' },
    { ...pipe('p2', 4, 0, 6, 0), band: '#e74c3c', ...middle },
    { ...pipe('p3', 6, 0, 9, 0), band: '#e74c3c' },
    ...extra,
  ]));
  const straighten = (s0: EditorState) => run(s0, { type: 'drag-start', id: 'b', x: 10, y: 0 }, { type: 'drag-move', x: 11, y: 0 });

  it.each([
    ['band', { band: '#00ff00' }],
    ['params', { params: { insulated: true } }],
    ['group', { group: 'group-7' }],
    ['opacity', { opacity: 0.5 }],
    ['an unknown future field', { futureField: 'x' } as Partial<IsoPlacement>],
  ])('[P1] a surplus segment with a distinct %s is refused, not dropped', (_label, middle) => {
    const s0 = threeSegments(middle);
    const s1 = straighten(s0);
    expect(s1.drag?.blocked[0]?.reason).toBe('identity');
    expect(s1.notice).toMatch(/p2/);
    const s2 = run(s1, { type: 'drag-end' });
    expect(s2.scene.objects).toEqual(s0.scene.objects);
    expect(s2.past).toHaveLength(0);
  });

  it('[P1] a surplus segment whose user fields all equal the survivor collapses', () => {
    const same = createEditorState(sceneOf([
      tank('a', 0, 0), tank('b', 10, 0),
      { ...pipe('p1', 1, 0, 4, 0), band: '#e74c3c', group: 'g' },
      { ...pipe('p2', 4, 0, 6, 0), band: '#e74c3c', group: 'g' },
      { ...pipe('p3', 6, 0, 9, 0), band: '#e74c3c', group: 'g' },
    ]));
    const collapsed = run(straighten(same), { type: 'drag-end' });
    expect(pipesOf(collapsed)).toEqual([expect.objectContaining({ id: 'p1', toX: 10, band: '#e74c3c', group: 'g' })]);
    expect(collapsed.past).toHaveLength(1);
  });

  it('[P1] auto elbows removed by straightening do not block it', () => {
    const s0 = createEditorState(sceneOf([
      tank('a', 0, 0), tank('b', 10, 3),
      pipe('p1', 1, 0, 5, 0), { id: 'e1', object: 'elbow', x: 5, y: 0, params: { bend: 'auto' } },
      pipe('p2', 5, 0, 5, 3), { id: 'e2', object: 'elbow', x: 5, y: 3, params: { bend: 'auto' } },
      pipe('p3', 5, 3, 9, 3),
    ]));
    const s = run(s0, { type: 'drag-start', id: 'b', x: 10, y: 3 }, { type: 'drag-move', x: 10, y: 0 }, { type: 'drag-end' });
    expect(pipesOf(s)).toEqual([expect.objectContaining({ id: 'p1', x: 1, y: 0, toX: 9, toY: 0 })]);
  });

  it('[P2 regression] an out-and-back drag next to a free pipe end does not snap: no move, no history', () => {
    const s0 = createEditorState(sceneOf([tank('t', 0, 0), pipe('free', 2, 0, 8, 0)]));
    const s = run(s0, { type: 'drag-start', id: 't', x: 0, y: 0 }, { type: 'drag-move', x: 3, y: 3 }, { type: 'drag-move', x: 0, y: 0 }, { type: 'drag-end' });
    expect(byId(s, 't')).toMatchObject({ x: 0, y: 0 });
    expect(s.past).toHaveLength(0);
    expect(s.scene.objects).toBe(s0.scene.objects);
  });

  // b's west port takes the far end of `main`, which a branch tees into: the split
  // allocates a new piece for b's side, but the attach.to record lives on `main`.
  const teedAttached = () => createEditorState(sceneOf([
    tank('b', 11, 0),
    { ...pipe('main', 0, 0, 10, 0), attach: { to: { object: 'b', port: 'west' } } },
    pipe('branch', 5, 0, 5, -4),
  ]));

  it('[follow-up] Alt-drag frees the record on the real (unsplit) pipe', () => {
    const s = run(teedAttached(), { type: 'drag-start', id: 'b', x: 11, y: 0 }, { type: 'drag-move', x: 11, y: 3, detach: true }, { type: 'drag-end' });
    expect(byId(s, 'main')).toMatchObject({ x: 0, y: 0, toX: 10, toY: 0 });
    expect(byId(s, 'main')!.attach).toBeUndefined();
    expect(pipesOf(s)).toHaveLength(2);
  });

  it('[follow-up] toggling Alt on mid-drag also frees it', () => {
    const s = run(teedAttached(),
      { type: 'drag-start', id: 'b', x: 11, y: 0 },
      { type: 'drag-move', x: 11, y: 3 },
      { type: 'drag-move', x: 11, y: 3, detach: true },
      { type: 'drag-end' });
    expect(byId(s, 'main')!.attach).toBeUndefined();
    expect(byId(s, 'b')).toMatchObject({ x: 11, y: 3 });
  });
});
