/**
 * The studio's editor command sequences run against the REAL ProcessEditor
 * reducer (rendered in jsdom without WebGPU: no canvas, full editing state),
 * so they are checked against the editor's actual rules (review of
 * holodeck#128: pipes from the library, multi-selection and the inspector).
 */
import type { HolodeckHost } from '@holodeck/sdk';
import { ProcessEditor, type IsoSceneFile, type ProcessEditorHandle } from '@holodeck/editor-2.5d-react';
import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { createStudioHost } from '../host/studio-host';
import { withPart } from '../test-support';
import { inspectorActions, libraryAddActions, libraryDropActions } from './editor-commands';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
  // jsdom has no ResizeObserver; the editor only measures its canvas with it.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function mount(scene: IsoSceneFile) {
  const ref = createRef<ProcessEditorHandle>();
  const changes: IsoSceneFile[] = [];
  render(<ProcessEditor scene={scene} onChange={(s) => changes.push(s)} mode="edit" registry={host.registry} chrome="canvas" editorRef={ref} />);
  const run = (actions: ReturnType<typeof libraryAddActions>) => act(() => actions.forEach((a) => ref.current!.dispatch(a)));
  return { ref, changes, run, objects: () => ref.current!.getState().scene.objects };
}

const empty = (): IsoSceneFile => ({ id: 's', name: 'S', gridCellSize: 1, objects: [] });
function twoTanks() {
  let scene = withPart(empty(), host.registry, 'tank', 0, 0).scene;
  scene = withPart(scene, host.registry, 'tank', 6, 0).scene;
  return scene;
}

describe('libraryAddActions on the real editor', () => {
  it('adds a single-cell part in one undoable step and returns to select', () => {
    const { ref, run, objects, changes } = mount(empty());
    run(libraryAddActions(host.registry, 'valve', { x: 2, y: 3 }));
    expect(objects()).toMatchObject([{ object: 'valve', x: 2, y: 3 }]);
    expect(ref.current!.getState().mode).toBe('select');
    expect(changes).toHaveLength(1);
    act(() => ref.current!.dispatch({ type: 'undo' }));
    expect(objects()).toEqual([]);
  });

  it('adds a pipe (draw: run) as a drawn run, undoable', () => {
    const { ref, run, objects } = mount(empty());
    run(libraryAddActions(host.registry, 'pipe', { x: 0, y: 0 }));
    expect(objects().length).toBeGreaterThan(0);
    expect(objects().every((o) => o.object === 'pipe' || o.object === 'elbow')).toBe(true);
    expect(ref.current!.getState().mode).toBe('select');
    act(() => ref.current!.dispatch({ type: 'undo' }));
    expect(objects()).toEqual([]);
  });
});

describe('inspectorActions on the real editor', () => {
  it('delete from the inspector removes only the shown object, not the whole multi-selection', () => {
    const { ref, run, objects } = mount(twoTanks());
    // Canvas multi-selection whose primary (last) is tank-2.
    act(() => ref.current!.dispatch({ type: 'select-many', ids: ['tank-1', 'tank-2'] }));
    expect(ref.current!.getState().selectedId).toBe('tank-2');
    run(inspectorActions(ref.current!.getState().selectedIds, 'tank-2', { kind: 'delete' }));
    expect(objects().map((o) => o.id)).toEqual(['tank-1']);
  });

  it('rotate and param edits from the inspector change only the shown object', () => {
    const { ref, run, objects } = mount(twoTanks());
    act(() => ref.current!.dispatch({ type: 'select-many', ids: ['tank-1', 'tank-2'] }));
    run(inspectorActions(ref.current!.getState().selectedIds, 'tank-2', { kind: 'rotate', direction: 1 }));
    run(inspectorActions(ref.current!.getState().selectedIds, 'tank-2', { kind: 'param', name: 'level', value: 0.25 }));
    const [one, two] = objects();
    expect(one?.rotation ?? 0).toBe(0);
    expect(one?.params?.level).not.toBe(0.25);
    expect(two?.rotation).toBeCloseTo(Math.PI / 2);
    expect(two?.params?.level).toBe(0.25);
  });

  it('a single selection of the shown object is used as is (no extra select step)', () => {
    expect(inspectorActions(['tank-1'], 'tank-1', { kind: 'delete' })).toEqual([{ type: 'delete' }]);
    expect(inspectorActions([], 'tank-1', { kind: 'delete' })).toEqual([{ type: 'select', id: 'tank-1' }, { type: 'delete' }]);
  });

  it('a grouped object acts with its group, as a canvas click does', () => {
    let scene = twoTanks();
    scene = { ...scene, objects: scene.objects.map((o) => ({ ...o, group: 'group-1' })) };
    const { run, objects } = mount(scene);
    run(inspectorActions([], 'tank-1', { kind: 'delete' }));
    expect(objects()).toEqual([]);
  });

  it('binding edits set and remove placement.bindings as one undoable step each (holodeck#101)', () => {
    const { ref, run, objects } = mount(twoTanks());
    const binding = { connection: 'plant', source: 'sine:10' };
    run(inspectorActions([], 'tank-1', { kind: 'bindings', bindings: { level: binding } }));
    expect(objects()[0]?.bindings).toEqual({ level: binding });
    expect(objects()[1]?.bindings).toBeUndefined();
    run(inspectorActions(ref.current!.getState().selectedIds, 'tank-1', { kind: 'bindings', bindings: undefined }));
    expect(objects()[0]).not.toHaveProperty('bindings');
    act(() => ref.current!.dispatch({ type: 'undo' }));
    expect(objects()[0]?.bindings).toEqual({ level: binding });
  });
});

describe('libraryDropActions (library drag released)', () => {
  const state = (over: Partial<{ mode: string; placing: string | null; cursor: { x: number; y: number } | null }>) =>
    ({ mode: 'place', placing: 'tank', cursor: { x: 3, y: 4 }, ...over }) as Parameters<typeof libraryDropActions>[1];

  it('stamps the part at the ghost cell when released over the canvas', () => {
    expect(libraryDropActions(host.registry, state({}), 'tank', true)).toEqual([{ type: 'palette-drop', object: 'tank', x: 3, y: 4 }]);
  });

  it('cancels (back to select) when released off the canvas, or before the ghost reached a cell', () => {
    expect(libraryDropActions(host.registry, state({}), 'tank', false)).toEqual([{ type: 'select-mode' }]);
    expect(libraryDropActions(host.registry, state({ cursor: null }), 'tank', true)).toEqual([{ type: 'select-mode' }]);
  });

  it('does nothing when the tool no longer holds this part (Escape mid-drag, another tool)', () => {
    expect(libraryDropActions(host.registry, state({ mode: 'select', placing: null }), 'tank', true)).toEqual([]);
    expect(libraryDropActions(host.registry, state({ placing: 'valve' }), 'tank', true)).toEqual([]);
  });

  it('leaves a run part (pipe) armed: pipes are drawn click-click', () => {
    expect(libraryDropActions(host.registry, state({ mode: 'draw-pipe', placing: null }), 'pipe', true)).toEqual([]);
    expect(libraryDropActions(host.registry, state({ placing: 'pipe' }), 'pipe', true)).toEqual([]);
  });

  it('on the real editor: armed + ghost + drop is one undoable step that selects the new part', () => {
    const { ref, run, objects, changes } = mount(twoTanks());
    run([{ type: 'place-mode', object: 'mixer' }, { type: 'cursor', x: 3, y: 6 }]);
    run(libraryDropActions(host.registry, ref.current!.getState(), 'mixer', true));
    const placed = objects().find((o) => o.object === 'mixer');
    expect(placed).toMatchObject({ x: 3, y: 6 });
    expect(ref.current!.getState()).toMatchObject({ mode: 'select', selectedIds: [placed!.id] });
    expect(changes).toHaveLength(1);
    act(() => ref.current!.dispatch({ type: 'undo' }));
    expect(objects().some((o) => o.object === 'mixer')).toBe(false);
  });

  it('on the real editor: released off the canvas places nothing and drops the tool', () => {
    const { ref, run, objects, changes } = mount(twoTanks());
    run([{ type: 'place-mode', object: 'valve' }, { type: 'cursor', x: 3, y: 6 }]);
    run(libraryDropActions(host.registry, ref.current!.getState(), 'valve', false));
    expect(objects()).toHaveLength(2);
    expect(ref.current!.getState().mode).toBe('select');
    expect(changes).toHaveLength(0);
  });
});
