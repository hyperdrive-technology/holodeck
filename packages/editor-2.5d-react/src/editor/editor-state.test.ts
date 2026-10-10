import { describe, expect, it } from 'vitest';
import { getDefaultIsoRegistry } from '../registry/default';
import { committedScene, createEditorState, editorReducer, emptyScene, nextId, stamp } from './editor-state';

const registry = getDefaultIsoRegistry();

const blank = () => createEditorState(emptyScene('doc'));

describe('editorReducer', () => {
  it('allocates unique ids', () => {
    expect(nextId('tank', [])).toBe('tank-1');
    expect(nextId('tank', [stamp(registry, 'tank', 0, 0, 'tank-1')])).toBe('tank-2');
  });

  it('stamps a tank from the palette onto the grid', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'tank' });
    expect(s.mode).toBe('place');
    s = editorReducer(s, { type: 'floor-click', x: 2, y: -4 });
    expect(s.scene.objects).toHaveLength(1);
    expect(s.scene.objects[0]).toMatchObject({ object: 'tank', x: 2, y: -4, id: 'tank-1' });
    expect(s.selectedId).toBe('tank-1');
    expect(s.past).toHaveLength(1);
  });

  it('keeps stamping until the user cancels', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'valve' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'floor-click', x: 1, y: 0 });
    expect(s.scene.objects.map((o) => o.id)).toEqual(['valve-1', 'valve-2']);
    s = editorReducer(s, { type: 'cancel' });
    expect(s.mode).toBe('select');
    expect(s.placing).toBeNull();
  });

  it('routes a diagonal pipe as two segments plus an elbow', () => {
    let s = editorReducer(blank(), { type: 'pipe-mode' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'floor-click', x: 2, y: 1 });
    expect(s.scene.objects.map((o) => o.object).sort()).toEqual(['elbow', 'pipe', 'pipe']);
    const pipes = s.scene.objects.filter((o) => o.object === 'pipe');
    for (const pipe of pipes) {
      expect(pipe.x === pipe.toX || pipe.y === pipe.toY).toBe(true);
    }
  });

  it('continues a pipe run from the last click', () => {
    let s = editorReducer(blank(), { type: 'pipe-mode' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'floor-click', x: 3, y: 0 });
    expect(s.pipeStart).toEqual({ x: 3, y: 0 });
    s = editorReducer(s, { type: 'floor-click', x: 3, y: 2 });
    expect(s.scene.objects.filter((o) => o.object === 'pipe')).toHaveLength(2);
  });

  it('drags a selected object by the grid delta', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'drag-start', id: 'tank-1', x: 0, y: 0 });
    s = editorReducer(s, { type: 'drag-move', x: 2, y: -1 });
    expect(s.scene.objects[0]).toMatchObject({ x: 2, y: -1 });
    s = editorReducer(s, { type: 'drag-end' });
    expect(s.drag).toBeNull();
    expect(s.past.length).toBeGreaterThan(0);
    s = editorReducer(s, { type: 'undo' });
    expect(s.scene.objects[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('moves both ends of a pipe together', () => {
    let s = editorReducer(blank(), { type: 'pipe-mode' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'floor-click', x: 4, y: 0 });
    const pipe = s.scene.objects.find((o) => o.object === 'pipe')!;
    s = editorReducer(s, { type: 'drag-start', id: pipe.id, x: 0, y: 0 });
    s = editorReducer(s, { type: 'drag-move', x: 0, y: 2 });
    const moved = s.scene.objects.find((o) => o.id === pipe.id)!;
    expect(moved).toMatchObject({ x: 0, y: 2, toX: 4, toY: 2 });
  });

  it('deletes the selection and undoes it', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'label' });
    s = editorReducer(s, { type: 'floor-click', x: 1, y: 1 });
    s = editorReducer(s, { type: 'delete' });
    expect(s.scene.objects).toHaveLength(0);
    s = editorReducer(s, { type: 'undo' });
    expect(s.scene.objects[0]?.object).toBe('label');
    s = editorReducer(s, { type: 'redo' });
    expect(s.scene.objects).toHaveLength(0);
  });

  it('rotates a valve by 90°', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'valve' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'rotate-selected', direction: 1 });
    expect(s.scene.objects[0]?.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('clears the document', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'new-document' });
    expect(s.scene.objects).toHaveLength(0);
    s = editorReducer(s, { type: 'undo' });
    expect(s.scene.objects).toHaveLength(1);
  });

  it('stamps part defaults (deep-copied) and run-draw pipes', () => {
    const a = stamp(registry, 'mixer', 0, 0, 'm1');
    const b = stamp(registry, 'mixer', 1, 1, 'm2');
    expect(a).toMatchObject({ object: 'mixer', height: 2.7, params: { level: 0.38 } });
    a.params!.level = 0.9;
    expect(b.params!.level).toBe(0.38);
    expect(stamp(registry, 'pipe', 1, 2, 'p')).toMatchObject({ toX: 3, toY: 2, band: '#e74c3c' });
    expect(stamp(registry, 'label', 0, 0, 'l').params).toEqual({ text: 'Label' });
  });

  it('edits params on the selection', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'label' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'set-param', param: 'text', value: 'Hello' });
    expect(s.scene.objects[0]?.params).toEqual({ text: 'Hello' });
    s = editorReducer(s, { type: 'undo' });
    expect(s.scene.objects[0]?.params).toEqual({ text: 'Label' });
  });

  it('patch-selected merges fields but never changes the id', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, {
      type: 'patch-selected',
      patch: { id: 'evil', extensions: { 'host.bindings': { level: 'tag.a' } } },
    });
    expect(s.scene.objects[0]).toMatchObject({ id: 'tank-1', extensions: { 'host.bindings': { level: 'tag.a' } } });
  });

  it('keeps theme and extensions when clearing the document', () => {
    const base = createEditorState({ ...emptyScene('doc'), theme: 'holodeck.dark', extensions: { h: 1 } });
    const s = editorReducer(base, { type: 'new-document' });
    expect(s.scene).toMatchObject({ theme: 'holodeck.dark', extensions: { h: 1 } });
  });

  it('place-mode on a draw-run part enters pipe mode; unknown parts do not crash', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'pipe' });
    expect(s.mode).toBe('draw-pipe');
    s = editorReducer(blank(), { type: 'place-mode', object: 'nope' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    expect(s.scene.objects[0]).toMatchObject({ object: 'nope', id: 'nope-1' });
  });
});

describe('committed changes (onChange contract)', () => {
  const run = (start: ReturnType<typeof blank>, actions: Parameters<typeof editorReducer>[1][]) => {
    const emitted: unknown[] = [];
    let s = start;
    for (const action of actions) {
      const next = editorReducer(s, action);
      const scene = committedScene(s, next);
      if (scene) emitted.push(scene);
      s = next;
    }
    return { s, emitted };
  };

  it('emits once per place, not per cursor move', () => {
    const { emitted } = run(blank(), [
      { type: 'place-mode', object: 'tank' },
      { type: 'cursor', x: 1, y: 1 },
      { type: 'floor-click', x: 1, y: 1 },
      { type: 'cursor', x: 2, y: 2 },
    ]);
    expect(emitted).toHaveLength(1);
  });

  it('emits at drag-end only, and only if the part moved', () => {
    const placed = run(blank(), [
      { type: 'place-mode', object: 'tank' },
      { type: 'floor-click', x: 0, y: 0 },
    ]).s;
    const moved = run(placed, [
      { type: 'drag-start', id: 'tank-1', x: 0, y: 0 },
      { type: 'drag-move', x: 1, y: 0 },
      { type: 'drag-move', x: 2, y: 0 },
      { type: 'drag-end' },
    ]);
    expect(moved.emitted).toHaveLength(1);
    expect((moved.emitted[0] as { objects: Array<{ x: number }> }).objects[0]?.x).toBe(2);
    const click = run(placed, [
      { type: 'drag-start', id: 'tank-1', x: 0, y: 0 },
      { type: 'drag-end' },
    ]);
    expect(click.emitted).toHaveLength(0);
  });

  it('emits for undo, redo, delete and inspector edits; not for select or load', () => {
    const { emitted } = run(blank(), [
      { type: 'place-mode', object: 'label' },
      { type: 'floor-click', x: 0, y: 0 }, // 1
      { type: 'set-param', param: 'text', value: 'x' }, // 2
      { type: 'undo' }, // 3
      { type: 'redo' }, // 4
      { type: 'delete' }, // 5
      { type: 'select', id: null },
      { type: 'load', scene: emptyScene('other') },
    ]);
    expect(emitted).toHaveLength(5);
  });
});

describe('run mode', () => {
  const runState = () => createEditorState(emptyScene('doc'), { readOnly: true });
  const withTank = () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    return editorReducer(s, { type: 'set-read-only', readOnly: true });
  };

  it('ignores placing, pipes, deleting and history', () => {
    let s = runState();
    s = editorReducer(s, { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    s = editorReducer(s, { type: 'pipe-mode' });
    s = editorReducer(s, { type: 'new-document' });
    expect(s.mode).toBe('select');
    expect(s.scene.objects).toHaveLength(0);
    expect(s.revision).toBe(0);
  });

  it('ignores drags, deletes and inspector edits on an existing part', () => {
    const start = withTank();
    let s = editorReducer(start, { type: 'select', id: 'tank-1' });
    s = editorReducer(s, { type: 'drag-start', id: 'tank-1', x: 0, y: 0 });
    expect(s.drag).toBeNull();
    s = editorReducer(s, { type: 'drag-move', x: 5, y: 5 });
    s = editorReducer(s, { type: 'drag-end' });
    s = editorReducer(s, { type: 'delete' });
    s = editorReducer(s, { type: 'set-param', param: 'level', value: 1 });
    s = editorReducer(s, { type: 'rotate-selected', direction: 1 });
    s = editorReducer(s, { type: 'undo' });
    expect(s.scene).toEqual(start.scene);
    expect(s.revision).toBe(start.revision);
    expect(s.selectedId).toBe('tank-1');
  });

  it('still allows selection, and switching back to edit re-enables editing', () => {
    let s = editorReducer(withTank(), { type: 'select', id: 'tank-1' });
    expect(s.selectedId).toBe('tank-1');
    s = editorReducer(s, { type: 'set-read-only', readOnly: false });
    s = editorReducer(s, { type: 'delete' });
    expect(s.scene.objects).toHaveLength(0);
  });
});
