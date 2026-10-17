import type { HolodeckHost } from '@holodeck/sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openStudioDb } from '../documents/db';
import { DocumentStore } from '../documents/store';
import { createStudioHost } from '../host/studio-host';
import { StudioProvider } from '../studio-context';
import { NO_CHANNEL } from '../test-support';
import { activeDocumentStore } from './active-document';
import { LibraryPanel } from './LibraryPanel';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});
afterEach(() => activeDocumentStore.setState(() => null));

function renderPanel() {
  const store = new DocumentStore(openStudioDb('library-panel-test'));
  return render(
    <StudioProvider services={{ host, store, channel: NO_CHANNEL }}>
      <LibraryPanel />
    </StudioProvider>,
  );
}

describe('<LibraryPanel />', () => {
  it('lists installed parts grouped by package and category', () => {
    renderPanel();
    const pkg = screen.getByRole('region', { name: 'Holodeck 2.5D engine' });
    expect(within(pkg).getByRole('group', { name: 'Vessels' })).toBeInTheDocument();
    expect(within(pkg).getByRole('button', { name: /^Tank/ })).toBeInTheDocument();
  });

  it('disables items until a document is open, then places through the active document', () => {
    renderPanel();
    const tank = screen.getByRole('button', { name: /^Tank/ });
    expect(tank).toBeDisabled();
    expect(screen.getByText('Open a document to place components.')).toBeInTheDocument();
    const armItem = vi.fn();
    const addItem = vi.fn();
    act(() => activeDocumentStore.setState(() => ({ id: 'd', placing: null, armItem, addItem, name: 'Doc', exportFile: vi.fn(), exportComponents: vi.fn(), exportImage: vi.fn(), save: vi.fn() })));
    expect(tank).toBeEnabled();
    expect(tank).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(tank);
    expect(armItem).toHaveBeenCalledWith('holodeck.iso.part', 'tank');
    fireEvent.click(screen.getByRole('button', { name: 'Add Tank to the document' }));
    expect(addItem).toHaveBeenCalledWith('holodeck.iso.part', 'tank');
    // The armed item shows as pressed.
    act(() => activeDocumentStore.setState((s) => (s ? { ...s, placing: 'tank' } : s)));
    expect(tank).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters by search and clears on Escape', () => {
    renderPanel();
    const search = screen.getByRole('searchbox', { name: 'Search the library' });
    fireEvent.change(search, { target: { value: 'valve' } });
    expect(screen.queryByRole('button', { name: /^Tank/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Valve/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: /^Tank/ })).toBeInTheDocument();
  });
});
