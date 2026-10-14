import { describe, expect, it, vi } from 'vitest';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { parseSceneFile, type IsoPlacement } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { MAX_GRID_COORD } from '../routing/grid';
import {
  committedScene, createEditorState, editorReducer, emptyScene, REROUTE_FAILED_NOTICE,
  ROUTE_FAILED_NOTICE, type EditorAction, type EditorState,
} from './editor-state';

const registry = createIsoRegistryWithBuiltins();
const sized: IsoPartDefinition = {
  id: 'sized', label: 'Sized', footprint: { w: 2, h: 2 }, component: () => null,
  params: {
    w: { type: 'number', label: 'Width', default: 2, min: 0, max: 65536, step: 1 },
    h: { type: 'number', label: 'Height', default: 2, min: 0, max: 65536, step: 1 },
  },
  resize: { radius: 'w', height: 'h' },
  footprintOf: (p) => ({ w: Number(p.params?.w ?? 2), h: Number(p.params?.h ?? 2) }),
};
registry.install({ id: 'geometry-tests', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [sized] } });

const boundaries = [
  { name: '+x', x: MAX_GRID_COORD, y: 0, dx: 0.5, dy: 0, axis: 'w', handle: 'radius' },
  { name: '-x', x: -MAX_GRID_COORD, y: 0, dx: -0.5, dy: 0, axis: 'w', handle: 'radius' },
  { name: '+y', x: 0, y: MAX_GRID_COORD, dx: 0, dy: 0.5, axis: 'h', handle: 'height' },
  { name: '-y', x: 0, y: -MAX_GRID_COORD, dx: 0, dy: -0.5, axis: 'h', handle: 'height' },
] as const;

function selected(object: IsoPlacement): EditorState {
  const state = createEditorState(parseSceneFile({ ...emptyScene('doc'), objects: [object] }, registry), { registry });
  return editorReducer(state, { type: 'select', id: object.id });
}

function reopen(state: EditorState) {
  const parsed = parseSceneFile(JSON.parse(JSON.stringify(state.scene)), state.registry);
  expect(parsed).toEqual(state.scene);
}

function committed(before: EditorState, after: EditorState) {
  expect(committedScene(before, after)).toBe(after.scene);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.past).toHaveLength(before.past.length + 1);
  reopen(after);
}

function rejected(before: EditorState, after: EditorState) {
  expect(after.scene).toBe(before.scene);
  expect(after.past).toBe(before.past);
  expect(after.future).toBe(before.future);
  expect(after.selectedId).toBe(before.selectedId);
  expect(after.revision).toBe(before.revision);
  expect(committedScene(before, after)).toBeNull();
  expect(after.notice).toMatch(/^Edit rejected:/);
  reopen(after);
}

for (const b of boundaries) {
  describe(`persisted edits at ${b.name} boundary`, () => {
    const tank = () => selected({ id: 't', object: 'tank', x: b.x, y: b.y });

    it('places at the boundary and rejects a half-cell beyond it', () => {
      const placing = editorReducer(createEditorState(emptyScene('doc'), { registry }), { type: 'place-mode', object: 'tank' });
      const at = editorReducer(placing, { type: 'floor-click', x: b.x, y: b.y });
      committed(placing, at);
      rejected(at, editorReducer(at, { type: 'floor-click', x: b.x + b.dx, y: b.y + b.dy }));
    });

    it('drags half a cell to the boundary; rejects an outward half-cell preview and commits only the valid move', () => {
      let state = selected({ id: 't', object: 'tank', x: b.x - b.dx, y: b.y - b.dy });
      state = editorReducer(state, { type: 'drag-start', id: 't', x: 0, y: 0 });
      const start = state;
      state = editorReducer(state, { type: 'drag-move', x: b.dx, y: b.dy });
      reopen(state);
      const invalid = editorReducer(state, { type: 'drag-move', x: 2 * b.dx, y: 2 * b.dy });
      rejected(state, invalid);
      state = editorReducer(invalid, { type: 'drag-end' });
      committed(start, state);
      expect(state.scene.objects[0]).toMatchObject({ x: b.x, y: b.y });
      reopen(editorReducer(state, { type: 'undo' }));
      reopen(editorReducer(editorReducer(state, { type: 'undo' }), { type: 'redo' }));
    });

    it('an outward drag from the boundary has no commit/history and retains its rejection notice on release', () => {
      const start = editorReducer(tank(), { type: 'drag-start', id: 't', x: 0, y: 0 });
      const invalid = editorReducer(start, { type: 'drag-move', x: b.dx, y: b.dy });
      rejected(start, invalid);
      const end = editorReducer(invalid, { type: 'drag-end' });
      rejected(start, end);
      expect(end.drag).toBeNull();
    });

    it('checks a dragged pipe endpoint even while its origin is inside the limit', () => {
      let state = selected({ id: 'p', object: 'pipe', x: b.x - 8 * b.dx, y: b.y - 8 * b.dy, toX: b.x, toY: b.y });
      state = editorReducer(state, { type: 'drag-start', id: 'p', x: 0, y: 0 });
      rejected(state, editorReducer(state, { type: 'drag-move', x: b.dx, y: b.dy }));
      const moved = editorReducer(state, { type: 'drag-move', x: -b.dx, y: -b.dy });
      committed(state, editorReducer(moved, { type: 'drag-end' }));
    });

    it('resizes at the boundary and rejects a footprint crossing the safe cell-key range', () => {
      let state = selected({ id: 's', object: 'sized', x: b.x, y: b.y, params: { w: 0, h: 0 } });
      state = editorReducer(state, { type: 'resize-start', id: 's', handle: b.handle });
      const start = state;
      state = editorReducer(state, { type: 'resize-move', value: 32766 });
      reopen(state);
      const invalid = editorReducer(state, { type: 'resize-move', value: 32768 });
      rejected(state, invalid);
      committed(start, editorReducer(invalid, { type: 'resize-end' }));
    });

    it('rotates a normal tank but rejects a rotated footprint outside the safe cell-key range', () => {
      const state = tank();
      committed(state, editorReducer(state, { type: 'rotate-selected', direction: 1 }));
      // The long dimension starts parallel to the scene boundary. Rotating it
      // across that boundary puts its outer node at +/-32768, beyond cellKey.
      const skinny = selected({ id: 's', object: 'sized', x: b.x, y: b.y, params: b.axis === 'w' ? { w: 0, h: 32768 } : { w: 32768, h: 0 } });
      for (const direction of [1, -1] as const) {
        rejected(skinny, editorReducer(skinny, { type: 'rotate-selected', direction }));
      }
    });

    it('patches to the boundary and rejects out-of-range origins, endpoints and dimensions', () => {
      const state = selected({ id: 't', object: 'tank', x: 0, y: 0 });
      const at = editorReducer(state, { type: 'patch-selected', patch: { x: b.x, y: b.y } });
      committed(state, at);
      const field = b.axis === 'w' ? 'x' : 'y';
      const endpoint = b.axis === 'w' ? 'toX' : 'toY';
      const outside = b[field] + (b.axis === 'w' ? b.dx : b.dy);
      for (const patch of [{ [field]: outside }, { [endpoint]: outside }, { width: outside }, { height: outside }, { size: outside }]) {
        rejected(at, editorReducer(at, { type: 'patch-selected', patch }));
      }
    });

    it('validates set-param effective footprints as well as resize handles', () => {
      const state = selected({ id: 's', object: 'sized', x: b.x, y: b.y, params: { w: 0, h: 0 } });
      const at = editorReducer(state, { type: 'set-param', param: b.axis, value: 32766 });
      committed(state, at);
      rejected(at, editorReducer(at, { type: 'set-param', param: b.axis, value: 32768 }));
    });

    it('draws a boundary pipe and rejects an empty route beyond the boundary', () => {
      let state = editorReducer(createEditorState(emptyScene('doc'), { registry }), { type: 'pipe-mode' });
      state = editorReducer(state, { type: 'floor-click', x: b.x - 8 * b.dx, y: b.y - 8 * b.dy });
      const start = state;
      state = editorReducer(state, { type: 'floor-click', x: b.x, y: b.y });
      committed(start, state);
      const failure = editorReducer(state, { type: 'floor-click', x: b.x + b.dx, y: b.y + b.dy });
      expect(failure.scene).toBe(state.scene);
      expect(failure.past).toBe(state.past);
      expect(failure.revision).toBe(state.revision);
      expect(failure.pipeStart).toEqual(state.pipeStart);
      expect(failure.notice).toBe(ROUTE_FAILED_NOTICE);
      reopen(failure);
    });
  });
}

describe('mutation audit', () => {
  it.each([NaN, Infinity, -Infinity])('rejects non-finite resize value %s with a notice', (value) => {
    const state = editorReducer(selected({ id: 's', object: 'sized', x: 0, y: 0 }), { type: 'resize-start', id: 's', handle: 'radius' });
    const invalid = editorReducer(state, { type: 'resize-move', value });
    rejected(state, invalid);
    rejected(state, editorReducer(invalid, { type: 'resize-end' }));
  });

  it.each(['x', 'y', 'toX', 'toY', 'width', 'height', 'size', 'rotation', 'nudgeX', 'nudgeY', 'screenX', 'screenY'] as const)('rejects non-finite %s through host patches', (field) => {
    const state = selected({ id: 't', object: 'tank', x: 0, y: 0 });
    for (const value of [NaN, Infinity, -Infinity]) {
      rejected(state, editorReducer(state, { type: 'patch-selected', patch: { [field]: value } }));
    }
  });

  it.each([Infinity, NaN, -1, 256])('rejects effective footprint param %s from both param and patch actions', (value) => {
    const state = selected({ id: 's', object: 'sized', x: 0, y: 0 });
    rejected(state, editorReducer(state, { type: 'set-param', param: 'w', value: value === 256 ? 65536 : value }));
    rejected(state, editorReducer(state, { type: 'patch-selected', patch: { params: { w: value, h: value } } }));
  });

  it('rejects over-budget resize previews; release adds no history', () => {
    const state = editorReducer(selected({ id: 's', object: 'sized', x: 0, y: 0, params: { w: 256, h: 0 } }), { type: 'resize-start', id: 's', handle: 'height' });
    const invalid = editorReducer(state, { type: 'resize-move', value: 256 });
    rejected(state, invalid);
    rejected(state, editorReducer(invalid, { type: 'resize-end' }));
  });

  it('rejects invalid palette defaults and unknown parts', () => {
    const reg = createIsoRegistryWithBuiltins();
    const badDefault: IsoPartDefinition = { ...sized, defaults: { params: { w: 256, h: 256 } } };
    reg.install({ id: 'bad-default', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [badDefault] } });
    for (const object of ['sized', 'missing']) {
      const state = editorReducer(createEditorState(emptyScene('doc'), { registry: reg }), { type: 'place-mode', object });
      rejected(state, editorReducer(state, { type: 'floor-click', x: 0, y: 0 }));
    }
  });

  it.each(['undo', 'redo', 'load'] as const)('rejects invalid geometry from %s without changing history', (type) => {
    const good = selected({ id: 's', object: 'sized', x: 0, y: 0 });
    const bad = { ...good.scene, objects: [{ ...good.scene.objects[0]!, params: { w: 256, h: 256 } }] };
    const state = { ...good, past: [bad], future: [bad] };
    const action: EditorAction = type === 'load' ? { type, scene: bad } : { type };
    rejected(state, editorReducer(state, action));
  });

  it('rejects an unknown patched part or malformed param bag', () => {
    const state = selected({ id: 't', object: 'tank', x: 0, y: 0 });
    for (const patch of [{ object: 'missing' }, { params: [] }]) {
      rejected(state, editorReducer(state, { type: 'patch-selected', patch: patch as Partial<IsoPlacement> }));
    }
  });

  it('keeps the boundary tank run when its resolved port is outside the scene limits', () => {
    const state = editorReducer(createEditorState(parseSceneFile({
      ...emptyScene('doc'), objects: [
        { id: 'tank', object: 'tank', x: 16384, y: 0 },
        { id: 'pipe', object: 'pipe', x: 16380, y: 0, toX: 16384, toY: 0 },
      ],
    }, registry), { registry }), { type: 'select', id: 'pipe' });
    const next = editorReducer(state, { type: 'reroute-selected' });
    expect(next.scene).toBe(state.scene);
    expect(next.past).toBe(state.past);
    expect(next.future).toBe(state.future);
    expect(next.revision).toBe(state.revision);
    expect(next.selectedId).toBe('pipe');
    expect(committedScene(state, next)).toBeNull();
    expect(next.notice).toBe(REROUTE_FAILED_NOTICE);
    reopen(next);
  });

  it('keeps a run when distinct ends resolve to the same port (empty replacement)', () => {
    const state = editorReducer(createEditorState(parseSceneFile({
      ...emptyScene('doc'), objects: [
        { id: 'tank', object: 'tank', x: 0, y: 0 },
        { id: 'pipe', object: 'pipe', x: 0.5, y: 0, toX: 1, toY: 0 },
      ],
    }, registry), { registry }), { type: 'select', id: 'pipe' });
    const next = editorReducer(state, { type: 'reroute-selected' });
    expect(next.scene).toBe(state.scene);
    expect(next.past).toBe(state.past);
    expect(next.revision).toBe(state.revision);
    expect(next.notice).toBe(REROUTE_FAILED_NOTICE);
    reopen(next);
  });
});


describe('editing after a part pack is uninstalled', () => {
  function uninstalledScene() {
    const reg = createIsoRegistryWithBuiltins();
    reg.install({ id: 'removable', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [sized] } });
    const state = createEditorState(parseSceneFile({
      ...emptyScene('doc'), objects: [
        { id: 'missing-a', object: 'sized', x: 0, y: 0 },
        { id: 'missing-b', object: 'sized', x: 4, y: 0 },
        { id: 'installed', object: 'tank', x: 8, y: 0 },
      ],
    }, reg), { registry: reg });
    reg.uninstall('removable');
    return state;
  }

  it.each(['missing-a', 'missing-b'])('can select and delete %s while another missing placement remains', (id) => {
    const state = editorReducer(uninstalledScene(), { type: 'select', id });
    expect(state.selectedId).toBe(id);
    const next = editorReducer(state, { type: 'delete' });
    expect(next.scene.objects.map((o) => o.id)).toEqual(id === 'missing-a' ? ['missing-b', 'installed'] : ['missing-a', 'installed']);
    expect(next.revision).toBe(state.revision + 1);
    expect(next.notice).toBeNull();
    const restored = editorReducer(next, { type: 'undo' });
    expect(restored.scene).toEqual(state.scene);
    expect(restored.notice).toBeNull();
    expect(editorReducer(restored, { type: 'redo' }).scene).toEqual(next.scene);
  });

  it('can edit an installed part while both missing placements remain', () => {
    const state = editorReducer(uninstalledScene(), { type: 'select', id: 'installed' });
    const next = editorReducer(state, { type: 'set-param', param: 'level', value: 0.5 });
    expect(next.scene.objects[2]?.params).toEqual({ level: 0.5 });
    expect(next.scene.objects.slice(0, 2)).toEqual(state.scene.objects.slice(0, 2));
    expect(next.revision).toBe(state.revision + 1);
    expect(next.notice).toBeNull();
  });

  it('can move a missing placement within bounds and rejects unsafe previews and patches', () => {
    const start = editorReducer(uninstalledScene(), { type: 'drag-start', id: 'missing-a', x: 0, y: 0 });
    const moved = editorReducer(start, { type: 'drag-move', x: MAX_GRID_COORD, y: 0 });
    expect(moved.scene.objects[0]?.x).toBe(MAX_GRID_COORD);
    expect(moved.notice).toBeNull();
    const invalid = editorReducer(moved, { type: 'drag-move', x: MAX_GRID_COORD + 0.5, y: 0 });
    expect(invalid.scene).toBe(moved.scene);
    expect(invalid.notice).toMatch(/Edit rejected:.*finite number within/);
    const end = editorReducer(moved, { type: 'drag-end' });
    expect(end.revision).toBe(start.revision + 1);
    expect(end.notice).toBeNull();
    for (const patch of [{ x: Infinity }, { width: MAX_GRID_COORD + 1 }]) {
      const bad = editorReducer(end, { type: 'patch-selected', patch });
      expect(bad.scene).toBe(end.scene);
      expect(bad.revision).toBe(end.revision);
      expect(bad.notice).toMatch(/^Edit rejected:/);
    }
  });

  it('rejects stamping another missing part, replacing a part type, and loading a new unknown placement', () => {
    const state = uninstalledScene();
    const placing = editorReducer(state, { type: 'place-mode', object: 'sized' });
    const stamped = editorReducer(placing, { type: 'floor-click', x: 12, y: 0 });
    expect(stamped.scene).toBe(placing.scene);
    expect(stamped.revision).toBe(placing.revision);
    expect(stamped.notice).toMatch(/unknown library object/);
    const selected = editorReducer(state, { type: 'select', id: 'installed' });
    const patched = editorReducer(selected, { type: 'patch-selected', patch: { object: 'sized' } });
    expect(patched.scene).toBe(selected.scene);
    expect(patched.notice).toMatch(/unknown library object/);
    const loaded = editorReducer(state, { type: 'load', scene: {
      ...state.scene, objects: [...state.scene.objects, { id: 'new', object: 'sized', x: 12, y: 0 }],
    } });
    expect(loaded.scene).toBe(state.scene);
    expect(loaded.notice).toMatch(/unknown library object/);
    // A controlled host echo may still contain the existing missing parts.
    const echo = editorReducer(state, { type: 'load', scene: structuredClone(state.scene) });
    expect(echo.scene).toEqual(state.scene);
    expect(echo.notice).toBeNull();
    expect(() => parseSceneFile(state.scene, state.registry)).toThrow(/unknown library object/);
  });
});

describe('pointer preview validation cost', () => {
  it.each(['drag', 'resize'] as const)('%s validates only the changed footprint, then all footprints on commit', (kind) => {
    const reg = createIsoRegistryWithBuiltins();
    const footprintOf = vi.fn(sized.footprintOf!);
    const part: IsoPartDefinition = { ...sized, footprintOf };
    reg.install({ id: 'preview', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [part] } });
    const state = createEditorState(parseSceneFile({
      ...emptyScene('doc'), objects: Array.from({ length: 100 }, (_, i) => ({ id: `p-${i}`, object: 'sized', x: i, y: 0 })),
    }, reg), { registry: reg });
    const start = editorReducer(state, kind === 'drag'
      ? { type: 'drag-start', id: 'p-50', x: 0, y: 0 }
      : { type: 'resize-start', id: 'p-50', handle: 'radius' });
    footprintOf.mockClear();
    const preview = editorReducer(start, kind === 'drag'
      ? { type: 'drag-move', x: 1, y: 0 }
      : { type: 'resize-move', value: 3 });
    expect(preview.notice).toBeNull();
    expect(footprintOf).toHaveBeenCalledTimes(1);
    expect(footprintOf.mock.calls[0]?.[0].id).toBe('p-50');
    footprintOf.mockClear();
    const end = editorReducer(preview, { type: kind === 'drag' ? 'drag-end' : 'resize-end' });
    expect(end.revision).toBe(start.revision + 1);
    expect(footprintOf).toHaveBeenCalledTimes(100);
  });
});
