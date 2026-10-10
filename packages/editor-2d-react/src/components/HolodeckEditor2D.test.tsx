import type { SceneFile, ScenePaletteItem } from '@holodeck/sdk';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFlowRegistry } from '../registry/flowKinds';
import { createSceneNodeFromPaletteItem, resolvePaletteDrop } from '../utils';
import { HolodeckEditor2D } from './HolodeckEditor2D';

const scene: SceneFile = {
  version: '1.0.0',
  metadata: { name: 't' } as any,
  scene: { nodes: [], edges: [] },
};
const item: ScenePaletteItem = {
  id: 'blk',
  nodeType: 'fbd:block',
  label: 'Block',
  category: 'Logic',
  defaults: { metadata: { fbName: 'AND' } },
};
const Comp = () => null;

describe('palette drop', () => {
  it('createSceneNodeFromPaletteItem applies type, name, defaults and position', () => {
    const n = createSceneNodeFromPaletteItem(item, { x: 10, y: 20 }, 'n1');
    expect(n).toMatchObject({ id: 'n1', type: 'fbd:block', name: 'Block', metadata: { fbName: 'AND' } });
    expect(n.transform.position).toEqual({ x: 10, y: 20, z: 0 });
    expect(n.metadata).not.toBe(item.defaults!.metadata); // cloned, not shared
  });
  it('resolvePaletteDrop converts screen to flow coords; ignores foreign/unknown drags', () => {
    const s2f = (p: { x: number; y: number }) => ({ x: p.x - 100, y: p.y - 50 });
    const dt = (v: string) => ({ getData: () => v });
    expect(resolvePaletteDrop({ dataTransfer: dt('blk'), clientX: 150, clientY: 80 }, [item], s2f)).toEqual({
      item,
      position: { x: 50, y: 30 },
    });
    expect(resolvePaletteDrop({ dataTransfer: dt(''), clientX: 0, clientY: 0 }, [item], s2f)).toBeUndefined();
    expect(resolvePaletteDrop({ dataTransfer: dt('nope'), clientX: 0, clientY: 0 }, [item], s2f)).toBeUndefined();
    expect(resolvePaletteDrop({ dataTransfer: null, clientX: 0, clientY: 0 }, [item], s2f)).toBeUndefined();
  });
  it('editor handles a drop onto the canvas', () => {
    const onDrop = vi.fn();
    const { container } = render(
      <HolodeckEditor2D scene={scene} paletteItems={[item]} showPalette onDropPaletteItem={onDrop} />,
    );
    expect(screen.getByTestId('palette-item-blk')).toBeInTheDocument();
    const flow = container.querySelector('.react-flow') as HTMLElement;
    fireEvent.drop(flow, { dataTransfer: { getData: () => 'blk', types: ['application/holodeck-palette-item'] }, clientX: 5, clientY: 5 });
    expect(onDrop).toHaveBeenCalledTimes(1);
    const [gotItem, pos, node] = onDrop.mock.calls[0]!;
    expect(gotItem).toBe(item);
    expect(pos).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    expect(node).toMatchObject({ type: 'fbd:block', metadata: { fbName: 'AND' } });
  });
});

describe('registry integration', () => {
  it('shows registry palette items', () => {
    const r = createFlowRegistry();
    r.install({ id: 'x', version: '1', contributions: { 'holodeck.flow.palette': [item as any] } });
    render(<HolodeckEditor2D scene={scene} registry={r} showPalette />);
    expect(screen.getByTestId('palette-item-blk')).toBeInTheDocument();
  });
  it('throws a clear error when props and registry define the same node type', () => {
    const r = createFlowRegistry();
    r.install({ id: 'x', version: '1', contributions: { 'holodeck.flow.nodeType': [{ id: 'fbd:block', component: Comp }] } });
    const spy = console.error; console.error = () => {};
    expect(() => render(<HolodeckEditor2D scene={scene} registry={r} nodeTypes={{ 'fbd:block': Comp }} />)).toThrow(
      /nodeTypes key\(s\) "fbd:block".*both via props and the registry/,
    );
    console.error = spy;
  });
  it('registry node types are used when present, no conflict otherwise', () => {
    const r = createFlowRegistry();
    r.install({ id: 'x', version: '1', contributions: { 'holodeck.flow.nodeType': [{ id: 'a', component: Comp }] } });
    expect(() => render(<HolodeckEditor2D scene={scene} registry={r} nodeTypes={{ b: Comp }} />)).not.toThrow();
  });
});
