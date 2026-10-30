import { describe, expect, it } from 'vitest';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { resolvePipeEnd } from '../routing/attach';
import { pipe, registry, tank } from '../routing/test-helpers';
import { createEditorState, editorReducer, emptyScene, type EditorAction, type EditorState } from './editor-state';
import { freePipeEnds, portSnapOffset, PORT_SNAP_RADIUS, snapNewPlacement } from './port-snap';

const sceneOf = (objects: IsoPlacement[]): IsoSceneFile => ({ ...emptyScene('doc'), objects });
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const byId = (s: EditorState, id: string) => s.scene.objects.find((o) => o.id === id)!;

describe('freePipeEnds', () => {
  it('lists unattached lone ends with the direction into their pipe', () => {
    const objects = [tank('t', 0, 0), pipe('p', 1, 0, 5, 0), pipe('q', 5, 0, 5, 4), pipe('free', 10, 0, 14, 0)];
    expect(freePipeEnds(objects, registry).map((e) => `${e.pipeId}.${e.end}:${e.into}`)).toEqual([
      'q.to:n', 'free.from:e', 'free.to:w',
    ]);
  });

  it('skips ends on another pipe body (mid-pipe tee) and excluded pipes', () => {
    const objects = [pipe('main', 0, 0, 10, 0), pipe('branch', 5, 0, 5, 4)];
    expect(freePipeEnds(objects, registry).map((e) => `${e.pipeId}.${e.end}`)).toEqual(['main.from', 'main.to', 'branch.to']);
    expect(freePipeEnds(objects, registry, new Set(['main'])).map((e) => e.pipeId)).toEqual(['branch']);
  });
});

describe('portSnapOffset / snapNewPlacement', () => {
  const free = [pipe('free', 3, 0, 8, 0)]; // free end (3, 0), pipe runs east from it

  it('pulls a port within one cell onto a free end that leaves it outward', () => {
    const placed = snapNewPlacement(tank('t', 1.5, 0.5), free, registry);
    expect(placed).toMatchObject({ x: 2, y: 0 }); // east port (3, 0)
    expect(resolvePipeEnd([...free, placed], registry, free[0]!, 'from')).toMatchObject({ object: 't', port: 'east' });
  });

  it('does not snap a port that faces the wrong way, or one too far away', () => {
    expect(snapNewPlacement(tank('t', 4.5, 0), free, registry)).toMatchObject({ x: 4.5, y: 0 }); // west port faces w, pipe leaves e
    const far = 2 + PORT_SNAP_RADIUS + 0.5;
    expect(snapNewPlacement(tank('t', 2, far), free, registry)).toMatchObject({ x: 2, y: far });
  });

  it('never snaps onto an end that is already attached', () => {
    const objects = [tank('a', 9, 0), pipe('p', 3, 0, 8, 0)];
    expect(freePipeEnds(objects, registry).map((e) => e.end)).toEqual(['from']);
    expect(portSnapOffset([tank('t', 9, 1)], freePipeEnds(objects, registry), registry)).toBeNull();
  });

  it('nearest pair wins', () => {
    const ends = freePipeEnds([pipe('a', 3, 0, 8, 0), pipe('b', 3, 0.5, 8, 0.5)], registry);
    // Both ends lie east of a tank at (2, 0.4): (3, 0.5) is 0.1 away, (3, 0) 0.4.
    const offset = portSnapOffset([tank('t', 2, 0.4)], ends, registry)!;
    expect(offset.x).toBe(0);
    expect(offset.y).toBeCloseTo(0.1, 9);
    expect(snapNewPlacement(tank('t', 2, 0.4), [pipe('a', 3, 0, 8, 0), pipe('b', 3, 0.5, 8, 0.5)], registry)).toMatchObject({ x: 2, y: 0.5 });
  });
});

describe('placing and dragging snap ports onto free pipe ends', () => {
  it('a palette stamp near a free end lands on it, and the pipe then follows that tank', () => {
    let s = createEditorState(sceneOf([pipe('free', 3, 0, 8, 0)]));
    s = run(s, { type: 'place-mode', object: 'tank' }, { type: 'floor-click', x: 1.5, y: 0.5 });
    expect(byId(s, 'tank-1')).toMatchObject({ x: 2, y: 0 });
    s = run(s, { type: 'select-mode' }, { type: 'drag-start', id: 'tank-1', x: 2, y: 0 }, { type: 'drag-move', x: 2, y: -3 }, { type: 'drag-end' });
    // The stub's far end is free, so it rides along rigidly with its new vessel.
    expect(byId(s, 'free')).toMatchObject({ x: 3, y: -3, toX: 8, toY: -3 });
  });

  it('dragging a vessel next to a free end snaps it on; Alt disables the snap', () => {
    const s0 = createEditorState(sceneOf([pipe('free', 12, 0, 16, 0), tank('t', 5, 5)]));
    const snapped = run(s0, { type: 'drag-start', id: 't', x: 5, y: 5 }, { type: 'drag-move', x: 10.5, y: 0.5 });
    expect(byId(snapped, 't')).toMatchObject({ x: 11, y: 0 });
    const alt = run(s0, { type: 'drag-start', id: 't', x: 5, y: 5 }, { type: 'drag-move', x: 10.5, y: 0.5, detach: true });
    expect(byId(alt, 't')).toMatchObject({ x: 10.5, y: 0.5 });
  });

  it('vice versa: dragging a pipe so its free end nears a port snaps the pipe on', () => {
    const s0 = createEditorState(sceneOf([tank('t', 0, 0), pipe('free', 5, 3, 9, 3)]));
    // Free end (5, 3) leaves east; the tank's east port is (1, 0): move the pipe by (-4, -3) +- half a cell.
    const s = run(s0, { type: 'drag-start', id: 'free', x: 5, y: 3 }, { type: 'drag-move', x: 1.5, y: 0.5 }, { type: 'drag-end' });
    expect(byId(s, 'free')).toMatchObject({ x: 1, y: 0, toX: 5, toY: 0 });
    expect(resolvePipeEnd(s.scene.objects, registry, byId(s, 'free'), 'from')).toMatchObject({ object: 't', port: 'east' });
  });
});
