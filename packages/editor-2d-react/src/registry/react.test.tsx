import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFlowRegistry } from './flowKinds';
import { FlowRegistryProvider, useFlowContributions, useFlowRegistry } from './react';

function List() {
  const items = useFlowContributions('holodeck.flow.palette');
  return <div data-testid="n">{items.map((i) => i.id).join(',')}</div>;
}

describe('react bindings', () => {
  it('re-renders on install / uninstall', () => {
    const r = createFlowRegistry();
    render(<FlowRegistryProvider registry={r}><List /></FlowRegistryProvider>);
    expect(screen.getByTestId('n').textContent).toBe('');
    act(() => {
      r.install({ id: 'e', version: '1', contributions: { 'holodeck.flow.palette': [{ id: 'p1', nodeType: 't', label: 'P' } as any] } });
    });
    expect(screen.getByTestId('n').textContent).toBe('p1');
    act(() => r.uninstall('e'));
    expect(screen.getByTestId('n').textContent).toBe('');
  });
  it('useFlowRegistry throws without provider', () => {
    const Bad = () => { useFlowRegistry(); return null; };
    const spy = console.error; console.error = () => {};
    expect(() => render(<Bad />)).toThrow(/FlowRegistryProvider/);
    console.error = spy;
  });
});
