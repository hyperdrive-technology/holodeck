import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noticeStore } from '../layout/ui-state';
import { activeDocumentStore, shellStore, type ActiveDocument } from './active-document';
import { ExportDialog } from './ExportDialog';

function activeDoc(overrides: Partial<ActiveDocument> = {}): ActiveDocument {
  return {
    id: 'doc-1',
    name: 'Plant',
    placing: null,
    armItem: vi.fn(),
    addItem: vi.fn(),
    startDragItem: vi.fn(),
    dropItem: vi.fn(),
    exportFile: vi.fn(),
    exportComponents: vi.fn(),
    exportImage: vi.fn(async (scale: number) => ({ width: 640 * scale, height: 400 * scale, tiles: 1, blob: new Blob(), name: `plant@${scale}x.png` })),
    save: vi.fn(),
    ...overrides,
  };
}

const setGpu = (on: boolean) => {
  if (on) Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
  else delete (navigator as { gpu?: unknown }).gpu;
};

beforeEach(() => {
  noticeStore.setState(() => []);
  shellStore.setState((s) => ({ ...s, exportOpen: true }));
});

afterEach(() => {
  setGpu(false);
  act(() => activeDocumentStore.setState(() => null));
  shellStore.setState((s) => ({ ...s, exportOpen: false }));
});

function open(doc: ActiveDocument) {
  act(() => activeDocumentStore.setState(() => doc));
  render(<ExportDialog documentName={doc.name} />);
  return screen.getByTestId('export-dialog');
}

describe('ExportDialog', () => {
  it('downloads JSON and CSV through the active document and closes', () => {
    const doc = activeDoc();
    open(doc);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(doc.exportComponents).toHaveBeenCalledTimes(1);
    expect(shellStore.state.exportOpen).toBe(false);
    act(() => shellStore.setState((s) => ({ ...s, exportOpen: true })));
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    expect(doc.exportFile).toHaveBeenCalledTimes(1);
    expect(noticeStore.state.map((n) => n.title)).toEqual(['Exported the components', 'Exported the document']);
  });

  it('reports an export that throws and stays open', () => {
    open(activeDoc({ exportComponents: () => { throw new Error('disk full'); } }));
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(noticeStore.state.at(-1)).toMatchObject({ tone: 'error', title: 'Could not export the components', details: ['disk full'] });
    expect(shellStore.state.exportOpen).toBe(true);
  });

  it('exports a PNG at the chosen scale (default 2x) when WebGPU is there', async () => {
    setGpu(true);
    const doc = activeDoc();
    open(doc);
    const radio = (n: number) => screen.getByRole('radio', { name: `${n}×` });
    expect(radio(2)).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(radio(4));
    expect(radio(4)).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('export-png'));
    await waitFor(() => expect(shellStore.state.exportOpen).toBe(false));
    expect(doc.exportImage).toHaveBeenCalledWith(4, expect.any(AbortSignal));
    expect(noticeStore.state.at(-1)?.title).toBe('Exported plant@4x.png (2560 × 1600 px)');
  });

  it('disables PNG without WebGPU and says why', () => {
    setGpu(false);
    open(activeDoc());
    expect(screen.getByTestId('export-png')).toBeDisabled();
    expect(screen.getByText(/Needs WebGPU/)).toBeInTheDocument();
  });

  it('cancels a running PNG export without an error notice', async () => {
    setGpu(true);
    let seen: AbortSignal | undefined;
    const doc = activeDoc({
      exportImage: (_scale, signal) =>
        new Promise((_, reject) => {
          seen = signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        }),
    });
    open(doc);
    fireEvent.click(screen.getByTestId('export-png'));
    expect(await screen.findByText('Rendering…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByTestId('export-png')).toHaveTextContent('Download PNG'));
    expect(seen?.aborted).toBe(true);
    expect(noticeStore.state.filter((n) => n.tone === 'error')).toEqual([]);
  });

  it('builds the embed URL, adding a valid parent origin', () => {
    open(activeDoc());
    const url = screen.getByTestId('embed-url') as HTMLInputElement;
    expect(url.value).toBe(`${window.location.origin}/embed/doc-1`);
    fireEvent.change(screen.getByLabelText(/Embedding page origin/), { target: { value: 'https://app.example' } });
    expect(url.value).toBe(`${window.location.origin}/embed/doc-1?parentOrigin=https%3A%2F%2Fapp.example`);
    fireEvent.change(screen.getByLabelText(/Embedding page origin/), { target: { value: 'nonsense' } });
    expect(url.value).toBe(`${window.location.origin}/embed/doc-1`);
  });

  it('copies the iframe snippet', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open(activeDoc());
    fireEvent.click(screen.getByRole('button', { name: /Copy iframe snippet/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toMatch(/^<iframe src="http.*\/embed\/doc-1" title="Plant"/);
  });
});
