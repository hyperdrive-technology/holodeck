import { describe, expect, it } from 'vitest';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { createIsoRegistryWithBuiltins, getDefaultIsoRegistry } from '../registry/default';
import { pipeArmsAt } from '../routing/elbows';
import type { Heading } from '../routing/grid';
import { NO_ROUTE_NOTICE, committedScene, createEditorState, editorReducer, emptyScene, nextId, stamp } from './editor-state';

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

describe('auto-routed pipes', () => {
  const withTanks = () =>
    createEditorState(
      {
        ...emptyScene('doc'),
        objects: [
          stamp(registry, 'tank', 0, 0, 'tank-1'),
          stamp(registry, 'tank', 6, 0, 'tank-2'),
          stamp(registry, 'tank', 12, 0, 'tank-3'),
        ],
      },
      { registry },
    );

  const drawPipe = (s: ReturnType<typeof blank>, a: [number, number], b: [number, number]) => {
    s = editorReducer(s, { type: 'pipe-mode' });
    s = editorReducer(s, { type: 'floor-click', x: a[0], y: a[1] });
    return editorReducer(s, { type: 'floor-click', x: b[0], y: b[1] });
  };

  it('commits a routed multi-segment pipe as ONE undo step', () => {
    const before = withTanks();
    // Tank 1 east port to tank 3 west port, with tank 2 in the way.
    const s = drawPipe(before, [1, 0], [11, 0]);
    expect(s.past).toHaveLength(1);
    expect(s.revision).toBe(before.revision + 1);
    const added = s.scene.objects.filter((o) => o.object === 'pipe' || o.object === 'elbow');
    expect(added.filter((o) => o.object === 'elbow').length).toBeGreaterThanOrEqual(2);
    expect(s.notice).toBeNull();
    const undone = editorReducer(s, { type: 'undo' });
    expect(undone.scene.objects.map((o) => o.id)).toEqual(['tank-1', 'tank-2', 'tank-3']);
  });

  it('snaps the first click to a port heading and chains from the end cell', () => {
    let s = editorReducer(withTanks(), { type: 'pipe-mode' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 1 }); // inside tank-1 -> nearest port
    // East and west ports tie; declaration order picks east. It sits in the
    // tank's cut-away window, which is allowed: the pipe is drawn clipped at
    // the wall (routing/vessel-ports.ts clipPipeEnd).
    expect(s.pipeStart).toEqual({ x: 1, y: 0 });
    expect(s.pipeStartHeading).toBe('e');
    s = editorReducer(s, { type: 'floor-click', x: 3, y: 5 });
    expect(s.pipeStart).toEqual({ x: 3, y: 5 });
    expect(s.pipeStartHeading).toBeNull();
  });

  it('falls back to the manhattan L with a notice when walled in, then clears the notice', () => {
    const wall = [-1, 0, 1]
      .flatMap((dx) => [-1, 0, 1].map((dy) => stamp(registry, 'valve', 20 + dx, dy, `v${dx}${dy}`)))
      .filter((o) => !(o.x === 20 && o.y === 0));
    const base = createEditorState({ ...emptyScene('doc'), objects: wall }, { registry });
    const s = drawPipe(base, [20, 0], [24, 3]);
    expect(s.notice).toBe(NO_ROUTE_NOTICE);
    expect(s.scene.objects.filter((o) => o.object === 'pipe')).toHaveLength(2);
    expect(s.scene.objects.find((o) => o.object === 'elbow')).toMatchObject({ x: 24, y: 0 });
    expect(editorReducer(s, { type: 'cursor', x: 1, y: 1 }).notice).toBe(NO_ROUTE_NOTICE);
    expect(editorReducer(s, { type: 'select-mode' }).notice).toBeNull();
  });

  it('a clear route sets no notice', () => {
    expect(drawPipe(blank(), [0, 0], [4, 3]).notice).toBeNull();
  });

  describe('reroute-selected', () => {
    it('replaces the selected run with a route around a new obstacle; undo restores it', () => {
      let s = drawPipe(blank(), [0, 0], [10, 0]);
      expect(s.scene.objects.map((o) => o.object)).toEqual(['pipe']);
      // Drop a tank across the pipe, then reroute.
      s = {
        ...s,
        scene: { ...s.scene, objects: [...s.scene.objects, stamp(registry, 'tank', 5, 0, 'tank-1')] },
        selectedId: 'pipe-1',
      };
      const before = s.scene.objects;
      const r = editorReducer(s, { type: 'reroute-selected' });
      expect(r.past).toHaveLength(s.past.length + 1);
      expect(r.revision).toBe(s.revision + 1);
      expect(r.scene.objects.find((o) => o.id === 'tank-1')).toBeDefined();
      const pipes = r.scene.objects.filter((o) => o.object === 'pipe');
      expect(pipes.length).toBeGreaterThanOrEqual(3);
      expect(r.scene.objects.filter((o) => o.object === 'elbow').length).toBeGreaterThanOrEqual(2);
      expect(r.selectedId).toBe(pipes[0]!.id);
      expect(pipes[0]).toMatchObject({ x: 0, y: 0 });
      expect(pipes[pipes.length - 1]).toMatchObject({ toX: 10, toY: 0 });
      const u = editorReducer(r, { type: 'undo' });
      expect(u.scene.objects).toEqual(before);
    });

    it('reroutes the whole connected run when an elbow is selected', () => {
      let s = drawPipe(blank(), [0, 0], [4, 3]);
      expect(s.scene.objects).toHaveLength(3);
      s = { ...s, scene: { ...s.scene, objects: [...s.scene.objects, stamp(registry, 'tank', 4, 0, 'tank-1')] } };
      s = editorReducer(s, { type: 'select', id: 'elbow-1' });
      const r = editorReducer(s, { type: 'reroute-selected' });
      // Old run gone, endpoints preserved, and nothing routed through the tank.
      expect(r.scene.objects.some((o) => o.id === 'elbow-1' && o.x === 4 && o.y === 0)).toBe(false);
      const pipes = r.scene.objects.filter((o) => o.object === 'pipe');
      expect(pipes[0]).toMatchObject({ x: 0, y: 0 });
      expect(pipes[pipes.length - 1]).toMatchObject({ toX: 4, toY: 3 });
    });

    it('does not block itself: a free run reroutes to an equivalent route', () => {
      let s = drawPipe(blank(), [0, 0], [5, 0]);
      s = editorReducer(s, { type: 'select', id: 'pipe-1' });
      const r = editorReducer(s, { type: 'reroute-selected' });
      expect(r.scene.objects).toHaveLength(1);
      expect(r.scene.objects[0]).toMatchObject({ x: 0, y: 0, toX: 5, toY: 0 });
    });

    it('is a no-op for non-pipe selections, no selection, and run mode', () => {
      const s = editorReducer(withTanks(), { type: 'select', id: 'tank-1' });
      expect(editorReducer(s, { type: 'reroute-selected' })).toBe(s);
      const none = withTanks();
      expect(editorReducer(none, { type: 'reroute-selected' })).toBe(none);
      let p = drawPipe(blank(), [0, 0], [5, 0]);
      p = editorReducer(editorReducer(p, { type: 'select', id: 'pipe-1' }), { type: 'set-read-only', readOnly: true });
      expect(editorReducer(p, { type: 'reroute-selected' })).toBe(p);
    });

    // holodeck#10: rerouting one side of an inline valve must not detach it.
    it.each([
      ['valve', 'pipe-a'], ['valve', 'pipe-b'], ['end-cap', 'pipe-a'], ['end-cap', 'pipe-b'],
    ])('keeps an inline %s connected when %s is rerouted around an obstacle', (part, id) => {
      const objects = [
        { id: 'pipe-a', object: 'pipe', x: 0, y: 0, toX: 6, toY: 0 },
        stamp(registry, part, 6, 0, 'inline-1'),
        { id: 'pipe-b', object: 'pipe', x: 6, y: 0, toX: 12, toY: 0 },
        // Leave room beside the flange for an axial approach around the tank.
        stamp(registry, 'tank', id === 'pipe-a' ? 3 : 9, 0, 'tank-1'),
      ];
      let s = createEditorState({ ...emptyScene('doc'), objects }, { registry });
      s = editorReducer(s, { type: 'select', id });
      const r = editorReducer(s, { type: 'reroute-selected' });
      expect(r.revision).toBe(s.revision + 1);
      expect(r.notice).toBeNull();
      const other = id === 'pipe-a' ? 'pipe-b' : 'pipe-a';
      // The untouched side and the inline part are exactly as before.
      expect(r.scene.objects.find((o) => o.id === other)).toEqual(objects.find((o) => o.id === other));
      expect(r.scene.objects.find((o) => o.id === 'inline-1')).toEqual(objects[1]);
      // Preserve the connected flange side as well as the two endpoint nodes.
      const pipes = r.scene.objects.filter((o) => o.object === 'pipe' && o.id !== other);
      expect(pipes.some((p) => p.id === id)).toBe(false);
      const ends = pipes.flatMap((p) => [`${p.x},${p.y}`, `${p.toX},${p.toY}`]);
      expect(ends).toContain('6,0');
      expect(ends).toContain(id === 'pipe-a' ? '0,0' : '12,0');
      expect(pipeArmsAt(pipes, { x: 6, y: 0 }).map((arm) => arm.heading)).toEqual([id === 'pipe-a' ? 'w' : 'e']);
      // Nothing was routed through the inline node except that one joint.
      expect(ends.filter((e) => e === '6,0')).toHaveLength(1);
    });

    // PR #21 review repro, plus its opposite side, rotated axis and reversed
    // pipe storage direction. Check the flange side, not merely the end node.
    describe.each([false, true])('inline headings (north-south: %s)', (vertical) => {
      it.each([
        ['pipe-a', false], ['pipe-b', false], ['pipe-a', true], ['pipe-b', true],
      ] as const)('preserves the flange heading rerouting %s (reversed: %s)', (id, reversed) => {
        const point = (distance: number) => vertical ? { x: 0, y: distance } : { x: distance, y: 0 };
        const makePipe = (pipeId: string, a: number, b: number) => {
          const from = point(reversed ? b : a);
          const to = point(reversed ? a : b);
          return { id: pipeId, object: 'pipe', ...from, toX: to.x, toY: to.y };
        };
        const joint = point(6);
        // Give the right-hand repro the same six-cell detour space as the
        // left. A tank at 8 would block the only eastward step off the valve.
        const far = id === 'pipe-a' ? 9 : 12;
        const obstacle = point(id === 'pipe-a' ? 3 : 9);
        const valve = { ...stamp(registry, 'valve', joint.x, joint.y, 'valve-1'), rotation: vertical ? Math.PI / 2 : 0 };
        const objects = [
          makePipe('pipe-a', 0, 6), valve, makePipe('pipe-b', 6, far),
          stamp(registry, 'tank', obstacle.x, obstacle.y, 'tank-1'),
        ];
        const s = { ...createEditorState({ ...emptyScene('doc'), objects }, { registry }), selectedId: id };
        const r = editorReducer(s, { type: 'reroute-selected' });
        expect(r.notice).toBeNull(); // A* found a route; no straight-line fallback.
        expect(r.revision).toBe(s.revision + 1);
        expect(r.scene.objects.find((o) => o.id === valve.id)).toEqual(valve);
        const other = id === 'pipe-a' ? 'pipe-b' : 'pipe-a';
        expect(r.scene.objects.find((o) => o.id === other)).toEqual(objects.find((o) => o.id === other));
        const rerouted = r.scene.objects.filter((o) => o.object === 'pipe' && o.id !== other);
        expect(rerouted.length).toBeGreaterThan(1);
        const expected: Heading = vertical ? (id === 'pipe-a' ? 'n' : 's') : (id === 'pipe-a' ? 'w' : 'e');
        expect(pipeArmsAt(rerouted, joint).map((arm) => arm.heading)).toEqual([expected]);
        expect(pipeArmsAt(r.scene.objects, joint).map((arm) => arm.heading).sort()).toEqual(vertical ? ['n', 's'] : ['e', 'w']);
        expect(pipeArmsAt(rerouted, point(id === 'pipe-a' ? 0 : far))).toHaveLength(1);
      });
    });

    it('flags the fallback when no route exists', () => {
      const wall = [-1, 0, 1]
        .flatMap((dx) => [-1, 0, 1].map((dy) => stamp(registry, 'valve', 20 + dx, dy, `v${dx}${dy}`)))
        .filter((o) => !(o.x === 20 && o.y === 0));
      let s = createEditorState({ ...emptyScene('doc'), objects: wall }, { registry });
      s = { ...s, scene: { ...s.scene, objects: [...wall, { id: 'pipe-1', object: 'pipe', x: 20, y: 0, toX: 24, toY: 3 }] } };
      s = editorReducer(s, { type: 'select', id: 'pipe-1' });
      const r = editorReducer(s, { type: 'reroute-selected' });
      expect(r.notice).toBe(NO_ROUTE_NOTICE);
    });
  });
});

describe('resize handles (radius / height params)', () => {
  const sized = {
    id: 'test:vessel',
    label: 'Vessel',
    footprint: { w: 2, h: 2 },
    params: {
      radius: { type: 'number', label: 'Radius', default: 1, min: 0.3, max: 3, step: 0.05 },
      height: { type: 'number', label: 'Height', default: 2, min: 0.5, max: 6, step: 0.1 },
      level: { type: 'number', label: 'Level', default: 0 },
    },
    resize: { radius: 'radius', height: 'height' },
    component: () => null,
  } as const;
  const withVessel = () => {
    const reg = createIsoRegistryWithBuiltins();
    reg.install({ id: 'test.vessel', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [sized] } });
    let s = createEditorState(emptyScene('doc'), { registry: reg });
    s = editorReducer(s, { type: 'place-mode', object: 'test:vessel' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    return s;
  };

  it('drags the radius: live updates snap to the step, one undo step on release', () => {
    let s = withVessel();
    const rev = s.revision;
    s = editorReducer(s, { type: 'resize-start', id: 'test:vessel-1', handle: 'radius' });
    expect(s.resize).toEqual({ id: 'test:vessel-1', handle: 'radius', param: 'radius', origin: 1 });
    expect(s.selectedId).toBe('test:vessel-1');
    s = editorReducer(s, { type: 'resize-move', value: 1.4321 });
    expect(s.scene.objects[0]?.params?.radius).toBe(1.45);
    expect(s.revision).toBe(rev); // not committed yet
    s = editorReducer(s, { type: 'resize-move', value: 99 });
    expect(s.scene.objects[0]?.params?.radius).toBe(3); // clamped to max
    s = editorReducer(s, { type: 'resize-end' });
    expect(s.resize).toBeNull();
    expect(s.revision).toBe(rev + 1);
    s = editorReducer(s, { type: 'undo' });
    expect(s.scene.objects[0]?.params?.radius).toBe(1);
    s = editorReducer(s, { type: 'redo' });
    expect(s.scene.objects[0]?.params?.radius).toBe(3);
  });

  it('drags the height from the placement value and reports the committed scene', () => {
    let s = withVessel();
    s = editorReducer(s, { type: 'set-param', param: 'height', value: 2.5 });
    const before = s;
    s = editorReducer(s, { type: 'resize-start', id: 'test:vessel-1', handle: 'height' });
    expect(s.resize?.origin).toBe(2.5);
    s = editorReducer(s, { type: 'resize-move', value: 3.04 });
    expect(s.scene.objects[0]?.params?.height).toBe(3);
    expect(committedScene(before, s)).toBeNull();
    const end = editorReducer(s, { type: 'resize-end' });
    expect(committedScene(s, end)?.objects[0]?.params).toEqual({ height: 3 });
  });

  it('a release without movement commits nothing', () => {
    let s = withVessel();
    const rev = s.revision;
    s = editorReducer(s, { type: 'resize-start', id: 'test:vessel-1', handle: 'height' });
    s = editorReducer(s, { type: 'resize-move', value: 2.01 }); // snaps back to 2.0
    s = editorReducer(s, { type: 'resize-end' });
    expect(s.revision).toBe(rev);
    expect(s.past).toHaveLength(1); // only the stamp
  });

  it('ignores handles on parts without `resize`, unknown ids, NaN values and run mode', () => {
    let s = editorReducer(blank(), { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 });
    expect(editorReducer(s, { type: 'resize-start', id: 'tank-1', handle: 'radius' }).resize).toBeNull();
    let v = withVessel();
    expect(editorReducer(v, { type: 'resize-start', id: 'nope', handle: 'radius' }).resize).toBeNull();
    v = editorReducer(v, { type: 'resize-start', id: 'test:vessel-1', handle: 'radius' });
    expect(editorReducer(v, { type: 'resize-move', value: Number.NaN })).toBe(v);
    v = editorReducer(v, { type: 'set-read-only', readOnly: true });
    expect(v.resize).toBeNull();
    expect(editorReducer(v, { type: 'resize-start', id: 'test:vessel-1', handle: 'radius' }).resize).toBeNull();
  });

  it('cancel / select-mode / load drop an in-flight resize', () => {
    let s = withVessel();
    s = editorReducer(s, { type: 'resize-start', id: 'test:vessel-1', handle: 'radius' });
    expect(editorReducer(s, { type: 'cancel' }).resize).toBeNull();
    expect(editorReducer(s, { type: 'select-mode' }).resize).toBeNull();
    expect(editorReducer(s, { type: 'load', scene: s.scene }).resize).toBeNull();
  });
});

/** holodeck#9: undo/redo must never cross a document switch. */
describe('load: switching documents', () => {
  const docA = () => {
    let s = createEditorState(emptyScene('A'));
    s = editorReducer(s, { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 0, y: 0 }); // tank-1
    s = editorReducer(s, { type: 'floor-click', x: 4, y: 0 }); // tank-2
    s = editorReducer(s, { type: 'undo' }); // A: past 1, future 1
    return s;
  };
  const docB = () => ({ ...emptyScene('B'), objects: [stamp(registry, 'valve', 2, 2, 'v-1')] });

  it('the repro: edit A, load B, undo does not restore A (and emits nothing)', () => {
    const a = docA();
    expect(a.past).toHaveLength(1);
    expect(a.future).toHaveLength(1);
    const b = docB();
    const loaded = editorReducer(a, { type: 'load', scene: b });
    expect(loaded.past).toEqual([]);
    expect(loaded.future).toEqual([]);
    expect(committedScene(a, loaded)).toBeNull();

    const undone = editorReducer(loaded, { type: 'undo' });
    expect(undone).toBe(loaded);
    expect(committedScene(loaded, undone)).toBeNull();
    const redone = editorReducer(loaded, { type: 'redo' });
    expect(redone).toBe(loaded);
    expect(redone.scene.id).toBe('B');
  });

  it('resets every transient editing field but keeps registry, read-only and a monotonic revision', () => {
    let a = docA();
    a = editorReducer(a, { type: 'select', id: 'tank-1' });
    a = editorReducer(a, { type: 'drag-start', id: 'tank-1', x: 0, y: 0 });
    a = editorReducer(a, { type: 'cursor', x: 3, y: 3 });
    a = { ...a, notice: 'something', mode: 'draw-pipe', pipeStart: { x: 1, y: 1 }, pipeStartHeading: 'e', placing: 'tank' };
    const b = docB();
    const loaded = editorReducer(a, { type: 'load', scene: b });
    expect(loaded).toMatchObject({
      mode: 'select',
      placing: null,
      selectedId: null,
      pipeStart: null,
      pipeStartHeading: null,
      notice: null,
      cursor: null,
      drag: null,
      resize: null,
      readOnly: a.readOnly,
      revision: a.revision,
    });
    expect(loaded.registry).toBe(a.registry);
    // The caller's object, so ProcessEditor's echo check (`scene !== sceneRef`) holds.
    expect(loaded.scene).toBe(b);
  });

  it('keeps read-only across a switch', () => {
    const ro = editorReducer(docA(), { type: 'set-read-only', readOnly: true });
    expect(editorReducer(ro, { type: 'load', scene: docB() }).readOnly).toBe(true);
  });

  it('edits in B after the switch undo back to B, never to A', () => {
    let s = editorReducer(docA(), { type: 'load', scene: docB() });
    s = editorReducer(s, { type: 'place-mode', object: 'tank' });
    s = editorReducer(s, { type: 'floor-click', x: 8, y: 8 });
    s = editorReducer(s, { type: 'undo' });
    expect(s.scene.id).toBe('B');
    expect(s.scene.objects.map((o) => o.id)).toEqual(['v-1']);
    expect(editorReducer(s, { type: 'undo' })).toBe(s);
  });

  it('switching back to A starts A with empty history too', () => {
    const a = docA();
    const back = editorReducer(editorReducer(a, { type: 'load', scene: docB() }), { type: 'load', scene: a.scene });
    expect(back.scene.id).toBe('A');
    expect(back.past).toEqual([]);
    expect(back.future).toEqual([]);
  });

  it('same id (external update of the open document) keeps history and a still-present selection', () => {
    let a = docA();
    a = editorReducer(a, { type: 'select', id: 'tank-1' });
    const external = { ...a.scene, objects: [...a.scene.objects, stamp(registry, 'valve', 9, 9, 'v-9')] };
    const loaded = editorReducer(a, { type: 'load', scene: external });
    expect(loaded.past).toBe(a.past);
    expect(loaded.future).toBe(a.future);
    expect(loaded.selectedId).toBe('tank-1');
    const gone = editorReducer(a, { type: 'load', scene: { ...a.scene, objects: [] } });
    expect(gone.selectedId).toBeNull();
  });

  it('emits nothing for the switch in an action stream, then one emit per commit in B', () => {
    const emitted: { id: string }[] = [];
    let s = docA();
    for (const action of [
      { type: 'load', scene: docB() },
      { type: 'undo' },
      { type: 'redo' },
      { type: 'place-mode', object: 'valve' },
      { type: 'floor-click', x: 5, y: 5 },
    ] as Parameters<typeof editorReducer>[1][]) {
      const next = editorReducer(s, action);
      const scene = committedScene(s, next);
      if (scene) emitted.push(scene);
      s = next;
    }
    expect(emitted.map((e) => e.id)).toEqual(['B']);
  });
});
