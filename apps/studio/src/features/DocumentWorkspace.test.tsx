/**
 * Wiring between the studio workspace and the engine's ProcessEditor
 * (holodeck#100 / #111 / #118 / #124). ProcessEditor is replaced by a stub
 * that records its props and exposes a fake `editorRef` handle, so these
 * tests check what the studio asks the editor to do; the editor's own
 * behaviour (undo, removeObjects) is covered by its package and by the e2e.
 */
import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import type { EditorAction, IsoSceneFile, ProcessEditorProps } from '@holodeck/editor-2.5d-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { useImperativeHandle } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentChange } from '../documents/store';
import { openStudioDb } from '../documents/db';
import { createIsoDocument } from '../documents/new-document';
import { DocumentStore } from '../documents/store';
import { createStudioHost, hostDocumentProblems } from '../host/studio-host';
import { createStudioRouter } from '../router';
import { documentKeys } from '../documents/queries';
import { StudioProvider } from '../studio-context';
import { withPart } from '../test-support';
import { activeDocumentStore } from './active-document';

const editor = vi.hoisted(() => ({
  mounts: 0,
  props: null as ProcessEditorProps | null,
  actions: [] as EditorAction[],
  selectedId: null as string | null,
  /** What the stub's `getCamera` returns (the live view, ahead of the debounced onCameraChange). */
  liveCamera: { zoom: 1, target: [0, 0, 0] } as { zoom: number; target: [number, number, number] },
  /** Options of every `exportImage` call on the stub handle. */
  exportCalls: [] as unknown[],
}));

vi.mock('@holodeck/editor-2.5d-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@holodeck/editor-2.5d-react')>();
  const { useEffect } = await import('react');
  function StubEditor(props: ProcessEditorProps) {
    editor.props = props;
    useEffect(() => {
      editor.mounts += 1;
    }, []);
    useImperativeHandle(props.editorRef, () => ({
      dispatch: (action: EditorAction) => {
        editor.actions.push(action);
        if (action.type === 'select') editor.selectedId = action.id;
      },
      getState: () => ({ selectedId: editor.selectedId, selectedIds: editor.selectedId ? [editor.selectedId] : [] }) as never,
      getCamera: () => editor.liveCamera,
      exportImage: async (options?: unknown) => {
        editor.exportCalls.push(options);
        return { width: 20, height: 10, tiles: 1, blob: new Blob(['png'], { type: 'image/png' }) };
      },
    }));
    return <div data-testid="process-editor" data-object-count={props.scene.objects.length} />;
  }
  return { ...actual, ProcessEditor: StubEditor };
});

let host: HolodeckHost;
let store: DocumentStore;
let listeners: Array<(c: DocumentChange) => void>;
const channel = {
  post: () => undefined,
  subscribe: (l: (c: DocumentChange) => void) => {
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  },
};

beforeAll(async () => {
  host = await createStudioHost();
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store = new DocumentStore(openStudioDb('workspace-test'), { validate: (doc) => hostDocumentProblems(host, doc) });
  listeners = [];
  Object.assign(editor, { mounts: 0, props: null, actions: [], selectedId: null, liveCamera: { zoom: 1, target: [0, 0, 0] }, exportCalls: [] });
});

async function openWorkspace(doc: HolodeckDocument) {
  const router = createStudioRouter(createMemoryHistory({ initialEntries: [`/d/${doc.id}`] }));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  render(
    <StudioProvider services={{ host, store, channel }}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StudioProvider>,
  );
  await screen.findByTestId('process-editor');
  return { router };
}

function tankDoc() {
  const doc = createIsoDocument('Plant', 'p');
  doc.body = withPart(doc.body, host.registry, 'tank').scene;
  return doc;
}

describe('DocumentWorkspace <-> ProcessEditor', () => {
  it('hides the engine chrome and opens on the stored camera (holodeck#100)', async () => {
    await store.create(tankDoc());
    await store.saveCamera('p', { zoom: 33, target: [1, 0, 2], yaw: 0.5, topDown: false });
    await openWorkspace(tankDoc());
    expect(editor.props?.chrome).toBe('canvas');
    expect(editor.props?.camera).toEqual({ zoom: 33, target: [1, 0, 2], yaw: 0.5, topDown: false });
  });

  it('persists camera changes per document', async () => {
    await store.create(tankDoc());
    await openWorkspace(tankDoc());
    expect(editor.props?.camera).toBeUndefined();
    act(() => editor.props?.onCameraChange?.({ zoom: 50, target: [3, 0, -1], yaw: 1 }));
    await waitFor(async () => expect(await store.getCamera('p')).toEqual({ zoom: 50, target: [3, 0, -1], yaw: 1 }));
  });

  it('library "+" adds through the editor place tool, one undoable step (holodeck#111)', async () => {
    await store.create(createIsoDocument('Empty', 'p'));
    await openWorkspace(createIsoDocument('Empty', 'p'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Valve to the document' }));
    expect(editor.actions).toEqual([
      { type: 'place-mode', object: 'valve' },
      { type: 'floor-click', x: 0, y: 0 },
      { type: 'select-mode' },
    ]);
  });

  it('library click arms the place tool (controlled `placing`); clicking again disarms', async () => {
    await store.create(createIsoDocument('Empty', 'p'));
    await openWorkspace(createIsoDocument('Empty', 'p'));
    const tank = screen.getByRole('button', { name: /^Tank/ });
    fireEvent.click(tank);
    expect(editor.props?.placing).toBe('tank');
    expect(tank).toHaveAttribute('aria-pressed', 'true');
    // The editor reports the tool changing (e.g. Escape on the canvas).
    act(() => editor.props?.onPlacingChange?.(null));
    expect(tank).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(tank);
    expect(editor.actions).toEqual([]);
    fireEvent.click(tank);
    expect(editor.props?.placing).toBeNull();
    // Disarming also tells the editor directly (holodeck#133).
    expect(editor.actions).toEqual([{ type: 'select-mode' }]);
  });

  // holodeck#133: Pipe is a run part; arming it enters draw-pipe, whose editor
  // state keeps `placing: null`, so `placing` returning to null alone was no
  // change to the editor and later canvas clicks still drew pipes.
  it('clicking an armed Pipe again leaves the pipe tool explicitly (holodeck#133)', async () => {
    await store.create(createIsoDocument('Empty', 'p'));
    await openWorkspace(createIsoDocument('Empty', 'p'));
    const pipe = screen.getByRole('button', { name: /^Pipe/ });
    fireEvent.click(pipe);
    expect(editor.props?.placing).toBe('pipe');
    fireEvent.click(pipe);
    expect(editor.props?.placing).toBeNull();
    expect(pipe).toHaveAttribute('aria-pressed', 'false');
    expect(editor.actions).toEqual([{ type: 'select-mode' }]);
  });

  it('inspector edits and delete run as editor actions on the selected object (holodeck#111, #124)', async () => {
    await store.create(tankDoc());
    await openWorkspace(tankDoc());
    act(() => editor.props?.onSelect?.('tank-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate right' }));
    const x = screen.getByLabelText('X');
    fireEvent.change(x, { target: { value: '4' } });
    fireEvent.blur(x);
    fireEvent.click(screen.getByRole('button', { name: /Delete object/ }));
    expect(editor.actions).toEqual([
      { type: 'select', id: 'tank-1' },
      { type: 'rotate-selected', direction: 1 },
      { type: 'patch-selected', patch: { x: 4 } },
      { type: 'delete' },
    ]);
  });

  it('adopting another tab’s save remounts the editor (fresh undo history) but keeps camera and selection (holodeck#118)', async () => {
    const created = await store.create(tankDoc());
    await openWorkspace(tankDoc());
    act(() => editor.props?.onSelect?.('tank-1'));
    act(() => editor.props?.onCameraChange?.({ zoom: 61, target: [2, 0, 2] }));
    // A pan after that, still inside the editor's debounce: only getCamera() knows it (#130).
    editor.liveCamera = { zoom: 64, target: [5, 0, 5] };
    const mountsBefore = editor.mounts;

    // "Another tab" saves; the channel tells this one.
    const other = withPart(created.document.body as IsoSceneFile, host.registry, 'valve', 9, 9).scene;
    const saved = await store.save({ ...created.document, body: other }, created.revision);
    act(() => listeners.forEach((l) => l({ type: 'saved', id: 'p', revision: saved.revision })));

    await waitFor(() => expect(editor.props?.scene.objects).toHaveLength(2));
    expect(editor.mounts).toBe(mountsBefore + 1);
    expect(editor.props?.camera).toEqual({ zoom: 64, target: [5, 0, 5] });
    expect(editor.props?.selectedId).toBe('tank-1');
  });

  // Review of holodeck#128: the document read finishing before the camera read
  // mounted the editor without a camera, and the stored one was then ignored.
  it('opens on the stored camera even when the camera read finishes last', async () => {
    await store.create(tankDoc());
    await store.saveCamera('p', { zoom: 27, target: [4, 0, 4] });
    const getCamera = store.getCamera.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(store, 'getCamera').mockImplementation(async (id) => {
      await gate;
      return getCamera(id);
    });
    const router = createStudioRouter(createMemoryHistory({ initialEntries: ['/d/p'] }));
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    render(
      <StudioProvider services={{ host, store, channel }}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StudioProvider>,
    );
    // The document is read; the camera is not yet.
    await waitFor(async () => expect(await store.get('p')).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('process-editor')).toBeNull();
    release();
    await screen.findByTestId('process-editor');
    expect(editor.props?.camera).toEqual({ zoom: 27, target: [4, 0, 4] });
    expect(editor.mounts).toBe(1);
  });

  // holodeck#134: with a cached camera, `isPending` is false during the mount
  // refetch, so the document read finishing first opened the editor on the
  // cached (stale) camera and a newer one saved by another tab was ignored.
  it('does not open on a stale cached camera while the camera refetch is in flight', async () => {
    await store.create(tankDoc());
    await store.saveCamera('p', { zoom: 45, target: [7, 0, 7] }); // saved later by "another tab"
    const getCamera = store.getCamera.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(store, 'getCamera').mockImplementation(async (id) => {
      await gate;
      return getCamera(id);
    });
    const router = createStudioRouter(createMemoryHistory({ initialEntries: ['/d/p'] }));
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    // This tab's cache still holds the camera from an earlier visit.
    client.setQueryData(documentKeys.camera('p'), { zoom: 12, target: [0, 0, 0] });
    render(
      <StudioProvider services={{ host, store, channel }}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StudioProvider>,
    );
    await waitFor(async () => expect(await store.get('p')).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('process-editor')).toBeNull();
    release();
    await screen.findByTestId('process-editor');
    expect(editor.props?.camera).toEqual({ zoom: 45, target: [7, 0, 7] });
    expect(editor.mounts).toBe(1);
  });

  it('a failed camera read still opens the document (fit the scene)', async () => {
    await store.create(tankDoc());
    vi.spyOn(store, 'getCamera').mockRejectedValue(new Error('idb down'));
    await openWorkspace(tankDoc());
    expect(editor.props?.camera).toBeUndefined();
  });
});

describe('export commands (holodeck#42)', () => {
  /** Captures `downloadBlob` (object URL + anchor click) without a real download. */
  function captureDownloads() {
    const downloads: Array<{ name: string; blob: Blob }> = [];
    const blobs = new Map<string, Blob>();
    let seq = 0;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = `blob:test/${++seq}`;
      blobs.set(url, blob as Blob);
      return url;
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ name: this.download, blob: blobs.get(this.href)! });
    });
    return { downloads, restore: () => [create, revoke, click].forEach((m) => m.mockRestore()) };
  }

  it('publishes the name and downloads a PNG at the chosen scale, named after the document', async () => {
    await store.create(tankDoc());
    await openWorkspace(tankDoc());
    const { downloads, restore } = captureDownloads();
    try {
      const active = activeDocumentStore.state!;
      expect(active.name).toBe('Plant');
      const image = await active.exportImage(4);
      expect(editor.exportCalls).toEqual([{ scale: 4, signal: undefined }]);
      expect(image).toMatchObject({ name: 'plant@4x.png', width: 20, height: 10 });
      expect(downloads.map((d) => d.name)).toEqual(['plant@4x.png']);
      expect(downloads[0]!.blob.type).toBe('image/png');
    } finally {
      restore();
    }
  });

  it('downloads the components CSV and the document JSON', async () => {
    await store.create(tankDoc());
    await openWorkspace(tankDoc());
    const { downloads, restore } = captureDownloads();
    try {
      activeDocumentStore.state!.exportComponents();
      activeDocumentStore.state!.exportFile();
      expect(downloads.map((d) => d.name)).toEqual(['plant.components.csv', 'plant.holodeck.json']);
      const csv = await downloads[0]!.blob.text();
      expect(downloads[0]!.blob.type).toBe('text/csv;charset=utf-8');
      const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
      expect(lines[0]!.startsWith('id,part,label,category,package,layer')).toBe(true);
      expect(lines[1]!.startsWith('tank-1,tank,')).toBe(true);
      expect(JSON.parse(await downloads[1]!.blob.text())).toMatchObject({ format: 'holodeck.document.v1', id: 'p', name: 'Plant' });
    } finally {
      restore();
    }
  });
});
