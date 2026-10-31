import type { HolodeckHost } from '@holodeck/sdk';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openStudioDb } from '../documents/db';
import { DocumentStore } from '../documents/store';
import { createStudioHost } from '../host/studio-host';
import { SessionSecretStore } from '../connections/secrets';
import { StudioProvider } from '../studio-context';
import { NO_CHANNEL } from '../test-support';
import { activeDocumentStore, type ActiveDocument } from './active-document';
import { LibraryPanel } from './LibraryPanel';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});
afterEach(() => activeDocumentStore.setState(() => null));

function renderPanel() {
  const store = new DocumentStore(openStudioDb('library-panel-test'));
  return render(
    <StudioProvider services={{ host, store, channel: NO_CHANNEL, secrets: new SessionSecretStore(null) }}>
      <LibraryPanel />
    </StudioProvider>,
  );
}

function activeDoc(): ActiveDocument {
  return {
    id: 'd',
    name: 'Doc',
    placing: null,
    armItem: vi.fn(),
    addItem: vi.fn(),
    startDragItem: vi.fn(),
    dropItem: vi.fn(),
    exportFile: vi.fn(),
    exportComponents: vi.fn(),
    exportImage: vi.fn(),
    save: vi.fn(),
  };
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
    act(() => activeDocumentStore.setState(() => ({ ...activeDoc(), armItem, addItem })));
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

  it('drags an item: arms it past the threshold, drops it with the element under the pointer, and swallows the trailing click', () => {
    renderPanel();
    const startDragItem = vi.fn();
    const dropItem = vi.fn();
    const armItem = vi.fn();
    act(() => activeDocumentStore.setState(() => ({ ...activeDoc(), armItem, startDragItem, dropItem })));
    const tank = screen.getByRole('button', { name: /^Tank/ });
    const target = document.createElement('canvas');
    document.body.append(target);
    const elementFromPoint = vi.fn(() => target);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });
    try {
      fireEvent.pointerDown(tank, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      // Under the threshold: still a click.
      fireEvent.pointerMove(window, { clientX: 12, clientY: 11 });
      expect(startDragItem).not.toHaveBeenCalled();
      fireEvent.pointerMove(window, { clientX: 40, clientY: 30 });
      expect(startDragItem).toHaveBeenCalledWith('holodeck.iso.part', 'tank');
      fireEvent.pointerMove(window, { clientX: 80, clientY: 60 });
      expect(startDragItem).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(window, { clientX: 300, clientY: 200 });
      expect(elementFromPoint).toHaveBeenCalledWith(300, 200);
      expect(dropItem).toHaveBeenCalledWith('holodeck.iso.part', 'tank', target);
      // A click right after the drag (released over the item itself) does not arm it again.
      fireEvent.click(tank);
      expect(armItem).not.toHaveBeenCalled();
      // A plain press + release without moving stays a click.
      fireEvent.pointerDown(tank, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });
      fireEvent.click(tank);
      expect(armItem).toHaveBeenCalledWith('holodeck.iso.part', 'tank');
      expect(dropItem).toHaveBeenCalledTimes(1);
    } finally {
      target.remove();
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('a cancelled drag (pointercancel) drops with no target', () => {
    renderPanel();
    const dropItem = vi.fn();
    act(() => activeDocumentStore.setState(() => ({ ...activeDoc(), dropItem })));
    const tank = screen.getByRole('button', { name: /^Tank/ });
    fireEvent.pointerDown(tank, { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    fireEvent.pointerCancel(window);
    expect(dropItem).toHaveBeenCalledWith('holodeck.iso.part', 'tank', null);
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
