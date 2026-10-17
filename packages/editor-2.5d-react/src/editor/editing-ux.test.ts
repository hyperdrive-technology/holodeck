/**
 * Lane E3 (holodeck#37, #91, #92): multi-select, copy / paste / duplicate,
 * align / distribute, rotation, layers, groups, z-order and connector
 * drawing, each one undoable step in the editor history.
 */
import { describe, expect, it } from 'vitest';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { getDefaultIsoRegistry } from '../registry/default';
import {
  createEditorState,
  editorReducer,
  emptyScene,
  selectedObjects,
  stampPlacement,
  type EditorAction,
  type EditorState,
} from './editor-state';

const registry = getDefaultIsoRegistry();

const tank = (id: string, x: number, y: number, extra: Partial<IsoPlacement> = {}): IsoPlacement => ({ id, object: 'tank', x, y, ...extra });
const valve = (id: string, x: number, y: number, extra: Partial<IsoPlacement> = {}): IsoPlacement => ({ id, object: 'valve', x, y, ...extra });

function sceneOf(objects: IsoPlacement[], extra: Partial<IsoSceneFile> = {}): IsoSceneFile {
  return { ...emptyScene('doc'), objects, ...extra };
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

const three = () => createEditorState(sceneOf([tank('a', 0, 0), tank('b', 6, 2), tank('c', 12, 5)]));
const byId = (s: EditorState, id: string) => s.scene.objects.find((o) => o.id === id)!;
const ids = (s: EditorState) => s.scene.objects.map((o) => o.id);

describe('selection', () => {
  it('starts empty and keeps selectedId as the last selectedIds entry', () => {
    let s = three();
    expect(s.selectedIds).toEqual([]);
    s = run(s, { type: 'select', id: 'a' });
    expect(s.selectedIds).toEqual(['a']);
    expect(s.selectedId).toBe('a');
  });

  it('shift-click (additive) adds and toggles', () => {
    let s = run(three(), { type: 'select', id: 'a' }, { type: 'select', id: 'b', additive: true });
    expect(s.selectedIds).toEqual(['a', 'b']);
    expect(s.selectedId).toBe('b');
    s = run(s, { type: 'select', id: 'a', additive: true });
    expect(s.selectedIds).toEqual(['b']);
    expect(s.selectedId).toBe('b');
    s = run(s, { type: 'select', id: 'b', additive: true });
    expect(s.selectedIds).toEqual([]);
    expect(s.selectedId).toBeNull();
  });

  it('plain click replaces a multi-selection', () => {
    const s = run(three(), { type: 'select-all' }, { type: 'select', id: 'c' });
    expect(s.selectedIds).toEqual(['c']);
  });

  it('select-many replaces, or extends when additive (marquee)', () => {
    let s = run(three(), { type: 'select', id: 'c' }, { type: 'select-many', ids: ['a', 'b'] });
    expect(s.selectedIds).toEqual(['a', 'b']);
    s = run(s, { type: 'select-many', ids: ['c'], additive: true });
    expect(s.selectedIds.sort()).toEqual(['a', 'b', 'c']);
    s = run(s, { type: 'select-many', ids: ['nope'] });
    expect(s.selectedIds).toEqual([]);
  });

  it('floor click clears the selection; selection is not a commit', () => {
    const s = run(three(), { type: 'select-all' });
    expect(s.selectedIds).toHaveLength(3);
    expect(s.revision).toBe(0);
    expect(run(s, { type: 'floor-click', x: 30, y: 30 }).selectedIds).toEqual([]);
  });

  it('a setter that only writes selectedId (palette place) collapses selectedIds to it', () => {
    const s = run(three(), { type: 'select-all' }, { type: 'place-mode', object: 'valve' }, { type: 'floor-click', x: 3, y: -4 });
    expect(s.selectedIds).toEqual(['valve-1']);
    expect(s.selectedId).toBe('valve-1');
  });

  it('undo drops ids the restored scene no longer has', () => {
    let s = run(three(), { type: 'place-mode', object: 'valve' }, { type: 'floor-click', x: 3, y: -4 }, { type: 'select-all' });
    expect(s.selectedIds).toContain('valve-1');
    s = run(s, { type: 'undo' });
    expect(s.selectedIds).not.toContain('valve-1');
    expect(s.selectedIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('run mode selects single parts only (no multi edits) and copy still works', () => {
    let s = createEditorState(three().scene, { readOnly: true });
    s = run(s, { type: 'select', id: 'a' }, { type: 'select-all' }, { type: 'delete' });
    expect(s.selectedIds).toEqual(['a']);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    s = run(s, { type: 'copy' });
    expect(s.clipboard?.map((o) => o.id)).toEqual(['a']);
  });
});

describe('multi-select drag, delete and multi-edit', () => {
  it('dragging one selected part moves the whole selection as one undo step', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'b'] });
    s = run(s, { type: 'drag-start', id: 'a', x: 0, y: 0 }, { type: 'drag-move', x: 1, y: 2 }, { type: 'drag-move', x: 2, y: 3 }, { type: 'drag-end' });
    expect(byId(s, 'a')).toMatchObject({ x: 2, y: 3 });
    expect(byId(s, 'b')).toMatchObject({ x: 8, y: 5 });
    expect(byId(s, 'c')).toMatchObject({ x: 12, y: 5 });
    expect(s.selectedIds.sort()).toEqual(['a', 'b']);
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'undo' });
    expect(byId(s, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(byId(s, 'b')).toMatchObject({ x: 6, y: 2 });
  });

  it('dragging an unselected part replaces the selection with it', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'b'] });
    s = run(s, { type: 'drag-start', id: 'c', x: 12, y: 5 }, { type: 'drag-move', x: 13, y: 5 }, { type: 'drag-end' });
    expect(s.selectedIds).toEqual(['c']);
    expect(byId(s, 'a').x).toBe(0);
    expect(byId(s, 'c').x).toBe(13);
  });

  it('a multi drag out and back commits nothing', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'b'] });
    s = run(s, { type: 'drag-start', id: 'a', x: 0, y: 0 }, { type: 'drag-move', x: 3, y: 0 }, { type: 'drag-move', x: 0, y: 0 }, { type: 'drag-end' });
    expect(s.past).toHaveLength(0);
    expect(byId(s, 'b')).toMatchObject({ x: 6, y: 2 });
  });

  it('delete removes every selected part in one step', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'c'] }, { type: 'delete' });
    expect(ids(s)).toEqual(['b']);
    expect(s.selectedIds).toEqual([]);
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'undo' });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
  });

  it('set-param edits every selected part of the primary part type', () => {
    let s = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 6, 0), valve('v', 3, 4)]));
    s = run(s, { type: 'select-many', ids: ['v', 'a', 'b'] }, { type: 'set-param', param: 'level', value: 0.9 });
    expect(s.selectedId).toBe('b');
    expect(byId(s, 'a').params?.level).toBe(0.9);
    expect(byId(s, 'b').params?.level).toBe(0.9);
    expect(byId(s, 'v').params?.level).toBeUndefined();
    expect(s.past).toHaveLength(1);
  });

  it('patch-selection sets opacity on all, patch-selected only on the primary', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'b'] }, { type: 'patch-selection', patch: { opacity: 0.5 } });
    expect(byId(s, 'a').opacity).toBe(0.5);
    expect(byId(s, 'b').opacity).toBe(0.5);
    s = run(s, { type: 'patch-selected', patch: { opacity: 0.25 } });
    expect(byId(s, 'a').opacity).toBe(0.5);
    expect(byId(s, 'b').opacity).toBe(0.25);
  });

  it('a patch with undefined removes the field (opacity back to the default)', () => {
    let s = run(three(), { type: 'select', id: 'a' }, { type: 'patch-selected', patch: { opacity: 0.5, meta: { k: 1 } } });
    s = run(s, { type: 'patch-selected', patch: { opacity: undefined, meta: undefined } });
    expect('opacity' in byId(s, 'a')).toBe(false);
    expect('meta' in byId(s, 'a')).toBe(false);
  });

  it('an invalid multi-edit is rejected whole', () => {
    const s = run(three(), { type: 'select-all' }, { type: 'patch-selection', patch: { opacity: 3 } });
    expect(s.notice).toMatch(/Edit rejected/);
    expect(s.scene.objects.every((o) => o.opacity === undefined)).toBe(true);
    expect(s.past).toHaveLength(0);
  });

  it('nudge moves the selection by whole cells', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'b'] }, { type: 'nudge', dx: 1, dy: -1 });
    expect(byId(s, 'a')).toMatchObject({ x: 1, y: -1 });
    expect(byId(s, 'b')).toMatchObject({ x: 7, y: 1 });
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'nudge', dx: Number.NaN, dy: 0 });
    expect(s.past).toHaveLength(1);
  });
});

describe('copy / cut / paste / duplicate', () => {
  it('copy is not a commit; paste adds fresh ids offset by one cell and selects them', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'b'] }, { type: 'copy' });
    expect(s.revision).toBe(0);
    expect(s.clipboard?.map((o) => o.id)).toEqual(['a', 'b']);
    s = run(s, { type: 'paste' });
    expect(ids(s)).toEqual(['a', 'b', 'c', 'tank-1', 'tank-2']);
    expect(byId(s, 'tank-1')).toMatchObject({ x: 1, y: 1 });
    expect(byId(s, 'tank-2')).toMatchObject({ x: 7, y: 3 });
    expect(s.selectedIds).toEqual(['tank-1', 'tank-2']);
    expect(s.past).toHaveLength(1);
  });

  it('repeated paste cascades instead of stacking', () => {
    const s = run(three(), { type: 'select', id: 'a' }, { type: 'copy' }, { type: 'paste' }, { type: 'paste' });
    expect(byId(s, 'tank-1')).toMatchObject({ x: 1, y: 1 });
    expect(byId(s, 'tank-2')).toMatchObject({ x: 2, y: 2 });
  });

  it('paste with an empty clipboard does nothing', () => {
    const s = run(three(), { type: 'paste' });
    expect(s.revision).toBe(0);
  });

  it('cut copies and deletes in one step; undo restores', () => {
    let s = run(three(), { type: 'select', id: 'b' }, { type: 'cut' });
    expect(ids(s)).toEqual(['a', 'c']);
    expect(s.clipboard?.[0]).toMatchObject({ id: 'b', x: 6 });
    expect(s.past).toHaveLength(1);
    // Cut + paste lands back in place (nothing identical there any more).
    s = run(s, { type: 'paste' });
    expect(byId(s, 'tank-1')).toMatchObject({ x: 6, y: 2 });
    s = run(s, { type: 'undo' }, { type: 'undo' });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
  });

  it('duplicate leaves the clipboard alone', () => {
    let s = run(three(), { type: 'select', id: 'c' }, { type: 'copy' }, { type: 'select', id: 'a' }, { type: 'duplicate' });
    expect(byId(s, 'tank-1')).toMatchObject({ x: 1, y: 1 });
    expect(s.clipboard?.map((o) => o.id)).toEqual(['c']);
    s = run(s, { type: 'undo' });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
  });

  it('remaps groups, connector anchors and pipe attachments inside the copy', () => {
    const scene = sceneOf([
      tank('a', 0, 0, { group: 'group-1' }),
      tank('b', 6, 0, { group: 'group-1' }),
      { id: 'link', object: 'connector', x: 1, y: 0, link: { from: { object: 'a', port: 'east' }, to: { object: 'b' } }, group: 'group-1' },
      { id: 'p', object: 'pipe', x: 0, y: 6, toX: 4, toY: 6 },
      valve('v', 2, 6, { onPipe: 'p', at: 0.5 }),
    ]);
    let s = createEditorState(scene);
    s = run(s, { type: 'select-all' }, { type: 'copy' }, { type: 'paste' });
    const pasted = selectedObjects(s);
    expect(pasted).toHaveLength(5);
    const newTanks = pasted.filter((o) => o.object === 'tank').map((o) => o.id);
    const connector = pasted.find((o) => o.object === 'connector')!;
    expect(connector.link?.from).toEqual({ object: newTanks[0], port: 'east' });
    expect(connector.link?.to).toEqual({ object: newTanks[1] });
    expect(new Set(pasted.filter((o) => o.object !== 'pipe' && o.object !== 'valve').map((o) => o.group))).toEqual(new Set(['group-2']));
    expect(pasted.find((o) => o.object === 'pipe')?.group).toBeUndefined();
    const pipe = pasted.find((o) => o.object === 'pipe')!;
    expect(pasted.find((o) => o.object === 'valve')?.onPipe).toBe(pipe.id);
  });

  it('a connector copied without its anchors keeps its shape as a free line', () => {
    const scene = sceneOf([
      tank('a', 0, 0),
      tank('b', 6, 0),
      { id: 'link', object: 'connector', x: 1, y: 0, link: { from: { object: 'a', port: 'east' }, to: { object: 'b' } } },
    ]);
    const s = run(createEditorState(scene), { type: 'select', id: 'link' }, { type: 'copy' });
    expect(s.clipboard?.[0]?.link).toEqual({ from: { x: 1, y: 0 }, to: { x: 6, y: 0 } });
  });

  it('pastes host-provided objects (system clipboard) and validates them', () => {
    let s = run(three(), { type: 'paste', objects: [valve('x', 20, 20)] });
    expect(byId(s, 'valve-1')).toMatchObject({ x: 20, y: 20 });
    s = run(s, { type: 'paste', objects: [{ id: 'bad', object: 'valve', x: Number.POSITIVE_INFINITY, y: 0 }] });
    expect(s.notice).toMatch(/Edit rejected/);
    s = run(s, { type: 'paste', objects: [{ id: 'q', object: 'not-a-part', x: 0, y: 0 }] });
    expect(s.notice).toMatch(/unknown library object/);
  });

  it('the clipboard survives switching documents', () => {
    let s = run(three(), { type: 'select', id: 'a' }, { type: 'copy' });
    s = run(s, { type: 'load', scene: sceneOf([], { id: 'other' }) });
    expect(s.scene.id).toBe('other');
    s = run(s, { type: 'paste' });
    expect(ids(s)).toEqual(['tank-1']);
  });
});

describe('align, distribute and rotate', () => {
  it('aligns min / max / centre on grid x and y using footprints', () => {
    // Tanks are 2x2; the valve is 1x1.
    const base = createEditorState(sceneOf([tank('a', 0, 0), valve('v', 5, 3)]));
    const sel = run(base, { type: 'select-all' });
    let s = run(sel, { type: 'align', edge: 'min-x' });
    // Box min x = -1 (tank left edge); valve's left edge 4.5 -> -1 => dx = -5.5 rounded to -5 (or -6).
    expect(Math.abs(byId(s, 'v').x - -0.5)).toBeLessThanOrEqual(0.5);
    expect(byId(s, 'a').x).toBe(0);
    expect(s.past).toHaveLength(1);
    s = run(sel, { type: 'align', edge: 'center-y' });
    // Box y -1..3.5, centre 1.25: both centres round onto y = 1.
    expect(byId(s, 'a').y).toBe(1);
    expect(byId(s, 'v').y).toBe(1);
    s = run(sel, { type: 'align', edge: 'max-y' });
    // Bottom edges within the half-cell rounding (2x2 tank vs 1x1 valve).
    expect(Math.abs(byId(s, 'a').y + 1 - (byId(s, 'v').y + 0.5))).toBeLessThanOrEqual(0.5);
  });

  it('align of an already aligned selection or of one part commits nothing', () => {
    const s = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 0, 6)]));
    expect(run(s, { type: 'select-all' }, { type: 'align', edge: 'center-x' }).past).toHaveLength(0);
    expect(run(s, { type: 'select', id: 'a' }, { type: 'align', edge: 'min-y' }).past).toHaveLength(0);
  });

  it('distributes centres evenly between the outer parts', () => {
    const s = run(
      createEditorState(sceneOf([tank('a', 0, 0), tank('b', 2, 3), tank('c', 12, 7), tank('d', 15, 0)])),
      { type: 'select-all' },
      { type: 'distribute', axis: 'x' },
    );
    expect([byId(s, 'a').x, byId(s, 'b').x, byId(s, 'c').x, byId(s, 'd').x]).toEqual([0, 5, 10, 15]);
    // y untouched
    expect(byId(s, 'c').y).toBe(7);
    expect(run(createEditorState(sceneOf([tank('a', 0, 0), tank('b', 9, 0)])), { type: 'select-all' }, { type: 'distribute', axis: 'x' }).past).toHaveLength(0);
  });

  it('groups move as one unit when aligning', () => {
    const s = run(
      createEditorState(sceneOf([tank('a', 0, 0, { group: 'g' }), tank('b', 4, 0, { group: 'g' }), tank('c', 0, 8)])),
      { type: 'select-all' },
      { type: 'align', edge: 'max-x' },
    );
    expect(byId(s, 'a').x).toBe(0);
    expect(byId(s, 'b').x).toBe(4);
    expect(byId(s, 'c').x).toBe(4);
  });

  it('rotates a multi-selection a quarter turn around its centre, turning each part', () => {
    let s = createEditorState(sceneOf([tank('a', 0, 0), tank('b', 4, 0), { id: 'p', object: 'pipe', x: 0, y: 2, toX: 4, toY: 2 }]));
    s = run(s, { type: 'select-all' }, { type: 'rotate-selected', direction: 1 });
    // Box -1..5 x -1..2 -> pivot (2, 1) rounded.
    const a = byId(s, 'a');
    const b = byId(s, 'b');
    const p = byId(s, 'p');
    expect(a.rotation).toBeCloseTo(Math.PI / 2);
    expect(b.rotation).toBeCloseTo(Math.PI / 2);
    expect(p.rotation).toBeUndefined();
    // a and b now share x (they were on one row), the pipe is vertical.
    expect(a.x).toBe(b.x);
    expect(p.x).toBe(p.toX);
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'rotate-selected', direction: -1 });
    expect(byId(s, 'a')).toMatchObject({ x: 0, y: 0 });
    expect(byId(s, 'p')).toMatchObject({ x: 0, y: 2, toX: 4, toY: 2 });
  });

  it('single-part rotation keeps the old behaviour (yaw only)', () => {
    const s = run(three(), { type: 'select', id: 'b' }, { type: 'rotate-selected', direction: -1 });
    expect(byId(s, 'b')).toMatchObject({ x: 6, y: 2 });
    expect(byId(s, 'b').rotation).toBeCloseTo(-Math.PI / 2);
  });
});

describe('groups', () => {
  it('groups the selection; clicking one member selects the group', () => {
    let s = run(three(), { type: 'select-many', ids: ['a', 'b'] }, { type: 'group-selected' });
    expect(byId(s, 'a').group).toBe('group-1');
    expect(byId(s, 'b').group).toBe('group-1');
    expect(byId(s, 'c').group).toBeUndefined();
    expect(s.past).toHaveLength(1);
    s = run(s, { type: 'select', id: 'a' });
    expect(s.selectedIds.sort()).toEqual(['a', 'b']);
    expect(s.selectedId).toBe('a');
  });

  it('needs two parts to group; ungroup clears the group of every selected part', () => {
    let s = run(three(), { type: 'select', id: 'a' }, { type: 'group-selected' });
    expect(s.past).toHaveLength(0);
    s = run(s, { type: 'select-many', ids: ['a', 'b', 'c'] }, { type: 'group-selected' }, { type: 'select', id: 'c' });
    expect(s.selectedIds).toHaveLength(3);
    s = run(s, { type: 'ungroup-selected' });
    expect(s.scene.objects.every((o) => o.group === undefined)).toBe(true);
    s = run(s, { type: 'select', id: 'c' });
    expect(s.selectedIds).toEqual(['c']);
  });

  it('shift-click toggles a whole group', () => {
    let s = createEditorState(sceneOf([tank('a', 0, 0, { group: 'g' }), tank('b', 4, 0, { group: 'g' }), tank('c', 0, 8)]));
    s = run(s, { type: 'select', id: 'c' }, { type: 'select', id: 'a', additive: true });
    expect(s.selectedIds.sort()).toEqual(['a', 'b', 'c']);
    s = run(s, { type: 'select', id: 'b', additive: true });
    expect(s.selectedIds).toEqual(['c']);
  });

  it('dragging a group member drags the group', () => {
    let s = createEditorState(sceneOf([tank('a', 0, 0, { group: 'g' }), tank('b', 4, 0, { group: 'g' })]));
    s = run(s, { type: 'drag-start', id: 'b', x: 4, y: 0 }, { type: 'drag-move', x: 4, y: 3 }, { type: 'drag-end' });
    expect(byId(s, 'a')).toMatchObject({ x: 0, y: 3 });
    expect(byId(s, 'b')).toMatchObject({ x: 4, y: 3 });
  });
});

describe('z-order', () => {
  it('forward / backward step the selection, front / back jump past every part', () => {
    let s = createEditorState(sceneOf([tank('a', 0, 0, { z: 3 }), tank('b', 6, 0), tank('c', 12, 0, { z: -2 })]));
    s = run(s, { type: 'select', id: 'b' }, { type: 'z-order', to: 'forward' });
    expect(byId(s, 'b').z).toBe(1);
    s = run(s, { type: 'z-order', to: 'front' });
    expect(byId(s, 'b').z).toBe(4);
    s = run(s, { type: 'z-order', to: 'back' });
    expect(byId(s, 'b').z).toBe(-3);
    s = run(s, { type: 'z-order', to: 'back' });
    expect(s.past).toHaveLength(3);
  });

  it('drops z when it returns to 0 and clamps to the validator limit', () => {
    let s = createEditorState(sceneOf([tank('a', 0, 0, { z: 1 }), tank('b', 6, 0, { z: 1000 })]));
    s = run(s, { type: 'select', id: 'a' }, { type: 'z-order', to: 'backward' });
    expect('z' in byId(s, 'a')).toBe(false);
    s = run(s, { type: 'select', id: 'b' }, { type: 'z-order', to: 'forward' });
    expect(byId(s, 'b').z).toBe(1000);
    expect(s.past).toHaveLength(1);
  });
});

describe('layers', () => {
  it('adds a layer, makes it active and puts new placements on it', () => {
    let s = run(three(), { type: 'add-layer', name: 'Piping' });
    expect(s.scene.layers).toEqual([{ id: 'layer-1', name: 'Piping' }]);
    expect(s.activeLayer).toBe('layer-1');
    s = run(s, { type: 'place-mode', object: 'valve' }, { type: 'floor-click', x: 3, y: -3 });
    expect(byId(s, 'valve-1').layer).toBe('layer-1');
    s = run(s, { type: 'pipe-mode' }, { type: 'floor-click', x: 20, y: 0 }, { type: 'floor-click', x: 24, y: 0 });
    expect(s.scene.objects.filter((o) => o.object === 'pipe').every((o) => o.layer === 'layer-1')).toBe(true);
    s = run(s, { type: 'set-active-layer', id: 'default' }, { type: 'place-mode', object: 'valve' }, { type: 'floor-click', x: 3, y: 8 });
    expect('layer' in byId(s, 'valve-2')).toBe(false);
  });

  it('hiding a layer deselects its parts and makes them unselectable', () => {
    let s = run(three(), { type: 'add-layer', name: 'Hidden' }, { type: 'select-many', ids: ['a', 'b'] }, { type: 'assign-layer', layer: 'layer-1' });
    expect(byId(s, 'a').layer).toBe('layer-1');
    s = run(s, { type: 'update-layer', id: 'layer-1', patch: { hidden: true } });
    expect(s.scene.layers?.[0]).toEqual({ id: 'layer-1', name: 'Hidden', hidden: true });
    expect(s.selectedIds).toEqual([]);
    s = run(s, { type: 'select', id: 'a' }, { type: 'select-all' });
    expect(s.selectedIds).toEqual(['c']);
    s = run(s, { type: 'drag-start', id: 'a', x: 0, y: 0 });
    expect(s.drag).toBeNull();
  });

  it('locking the default layer (declared on demand) blocks edits; unlocking stores no flag', () => {
    let s = run(three(), { type: 'update-layer', id: 'default', patch: { locked: true } });
    expect(s.scene.layers).toEqual([{ id: 'default', name: 'Default', locked: true }]);
    s = run(s, { type: 'select-all' }, { type: 'delete' });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    s = run(s, { type: 'update-layer', id: 'default', patch: { locked: false } });
    expect(s.scene.layers).toEqual([{ id: 'default', name: 'Default' }]);
  });

  it('removing a layer moves its parts to the default layer; the default cannot be removed', () => {
    let s = run(three(), { type: 'add-layer' }, { type: 'select', id: 'c' }, { type: 'assign-layer', layer: 'layer-1' });
    expect(s.scene.layers?.[0]?.name).toBe('Layer 2');
    s = run(s, { type: 'remove-layer', id: 'layer-1' });
    expect(s.scene.layers).toBeUndefined();
    expect('layer' in byId(s, 'c')).toBe(false);
    expect(s.activeLayer).toBe('default');
    const before = s.revision;
    expect(run(s, { type: 'remove-layer', id: 'default' }).revision).toBe(before);
  });

  it('every layer edit is one undo step', () => {
    let s = run(three(), { type: 'add-layer', name: 'L' }, { type: 'update-layer', id: 'layer-1', patch: { name: 'Renamed' } });
    expect(s.past).toHaveLength(2);
    s = run(s, { type: 'undo' });
    expect(s.scene.layers?.[0]?.name).toBe('L');
    s = run(s, { type: 'undo' });
    expect(s.scene.layers).toBeUndefined();
  });

  it('assign-layer ignores unknown layers and parts already there', () => {
    const s = run(three(), { type: 'select', id: 'a' }, { type: 'assign-layer', layer: 'nope' }, { type: 'assign-layer', layer: 'default' });
    expect(s.past).toHaveLength(0);
  });

  it('paste puts the copy on the active layer', () => {
    const s = run(three(), { type: 'add-layer' }, { type: 'select', id: 'a' }, { type: 'copy' }, { type: 'paste' });
    expect(byId(s, 'tank-1').layer).toBe('layer-1');
  });
});

describe('connectors (holodeck#91)', () => {
  const pair = () => createEditorState(sceneOf([tank('a', 0, 0), tank('b', 8, 0)]));

  it('draws a connector from a port to a part centre in two clicks', () => {
    let s = run(pair(), { type: 'connector-mode' });
    expect(s.mode).toBe('draw-connector');
    s = run(s, { type: 'floor-click', x: 1, y: 0 });
    expect(s.linkStart).toEqual({ object: 'a', port: 'east' });
    expect(s.revision).toBe(0);
    s = run(s, { type: 'floor-click', x: 8, y: 0 });
    const c = byId(s, 'connector-1');
    // Clicking the tank centre (8,0) is 1 cell from both ports: port snap picks the first declared (east).
    expect(c.link?.from).toEqual({ object: 'a', port: 'east' });
    expect(c.link?.to && 'object' in c.link.to ? c.link.to.object : null).toBe('b');
    expect(s.linkStart).toBeNull();
    expect(s.selectedIds).toEqual(['connector-1']);
    expect(s.mode).toBe('draw-connector');
    expect(s.past).toHaveLength(1);
  });

  it('free ends become the placement x/y and toX/toY (no link)', () => {
    const s = run(pair(), { type: 'connector-mode' }, { type: 'floor-click', x: 0, y: 6 }, { type: 'floor-click', x: 5, y: 6 });
    const c = byId(s, 'connector-1');
    expect(c).toMatchObject({ x: 0, y: 6, toX: 5, toY: 6 });
    expect(c.link).toBeUndefined();
  });

  it('a second click on the same anchor is ignored; Escape drops the pending start', () => {
    let s = run(pair(), { type: 'connector-mode' }, { type: 'floor-click', x: 0, y: 6 }, { type: 'floor-click', x: 0, y: 6 });
    expect(s.scene.objects).toHaveLength(2);
    expect(s.linkStart).toEqual({ x: 0, y: 6 });
    s = run(s, { type: 'cancel' });
    expect(s.linkStart).toBeNull();
    expect(s.mode).toBe('select');
  });

  it('re-anchors a dragged end onto another part, or frees it on empty floor', () => {
    let s = run(pair(), { type: 'connector-mode' }, { type: 'floor-click', x: 0, y: 6 }, { type: 'floor-click', x: 5, y: 6 });
    s = run(s, { type: 'link-drag-start', id: 'connector-1', end: 'to' });
    expect(s.linkDrag).toEqual({ id: 'connector-1', end: 'to' });
    s = run(s, { type: 'cursor', x: 8, y: 1 }, { type: 'link-drag-end' });
    expect(byId(s, 'connector-1').link?.to).toEqual({ object: 'b' });
    expect(s.past).toHaveLength(2);
    s = run(s, { type: 'link-drag-start', id: 'connector-1', end: 'to' }, { type: 'link-drag-end', x: 3, y: 9 });
    const c = byId(s, 'connector-1');
    expect(c.link).toBeUndefined();
    expect(c).toMatchObject({ toX: 3, toY: 9 });
    s = run(s, { type: 'link-drag-start', id: 'connector-1', end: 'to' }, { type: 'link-drag-end', x: 3, y: 9 });
    expect(s.past).toHaveLength(3);
    expect(s.linkDrag).toBeNull();
  });

  it('link-drag-start ignores parts that are not connectors', () => {
    const s = run(pair(), { type: 'link-drag-start', id: 'a', end: 'from' });
    expect(s.linkDrag).toBeNull();
  });

  it('deleting an anchored part detaches the connector end to where it was', () => {
    let s = createEditorState(sceneOf([
      tank('a', 0, 0),
      tank('b', 8, 0),
      { id: 'c', object: 'connector', x: 1, y: 0, link: { from: { object: 'a', port: 'east' }, to: { object: 'b' } } },
    ]));
    s = run(s, { type: 'select', id: 'b' }, { type: 'delete' });
    expect(byId(s, 'c').link).toEqual({ from: { object: 'a', port: 'east' }, to: { x: 8, y: 0 } });
  });

  it('reports a notice when no connector part is installed', async () => {
    const { createIsoRegistry } = await import('../registry');
    const bare = createIsoRegistry();
    let s = createEditorState(emptyScene('x'), { registry: bare });
    s = run(s, { type: 'connector-mode' }, { type: 'floor-click', x: 0, y: 0 }, { type: 'floor-click', x: 3, y: 0 });
    expect(s.notice).toBe('No connector part installed');
    expect(s.scene.objects).toHaveLength(0);
  });
});

describe('host helpers (holodeck#100)', () => {
  it('stampPlacement matches the palette stamp and allocates the next id', () => {
    const s = run(three(), { type: 'place-mode', object: 'tank' }, { type: 'floor-click', x: 20, y: 0 });
    const fromPalette = byId(s, 'tank-1');
    const fromHost = stampPlacement(registry, 'tank', 20, 0, { objects: three().scene.objects });
    expect(fromHost).toEqual(fromPalette);
    expect(stampPlacement(registry, 'tank', 0, 0, { objects: s.scene.objects }).id).toBe('tank-2');
    expect(stampPlacement(registry, 'pipe', 0, 0, { id: 'mine' })).toMatchObject({ id: 'mine', toX: 2, toY: 0 });
  });

  it('`placed` names the placement stamped by this action only', () => {
    let s = run(three(), { type: 'place-mode', object: 'valve' }, { type: 'floor-click', x: 3, y: -3 });
    expect(s.placed).toBe('valve-1');
    s = run(s, { type: 'cursor', x: 4, y: 4 });
    expect(s.placed).toBeNull();
  });
});
