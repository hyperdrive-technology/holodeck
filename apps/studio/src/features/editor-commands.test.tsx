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
import { inspectorActions, libraryAddActions } from './editor-commands';

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
});
