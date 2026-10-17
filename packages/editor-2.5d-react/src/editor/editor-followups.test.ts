/**
 * Editor follow-ups from the PR #114 reviews: #119 notice length, #120 paste
 * overflow count, #121 paste onto the active (default) layer, #122 reroute vs
 * locked / hidden layers, #107 live connector route, #108 image aspect in
 * fit-to-view bounds, #112 connector waypoints.
 */
import { describe, expect, it } from 'vitest';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { initialIsoPose } from '../iso/pose';
import { getDefaultIsoRegistry } from '../registry/default';
import { IMAGE_PART } from '../registry/annotation-parts';
import { liveConnectorObjects, connectorRouteKey } from '../objects/connector';
import { imageAspect, imageAspectVersion, setImageAspect } from '../objects/image-aspect';
import { insertWaypoint, moveWaypoint, removeWaypoint, waypointInsertHandles } from './connect';
import { MAX_NOTICE_LENGTH, createEditorState, editorReducer, emptyScene, type EditorAction, type EditorState } from './editor-state';
import { MAX_CLIPBOARD_OBJECTS } from './clipboard';
import { fitView, sceneWorldBox } from './fit';

const registry = getDefaultIsoRegistry();
const tank = (id: string, x: number, y: number, extra: Partial<IsoPlacement> = {}): IsoPlacement => ({ id, object: 'tank', x, y, ...extra });
const sceneOf = (objects: IsoPlacement[], extra: Partial<IsoSceneFile> = {}): IsoSceneFile => ({ ...emptyScene('doc'), objects, ...extra });
const run = (s: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);
const byId = (s: EditorState, id: string) => s.scene.objects.find((o) => o.id === id)!;

describe('#119 notices are capped', () => {
  it('a clipboard record without an id and a huge field gives a short notice', () => {
    const huge = { object: 'valve', x: 0, y: 0, junk: 'x'.repeat(5_000_000) };
    const s = run(createEditorState(sceneOf([])), { type: 'paste', objects: [huge] });
    expect(s.notice).toMatch(/Paste rejected/);
    expect(s.notice!.length).toBeLessThanOrEqual(MAX_NOTICE_LENGTH);
  });

  it('every notice is capped, whatever produced it', () => {
    const s = run(createEditorState(sceneOf([])), { type: 'paste', objects: [{ id: 'y'.repeat(10_000), object: 'nope', x: 0, y: 0 }] });
    expect(s.notice!.length).toBeLessThanOrEqual(MAX_NOTICE_LENGTH);
    expect(s.notice!.endsWith('…')).toBe(true);
  });
});

describe('#120 paste overflow count', () => {
  it('reports every record past the limit as skipped', () => {
    const many = Array.from({ length: MAX_CLIPBOARD_OBJECTS + 3 }, (_, i) => ({ id: `t${i}`, object: 'valve', x: i % 100, y: Math.floor(i / 100) }));
    const s = run(createEditorState(sceneOf([])), { type: 'paste', objects: many });
    expect(s.scene.objects).toHaveLength(MAX_CLIPBOARD_OBJECTS);
    expect(s.notice).toContain(`Pasted ${MAX_CLIPBOARD_OBJECTS} of ${MAX_CLIPBOARD_OBJECTS + 3}`);
  });
});

describe('#121 paste goes to the active layer, the default layer included', () => {
  const layered = () =>
    createEditorState(sceneOf([tank('a', 0, 0, { layer: 'l' })], { layers: [{ id: 'l', name: 'L' }] }));

  it('copy from a declared layer, paste with Default active: lands on Default', () => {
    const s = run(layered(), { type: 'select', id: 'a' }, { type: 'copy' }, { type: 'set-active-layer', id: 'default' }, { type: 'paste' });
    expect('layer' in byId(s, 'tank-1')).toBe(false);
  });

  it('paste with the declared layer active lands there', () => {
    const s = run(layered(), { type: 'select', id: 'a' }, { type: 'copy' }, { type: 'set-active-layer', id: 'l' }, { type: 'paste' });
    expect(byId(s, 'tank-1').layer).toBe('l');
  });

  it('duplicate keeps the source layer (it is a copy in place, not a paste)', () => {
    const s = run(layered(), { type: 'select', id: 'a' }, { type: 'set-active-layer', id: 'default' }, { type: 'duplicate' });
    expect(byId(s, 'tank-1').layer).toBe('l');
  });
});

describe('#122 reroute leaves locked / hidden layers alone', () => {
  const twoPipes = (flags: { locked?: boolean; hidden?: boolean }) =>
    createEditorState(
      sceneOf(
        [
          { id: 'p1', object: 'pipe', x: 0, y: 0, toX: 4, toY: 0 },
          { id: 'p2', object: 'pipe', x: 4, y: 0, toX: 8, toY: 0, layer: 'l' },
          tank('blk', 2, 0),
        ],
        { layers: [{ id: 'l', name: 'L', ...flags }] },
      ),
    );

  it.each([[{ locked: true }], [{ hidden: true }]])('rejects a run with a member on a %o layer', (flags) => {
    const s0 = run(twoPipes(flags), { type: 'select', id: 'p1' });
    const s = run(s0, { type: 'reroute-selected' });
    expect(s.scene).toBe(s0.scene);
    expect(s.past).toHaveLength(0);
    expect(s.notice).toMatch(/locked or hidden/);
  });

  it('still reroutes when every member is editable', () => {
    const s = run(twoPipes({}), { type: 'select', id: 'p1' }, { type: 'reroute-selected' });
    expect(s.past).toHaveLength(1);
  });

  it('rejects when a part hosted on the run is locked (it would be carried)', () => {
    const s0 = run(
      createEditorState(
        sceneOf(
          [
            { id: 'p1', object: 'pipe', x: 0, y: 0, toX: 8, toY: 0 },
            { id: 'v', object: 'valve', x: 6, y: 0, onPipe: 'p1', at: 0.75, layer: 'l' },
            tank('blk', 2, 0),
          ],
          { layers: [{ id: 'l', name: 'L', locked: true }] },
        ),
      ),
      { type: 'select', id: 'p1' },
    );
    const s = run(s0, { type: 'reroute-selected' });
    expect(s.scene).toBe(s0.scene);
    expect(s.notice).toMatch(/locked or hidden/);
  });
});

describe('#107 live route binding', () => {
  const objects: IsoPlacement[] = [
    tank('a', 0, 0),
    tank('b', 8, 0),
    tank('blk', 4, 0),
    { id: 'c', object: 'connector', x: 1, y: 0, link: { from: { object: 'a', port: 'east' }, to: { object: 'b', port: 'west' } } },
  ];

  it('applies a live `route` metric before resolving paths', () => {
    const live = liveConnectorObjects(objects, { c: { route: 'straight' } }, registry);
    expect(live.find((o) => o.id === 'c')?.params?.route).toBe('straight');
    expect(live.find((o) => o.id === 'a')).toBe(objects[0]);
  });

  it('keeps the array when no connector route is overridden (stable memo)', () => {
    expect(liveConnectorObjects(objects, undefined, registry)).toBe(objects);
    expect(liveConnectorObjects(objects, { a: { level: 0.5 } }, registry)).toBe(objects);
    expect(liveConnectorObjects(objects, { c: { route: 'diagonal' } }, registry)).toBe(objects);
  });

  it('the memo key changes with the live route only', () => {
    expect(connectorRouteKey(objects, { c: { route: 'straight' } }, registry)).not.toBe(connectorRouteKey(objects, undefined, registry));
    expect(connectorRouteKey(objects, { a: { level: 1 } }, registry)).toBe(connectorRouteKey(objects, undefined, registry));
  });
});

describe('#108 image bounds use the loaded aspect', () => {
  const img: IsoPlacement = { id: 'i', object: 'image', x: 0, y: 0, params: { src: 'portrait-108.png', width: 2, height: 0 } };

  it('falls back to square until the image has loaded, then uses width / aspect', () => {
    expect(IMAGE_PART.extent!(img)).toEqual({ minX: -1, minY: -1, maxX: 1, maxY: 1 });
    const v = imageAspectVersion();
    setImageAspect('portrait-108.png', 0.5);
    expect(imageAspectVersion()).toBe(v + 1);
    expect(imageAspect('portrait-108.png')).toBe(0.5);
    expect(IMAGE_PART.extent!(img)).toEqual({ minX: -1, minY: -2, maxX: 1, maxY: 2 });
    // Re-setting the same aspect does not bump the version (no refit loop).
    setImageAspect('portrait-108.png', 0.5);
    expect(imageAspectVersion()).toBe(v + 1);
  });

  it('letterboxed images (both sides set) keep their explicit box', () => {
    setImageAspect('wide-108.png', 4);
    expect(IMAGE_PART.extent!({ ...img, params: { src: 'wide-108.png', width: 2, height: 3 } })).toEqual({ minX: -1, minY: -1.5, maxX: 1, maxY: 1.5 });
  });

  it('a portrait image fits with a smaller zoom than the square guess', () => {
    const get = (id: string) => (id === 'image' ? IMAGE_PART : undefined);
    const tall = { ...img, params: { src: 'tall-108.png', width: 2, height: 0 } };
    const square = fitView(sceneWorldBox({ objects: [tall] }, get), initialIsoPose(18), 800, 600);
    setImageAspect('tall-108.png', 0.25);
    const real = fitView(sceneWorldBox({ objects: [tall] }, get), initialIsoPose(18), 800, 600);
    expect(real.zoom).toBeLessThan(square.zoom);
  });
});

describe('#112 connector waypoints', () => {
  const conn = (via?: Array<{ x: number; y: number }>): IsoPlacement => ({
    id: 'c',
    object: 'connector',
    x: 0,
    y: 0,
    toX: 10,
    toY: 0,
    ...(via ? { link: { via } } : {}),
  });

  it('pure helpers insert, move and remove (removing the last drops via / link)', () => {
    const one = insertWaypoint(conn(), 0, { x: 5, y: 3 });
    expect(one.link?.via).toEqual([{ x: 5, y: 3 }]);
    const two = insertWaypoint(one, 1, { x: 8, y: 3 });
    expect(two.link?.via).toEqual([{ x: 5, y: 3 }, { x: 8, y: 3 }]);
    expect(moveWaypoint(two, 0, { x: 4, y: 4 }).link?.via).toEqual([{ x: 4, y: 4 }, { x: 8, y: 3 }]);
    expect(removeWaypoint(two, 1).link?.via).toEqual([{ x: 5, y: 3 }]);
    expect(removeWaypoint(one, 0).link).toBeUndefined();
    expect(insertWaypoint(one, 99, { x: 1, y: 1 })).toBe(one);
    expect(moveWaypoint(one, 5, { x: 1, y: 1 })).toBe(one);
    expect(removeWaypoint(one, -1)).toBe(one);
  });

  it('insert handles sit at segment midpoints with the via index to insert at', () => {
    const scene = sceneOf([conn([{ x: 4, y: 4 }])]);
    const handles = waypointInsertHandles(scene, registry, scene.objects[0]!);
    expect(handles).toEqual([
      { index: 0, point: { x: 2, y: 2 } },
      { index: 1, point: { x: 7, y: 2 } },
    ]);
    const free = sceneOf([conn()]);
    expect(waypointInsertHandles(free, registry, free.objects[0]!)).toEqual([{ index: 0, point: { x: 5, y: 0 } }]);
  });

  it('insert / drag / remove through the reducer, one undo step each', () => {
    let s = run(createEditorState(sceneOf([conn()])), { type: 'select', id: 'c' });
    s = run(s, { type: 'waypoint-insert', id: 'c', index: 0, x: 5, y: 3 });
    expect(byId(s, 'c').link?.via).toEqual([{ x: 5, y: 3 }]);
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'link-drag-start', id: 'c', end: 'via', index: 0 }, { type: 'cursor', x: 6, y: 6 }, { type: 'link-drag-end' });
    expect(byId(s, 'c').link?.via).toEqual([{ x: 6, y: 6 }]);
    expect(s.past).toHaveLength(2);
    // Dropping a waypoint where it already is commits nothing.
    s = run(s, { type: 'link-drag-start', id: 'c', end: 'via', index: 0 }, { type: 'link-drag-end', x: 6, y: 6 });
    expect(s.past).toHaveLength(2);
    s = run(s, { type: 'waypoint-remove', id: 'c', index: 0 });
    expect(byId(s, 'c').link).toBeUndefined();
    expect(s.past).toHaveLength(3);
    s = run(s, { type: 'undo' }, { type: 'undo' });
    expect(byId(s, 'c').link?.via).toEqual([{ x: 5, y: 3 }]);
  });

  it('waypoint actions ignore non-connectors, bad indexes and locked connectors', () => {
    const locked = createEditorState(sceneOf([{ ...conn([{ x: 1, y: 1 }]), layer: 'l' }, tank('t', 20, 0)], { layers: [{ id: 'l', name: 'L', locked: true }] }));
    expect(run(locked, { type: 'waypoint-remove', id: 'c', index: 0 }).past).toHaveLength(0);
    expect(run(locked, { type: 'waypoint-insert', id: 't', index: 0, x: 1, y: 1 }).past).toHaveLength(0);
    const open = createEditorState(sceneOf([conn([{ x: 1, y: 1 }])]));
    expect(run(open, { type: 'waypoint-insert', id: 'c', index: 7, x: 1, y: 1 }).past).toHaveLength(0);
    expect(run(open, { type: 'waypoint-insert', id: 'c', index: 0, x: Number.NaN, y: 1 }).past).toHaveLength(0);
    expect(run(open, { type: 'link-drag-start', id: 'c', end: 'via', index: 4 }).linkDrag).toBeNull();
  });

  it('respects the via limit', () => {
    const full = createEditorState(sceneOf([conn(Array.from({ length: 64 }, (_, i) => ({ x: i, y: 1 })))]));
    const s = run(full, { type: 'waypoint-insert', id: 'c', index: 0, x: 0, y: 5 });
    expect(s.past).toHaveLength(0);
    expect(s.notice).toMatch(/Edit rejected|64/);
  });
});
