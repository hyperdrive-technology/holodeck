import type { ScenePaletteItem } from '@holodeck/sdk';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HolodeckPalette, groupPaletteItems } from './HolodeckPalette';

const items: ScenePaletteItem[] = [
  { id: 'and', nodeType: 'b', label: 'AND', category: 'Logic' },
  { id: 'ton', nodeType: 'b', label: 'TON', defaults: { metadata: { category: 'Timers' } } },
  { id: 'or', nodeType: 'b', label: 'OR', description: 'boolean or', category: 'Logic' },
  { id: 'misc', nodeType: 'b', label: 'Misc' },
];

describe('HolodeckPalette', () => {
  it('groups by category (field, metadata, fallback last)', () => {
    expect(groupPaletteItems(items).map(([c, g]) => [c, g.map((i) => i.id)])).toEqual([
      ['Logic', ['and', 'or']],
      ['Timers', ['ton']],
      ['Other', ['misc']],
    ]);
    render(<HolodeckPalette items={items} />);
    expect(screen.getByRole('region', { name: 'Logic' })).toBeInTheDocument();
  });
  it('filters by label, description and category; shows empty state', () => {
    render(<HolodeckPalette items={items} />);
    const box = screen.getByLabelText('Search palette');
    fireEvent.change(box, { target: { value: 'boolean' } });
    expect(screen.queryByTestId('palette-item-and')).toBeNull();
    expect(screen.getByTestId('palette-item-or')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'timers' } });
    expect(screen.getByTestId('palette-item-ton')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(screen.getByText('No matching items')).toBeInTheDocument();
  });
  it('sets the drag payload to the item id', () => {
    render(<HolodeckPalette items={items} />);
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId('palette-item-and'), { dataTransfer: { setData, effectAllowed: '' } });
    expect(setData).toHaveBeenCalledWith('application/holodeck-palette-item', 'and');
  });
});
