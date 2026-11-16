/**
 * Render tests for node moves: `onNodesMoved` (drag, multi-select drag, arrow-key
 * nudge), controlled write-back without snap-back, no refit after a move, and
 * `snapGrid`.
 *
 * jsdom notes (why the stubs below exist):
 * - d3-drag reads `event.view`, and jsdom's MouseEvent constructor rejects the
 *   test `window` as `view`, so events are built by hand and `view` defined on them.
 * - Every element measures 0x0 in jsdom; React Flow then sees the pointer at the
 *   container edge and auto-pans on every frame, moving nodes after the drag.
 *   A fixed 1000x800 bounding rect keeps the pointer in the middle.
 * - The setup file's ResizeObserver never fires, so nodes are never "measured"
 *   and `fitView` has nothing to fit. Tests that check refits install one that
 *   reports every observed element once, with offsetWidth/Height stubbed.
 */
import type { SceneFile, SceneNode } from '@holodeck/sdk';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HolodeckNodeMove } from '../types';
import { HolodeckEditor2D } from './HolodeckEditor2D';

function sceneNode(id: string, x: number, y: number): SceneNode {
  return {
    id,
    type: 'block',
    name: id,
    transform: {
      position: { x, y, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  } as SceneNode;
}

function makeScene(nodes: SceneNode[], liveValue?: string): SceneFile {
  return {
    version: '1.0.0',
    metadata: { name: 't' } as SceneFile['metadata'],
    scene: {
      nodes: liveValue ? nodes.map((n) => ({ ...n, metadata: { ...n.metadata, liveValue } })) : nodes,
      edges: [],
    },
  };
}

function withPositions(scene: SceneFile, moves: HolodeckNodeMove[]): SceneFile {
  const byId = new Map(moves.map((m) => [m.nodeId, m.position]));
  return {
    ...scene,
    scene: {
      ...scene.scene,
      nodes: scene.scene.nodes.map((n) => {
        const p = byId.get(n.id);
        return p ? { ...n, transform: { ...n.transform, position: { ...n.transform.position, ...p } } } : n;
      }),
    },
  };
}

function mouse(target: EventTarget, type: string, x: number, y: number, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init });
  Object.defineProperty(event, 'view', { value: window });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** Press at (400,400), cross the drag threshold, then move by (dx, dy) and release. */
function drag(el: Element, dx: number, dy: number) {
  mouse(el, 'mousedown', 400, 400);
  mouse(window, 'mousemove', 410, 410); // starts the drag (threshold)
  mouse(window, 'mousemove', 410 + dx, 410 + dy);
  mouse(window, 'mouseup', 410 + dx, 410 + dy);
}

function nodeEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!el) throw new Error(`node ${id} not rendered`);
  return el as HTMLElement;
}

function translateOf(el: HTMLElement): { x: number; y: number } {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform);
  if (!m) throw new Error(`no translate in "${el.style.transform}"`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

async function flushFrames() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON() {},
  } as DOMRect);
});
afterEach(async () => {
  vi.restoreAllMocks();
  // d3-drag swallows the first `click` on window for one macrotask after a
  // drag ends; let that expire so the next test's clicks select nodes.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const base = makeScene([sceneNode('a', 0, 0), sceneNode('b', 200, 0), sceneNode('c', 400, 0)]);

describe('onNodesMoved: drag', () => {
  it('reports one completed single-node drag, once, with old and new position', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />);
    drag(nodeEl(container, 'a'), 30, 50);

    expect(onNodesMoved).toHaveBeenCalledTimes(1);
    const [moves, source] = onNodesMoved.mock.calls[0]!;
    expect(source).toBe('drag');
    expect(moves).toEqual([
      { nodeId: 'a', position: { x: 30, y: 50 }, previousPosition: { x: 0, y: 0 }, sceneNode: base.scene.nodes[0] },
    ]);
    // The node is where it was reported, not snapped back to the scene position.
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 30, y: 50 });
  });

  it('does not report per frame while dragging', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />);
    const el = nodeEl(container, 'a');
    mouse(el, 'mousedown', 400, 400);
    mouse(window, 'mousemove', 410, 410);
    for (let i = 1; i <= 5; i++) mouse(window, 'mousemove', 410 + i * 10, 410);
    expect(onNodesMoved).not.toHaveBeenCalled();
    mouse(window, 'mouseup', 460, 410);
    expect(onNodesMoved).toHaveBeenCalledTimes(1);
    expect(onNodesMoved.mock.calls[0]![0][0].position).toEqual({ x: 50, y: 0 });
  });

  it('a click without movement reports nothing', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />);
    const el = nodeEl(container, 'a');
    mouse(el, 'mousedown', 400, 400);
    mouse(window, 'mouseup', 400, 400);
    expect(onNodesMoved).not.toHaveBeenCalled();
  });

  it('a multi-selection drag reports every moved node in one call', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />);
    // React Flow's multi-selection key is Meta on macOS and Control elsewhere
    // (it checks navigator.platform, which is '' in jsdom). Holding both would
    // not match: the pressed-key set must equal the key combination.
    const multiKey = /Mac/.test(navigator.platform) ? 'Meta' : 'Control';
    fireEvent.click(nodeEl(container, 'a'));
    fireEvent.keyDown(document, { key: multiKey });
    fireEvent.click(nodeEl(container, 'b'));
    fireEvent.keyUp(document, { key: multiKey });
    expect(nodeEl(container, 'a').classList.contains('selected')).toBe(true);
    expect(nodeEl(container, 'b').classList.contains('selected')).toBe(true);

    drag(nodeEl(container, 'b'), 20, 10);

    expect(onNodesMoved).toHaveBeenCalledTimes(1);
    const [moves, source] = onNodesMoved.mock.calls[0]! as [HolodeckNodeMove[], string];
    expect(source).toBe('drag');
    const byId = Object.fromEntries(moves.map((m) => [m.nodeId, m]));
    expect(Object.keys(byId).sort()).toEqual(['a', 'b']);
    expect(byId.a!.position).toEqual({ x: 20, y: 10 });
    expect(byId.b!.position).toEqual({ x: 220, y: 10 });
    expect(byId.b!.previousPosition).toEqual({ x: 200, y: 0 });
    expect(translateOf(nodeEl(container, 'c'))).toEqual({ x: 400, y: 0 });
  });

  it('interactive={false}: nodes do not move and nothing is reported', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(
      <HolodeckEditor2D scene={base} layout="manual" interactive={false} onNodesMoved={onNodesMoved} />,
    );
    drag(nodeEl(container, 'a'), 30, 50);
    expect(onNodesMoved).not.toHaveBeenCalled();
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 0, y: 0 });
  });

  it('without onNodesMoved a drag still moves the node (backward compatible)', () => {
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" />);
    drag(nodeEl(container, 'a'), 30, 50);
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 30, y: 50 });
  });
});

describe('onNodesMoved: positions after the move', () => {
  it('controlled: host writes the position back; no snap-back, no further report', () => {
    const onNodesMoved = vi.fn();
    const { container, rerender } = render(
      <HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />,
    );
    drag(nodeEl(container, 'a'), 30, 50);
    const persisted = withPositions(base, onNodesMoved.mock.calls[0]![0]);
    rerender(<HolodeckEditor2D scene={persisted} layout="manual" onNodesMoved={onNodesMoved} />);
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 30, y: 50 });
    expect(onNodesMoved).toHaveBeenCalledTimes(1);

    // A second drag starts from the persisted position.
    drag(nodeEl(container, 'a'), 10, 0);
    expect(onNodesMoved.mock.calls[1]![0][0]).toMatchObject({
      position: { x: 40, y: 50 },
      previousPosition: { x: 30, y: 50 },
    });
  });

  it('uncontrolled: an unrelated scene update (live values) keeps the dragged position', () => {
    const { container, rerender } = render(<HolodeckEditor2D scene={base} layout="manual" />);
    drag(nodeEl(container, 'a'), 30, 50);
    rerender(<HolodeckEditor2D scene={makeScene(base.scene.nodes, ' [+]')} layout="manual" />);
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 30, y: 50 });
  });

  it('host sets a different position (undo/reset): the host wins', () => {
    const onNodesMoved = vi.fn();
    const { container, rerender } = render(
      <HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />,
    );
    drag(nodeEl(container, 'a'), 30, 50);
    const reset = withPositions(base, [{ ...onNodesMoved.mock.calls[0]![0][0], position: { x: -5, y: -5 } }]);
    rerender(<HolodeckEditor2D scene={reset} layout="manual" onNodesMoved={onNodesMoved} />);
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: -5, y: -5 });
  });

  it('a scene update keeps the current selection', () => {
    const { container, rerender } = render(<HolodeckEditor2D scene={base} layout="manual" />);
    fireEvent.click(nodeEl(container, 'b'));
    expect(nodeEl(container, 'b').classList.contains('selected')).toBe(true);
    rerender(<HolodeckEditor2D scene={makeScene(base.scene.nodes, ' [ ]')} layout="manual" />);
    expect(nodeEl(container, 'b').classList.contains('selected')).toBe(true);
  });
});

describe('review fixes (holodeck#327)', () => {
  it.each([
    ['Backspace', true],
    ['Delete', true],
    ['Backspace', false],
    ['Delete', false],
  ])('%s on a selected node does not delete it (interactive=%s)', async (key, interactive) => {
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" interactive={interactive} />);
    fireEvent.click(nodeEl(container, 'a'));
    fireEvent.keyDown(document, { key, code: key });
    fireEvent.keyUp(document, { key, code: key });
    fireEvent.keyDown(nodeEl(container, 'a'), { key, code: key });
    // React Flow deletes after an async onBeforeDelete; let it settle.
    await flushFrames();
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(3);
    expect(nodeEl(container, 'a')).toBeInTheDocument();
  });

  it('a scene update mid-drag keeps the node under the pointer and the drop is still reported', () => {
    const onNodesMoved = vi.fn();
    const { container, rerender } = render(
      <HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />,
    );
    mouse(nodeEl(container, 'a'), 'mousedown', 400, 400);
    mouse(window, 'mousemove', 410, 410);
    mouse(window, 'mousemove', 440, 460);
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 30, y: 50 });

    rerender(<HolodeckEditor2D scene={makeScene(base.scene.nodes, ' [+]')} layout="manual" onNodesMoved={onNodesMoved} />);
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 30, y: 50 });

    mouse(window, 'mousemove', 450, 470);
    mouse(window, 'mouseup', 450, 470);
    expect(onNodesMoved).toHaveBeenCalledTimes(1);
    expect(onNodesMoved.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ nodeId: 'a', position: { x: 40, y: 60 }, previousPosition: { x: 0, y: 0 } }),
    ]);
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 40, y: 60 });
  });

  it('host removes the dragged node mid-drag: later keyboard nudges are still reported', async () => {
    const onNodesMoved = vi.fn();
    const { container, rerender } = render(
      <HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />,
    );
    mouse(nodeEl(container, 'a'), 'mousedown', 400, 400);
    mouse(window, 'mousemove', 410, 410);
    mouse(window, 'mousemove', 440, 460);
    const withoutA = makeScene(base.scene.nodes.filter((n) => n.id !== 'a'));
    rerender(<HolodeckEditor2D scene={withoutA} layout="manual" onNodesMoved={onNodesMoved} />);
    // The next pointer move makes React Flow abort the drag (its node is gone),
    // and an aborted drag ends without onNodeDragStop.
    mouse(window, 'mousemove', 450, 470);
    mouse(window, 'mouseup', 450, 470);
    expect(container.querySelector('.react-flow__node[data-id="a"]')).toBeNull();
    // d3-drag swallows the next click for one macrotask after a moved gesture.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    onNodesMoved.mockClear();

    fireEvent.click(nodeEl(container, 'b'));
    fireEvent.keyDown(nodeEl(container, 'b'), { key: 'ArrowRight' });
    expect(onNodesMoved).toHaveBeenCalledTimes(1);
    expect(onNodesMoved.mock.calls[0]![1]).toBe('keyboard');
    expect(onNodesMoved.mock.calls[0]![0][0]).toMatchObject({ nodeId: 'b', position: { x: 205, y: 0 } });
  });
});

describe('onNodesMoved: keyboard', () => {
  it('an arrow-key nudge of the selected node reports source "keyboard"', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />);
    fireEvent.click(nodeEl(container, 'a'));
    fireEvent.keyDown(nodeEl(container, 'a'), { key: 'ArrowRight' });
    expect(onNodesMoved).toHaveBeenCalledTimes(1);
    expect(onNodesMoved.mock.calls[0]![1]).toBe('keyboard');
    expect(onNodesMoved.mock.calls[0]![0]).toEqual([
      { nodeId: 'a', position: { x: 5, y: 0 }, previousPosition: { x: 0, y: 0 }, sceneNode: base.scene.nodes[0] },
    ]);
    fireEvent.keyDown(nodeEl(container, 'a'), { key: 'ArrowDown' });
    expect(onNodesMoved.mock.calls[1]![0][0]).toMatchObject({ position: { x: 5, y: 5 }, previousPosition: { x: 5, y: 0 } });
    expect(translateOf(nodeEl(container, 'a'))).toEqual({ x: 5, y: 5 });
  });
});

describe('snapGrid', () => {
  it('snaps drags to the grid; nudges move one cell', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(
      <HolodeckEditor2D scene={base} layout="manual" snapGrid={20} onNodesMoved={onNodesMoved} />,
    );
    drag(nodeEl(container, 'a'), 27, 52);
    expect(onNodesMoved.mock.calls[0]![0][0].position).toEqual({ x: 20, y: 60 });
    fireEvent.keyDown(nodeEl(container, 'a'), { key: 'ArrowRight' });
    expect(onNodesMoved.mock.calls[1]![0][0].position).toEqual({ x: 40, y: 60 });
  });

  it('off by default: positions are not snapped', () => {
    const onNodesMoved = vi.fn();
    const { container } = render(<HolodeckEditor2D scene={base} layout="manual" onNodesMoved={onNodesMoved} />);
    drag(nodeEl(container, 'a'), 27, 52);
    expect(onNodesMoved.mock.calls[0]![0][0].position).toEqual({ x: 27, y: 52 });
  });
});

describe('fit view', () => {
  // A ResizeObserver that reports each observed element once, so React Flow
  // measures the pane and the nodes and `fitView` actually changes the viewport.
  beforeEach(() => {
    class MeasuringResizeObserver {
      constructor(private readonly cb: ResizeObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() => this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver));
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MeasuringResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('react-flow__node') ? 120 : 1000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('react-flow__node') ? 40 : 800;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function viewportTransform(container: HTMLElement): string {
    return (container.querySelector('.react-flow__viewport') as HTMLElement).style.transform;
  }

  it('a drag and the controlled write-back do not refit; a structural change does', async () => {
    const onNodesMoved = vi.fn();
    const two = makeScene([sceneNode('a', 0, 0), sceneNode('b', 200, 0)]);
    const { container, rerender } = render(
      <HolodeckEditor2D scene={two} layout="manual" onNodesMoved={onNodesMoved} />,
    );
    await flushFrames();
    const fitted = viewportTransform(container);
    expect(fitted).not.toBe('');

    drag(nodeEl(container, 'a'), 300, 300);
    await flushFrames();
    expect(viewportTransform(container)).toBe(fitted);

    rerender(
      <HolodeckEditor2D scene={withPositions(two, onNodesMoved.mock.calls[0]![0])} layout="manual" onNodesMoved={onNodesMoved} />,
    );
    await flushFrames();
    expect(viewportTransform(container)).toBe(fitted);

    // Sanity check that the test can see a refit: adding a far-away node refits.
    rerender(
      <HolodeckEditor2D
        scene={makeScene([...two.scene.nodes, sceneNode('far', 5000, 3000)])}
        layout="manual"
        onNodesMoved={onNodesMoved}
      />,
    );
    await flushFrames();
    expect(viewportTransform(container)).not.toBe(fitted);
  });
});
