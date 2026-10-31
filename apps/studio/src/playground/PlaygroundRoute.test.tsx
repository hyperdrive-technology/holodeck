/**
 * The playground page (`/playground`) over the real router, store
 * (fake-indexeddb), host and sim provider. ProcessEditor is a stub that
 * records its props and exposes a fake `editorRef` (as in
 * DocumentWorkspace.test.tsx): these tests check what the playground asks
 * the editor to do; the editor's own behaviour is covered by its package and
 * the e2e suite.
 */
import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import type { EditorAction, IsoSceneFile, ProcessEditorProps } from '@holodeck/editor-2.5d-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { useImperativeHandle } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionSecretStore } from '../connections/secrets';
import { openStudioDb } from '../documents/db';
import type { DocumentChange } from '../documents/store';
import { DocumentStore } from '../documents/store';
import { activeDocumentStore } from '../features/active-document';
import { withRequires } from '../features/use-document-session';
import { createStudioHost, hostDocumentProblems } from '../host/studio-host';
import { createStudioRouter } from '../router';
import { StudioProvider } from '../studio-context';
import { createPlaygroundDocument, PLAYGROUND_DOCUMENT_ID } from './starter';

const editor = vi.hoisted(() => ({
  mounts: 0,
  props: null as ProcessEditorProps | null,
  actions: [] as EditorAction[],
  /** What the stub's `getState` reports (selection + the place tool, for drops). */
  state: { selectedId: null as string | null, mode: 'select', placing: null as string | null, cursor: null as { x: number; y: number } | null },
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
        if (action.type === 'select') editor.state.selectedId = action.id;
      },
      getState: () =>
        ({
          ...editor.state,
          selectedIds: editor.state.selectedId ? [editor.state.selectedId] : [],
        }) as never,
      getCamera: () => ({ zoom: 1, target: [0, 0, 0] }),
      exportImage: async () => ({ width: 1, height: 1, tiles: 1, blob: new Blob() }),
    }));
    return <div data-testid="process-editor" data-object-count={props.scene.objects.length} data-mode={props.mode} />;
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
  store = new DocumentStore(openStudioDb('playground-test'), { validate: (doc) => hostDocumentProblems(host, doc) });
  listeners = [];
  Object.assign(editor, { mounts: 0, props: null, actions: [], state: { selectedId: null, mode: 'select', placing: null, cursor: null } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type IsoDoc = HolodeckDocument<IsoSceneFile>;
const starterCount = createPlaygroundDocument().body.objects.length;

async function openPlayground(path = '/playground') {
  const router = createStudioRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const view = render(
    <StudioProvider services={{ host, store, channel, secrets: new SessionSecretStore(null) }}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StudioProvider>,
  );
  await screen.findByTestId('process-editor');
  return { router, view };
}

const stored = async () => (await store.get(PLAYGROUND_DOCUMENT_ID))?.document as IsoDoc | undefined;
const withTank = (scene: IsoSceneFile, id = 'tank-1'): IsoSceneFile => ({ ...scene, objects: [...scene.objects, { id, object: 'tank', x: 0, y: 8 }] });
const readValue = (label: string) => Number(screen.getByLabelText(label).textContent);

describe('/playground', () => {
  it('first visit: creates the starter document and opens the Edit tab (library, canvas in edit mode, inspector), no document list', async () => {
    await openPlayground();
    await waitFor(async () => expect((await stored())?.body.objects).toHaveLength(starterCount));
    expect(editor.props?.mode).toBe('edit');
    expect(editor.props?.chrome).toBe('canvas');
    expect(editor.props?.scene.objects).toHaveLength(starterCount);
    expect(screen.getByRole('tab', { name: /Edit/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Viewer/ })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('library')).toBeInTheDocument();
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
    // No studio document list, welcome screen or "Delete document" here.
    expect(screen.queryByRole('button', { name: 'New from sample' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete document/ })).toBeNull();
    // The library places into the playground document.
    expect(activeDocumentStore.state?.id).toBe(PLAYGROUND_DOCUMENT_ID);
  });

  it('?tab=viewer opens the same scene in run mode, with a live status badge and live values that change', async () => {
    await openPlayground('/playground?tab=viewer');
    expect(editor.props?.mode).toBe('run');
    expect(screen.getByRole('tab', { name: /Viewer/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('library')).toBeNull();
    expect(screen.queryByTestId('inspector')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live'));
    const values = screen.getByTestId('live-values');
    await waitFor(() => expect(within(values).getByLabelText('feed-tank.level')).toBeInTheDocument());
    const first = readValue('feed-tank.level');
    expect(first).toBeGreaterThanOrEqual(0.15);
    expect(first).toBeLessThanOrEqual(0.9);
    await waitFor(() => expect(readValue('feed-tank.level')).not.toBe(first), { timeout: 3000 });
    // The canvas gets the same values.
    expect(editor.props?.metrics?.['feed-tank']?.level).toEqual(expect.any(Number));
  });

  it('an unknown tab opens Edit', async () => {
    const { router } = await openPlayground('/playground?tab=nope');
    expect(editor.props?.mode).toBe('edit');
    expect(router.state.location.search).toEqual({ tab: 'edit' });
  });

  it('switching tabs keeps the editor mounted, the selection and unsaved edits, never prompts, and the URL follows', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { router } = await openPlayground();
    act(() => editor.props!.onSelect!('mixer'));
    // An edit still being saved when the tab changes.
    act(() => editor.props!.onChange(withTank(editor.props!.scene)));
    fireEvent.click(screen.getByRole('tab', { name: /Viewer/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'viewer' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(editor.props?.mode).toBe('run');
    expect(editor.mounts).toBe(1);
    expect(editor.props?.selectedId).toBe('mixer');
    expect(editor.props?.scene.objects.some((o) => o.id === 'tank-1')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: /Edit/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'edit' }));
    expect(editor.mounts).toBe(1);
    expect(editor.props?.mode).toBe('edit');
    expect(screen.getByTestId('inspector-selected-id')).toHaveTextContent('mixer');
    await waitFor(async () => expect((await stored())?.body.objects.some((o) => o.id === 'tank-1')).toBe(true));
  });

  it('arrow keys move between tabs', async () => {
    const { router } = await openPlayground();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Edit/ }), { key: 'ArrowRight' });
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'viewer' }));
    fireEvent.keyDown(screen.getByRole('tab', { name: /Viewer/ }), { key: 'ArrowRight' });
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'edit' }));
  });

  it('autosaves; a reload reopens the saved scene, connections and bindings', async () => {
    const { view } = await openPlayground();
    const scene = editor.props!.scene;
    const bound = withTank(scene);
    bound.objects[bound.objects.length - 1]!.bindings = { level: { connection: 'sim', source: 'sine:10' } };
    act(() => editor.props!.onChange(bound));
    await waitFor(async () => expect((await stored())?.body.objects.find((o) => o.id === 'tank-1')?.bindings).toBeDefined());
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-save-status', 'saved');
    view.unmount();
    await openPlayground('/playground?tab=viewer');
    expect(editor.props?.scene.objects.find((o) => o.id === 'tank-1')?.bindings).toEqual({ level: { connection: 'sim', source: 'sine:10' } });
    await waitFor(() => expect(screen.getByLabelText('tank-1.level')).toBeInTheDocument());
  });

  it('Reset restores the starter scene and connection, with a fresh editor (undo history) and no selection', async () => {
    await openPlayground();
    act(() => editor.props!.onSelect!('feed-tank'));
    act(() => editor.props!.onChange({ ...withTank(editor.props!.scene), objects: [{ id: 'only', object: 'tank', x: 0, y: 0 }] }));
    // Remove the starter connection too.
    fireEvent.click(screen.getByRole('tab', { name: /Connections/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection sim' }));
    await waitFor(async () => expect((await stored())?.connections).toBeUndefined());

    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    const dialog = await screen.findByTestId('reset-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
    await waitFor(async () => expect((await stored())?.body.objects).toEqual(createPlaygroundDocument().body.objects));
    expect((await stored())?.connections).toEqual(createPlaygroundDocument().connections);
    expect(hostDocumentProblems(host, (await stored())!)).toEqual([]);
    expect(editor.mounts).toBe(2);
    expect(editor.props?.selectedId).toBeNull();
    expect(editor.props?.camera).toBeUndefined();
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-editor-epoch', '1');
  });

  it('Reset can be cancelled', async () => {
    await openPlayground();
    act(() => editor.props!.onChange(withTank(editor.props!.scene)));
    await waitFor(async () => expect((await stored())?.body.objects).toHaveLength(starterCount + 1));
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    fireEvent.click(within(await screen.findByTestId('reset-dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('reset-dialog')).toBeNull());
    expect((await stored())?.body.objects).toHaveLength(starterCount + 1);
    expect(editor.mounts).toBe(1);
  });

  it('binding a freshly dropped tank: "Bind to signal" lists the sim signals and scales 0-100 onto the 0..1 level', async () => {
    await openPlayground();
    act(() => editor.props!.onChange(withTank(editor.props!.scene)));
    act(() => editor.props!.onSelect!('tank-1'));
    editor.state.selectedId = 'tank-1';
    // The sim connection is open (its readings are flowing) before the dialog lists its signals.
    await waitFor(() => expect(screen.getByLabelText('feed-tank.level')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Bind Level' }));
    const dialog = await screen.findByTestId('binding-dialog');
    // Listed on open: no need to know the sim address syntax.
    const leaf = await within(dialog).findByText('Sine, 10 s, 0–100');
    fireEvent.click(leaf);
    expect(within(dialog).getByLabelText('Source')).toHaveValue('sine:10');
    expect(within(dialog).getByTestId('binding-suggested-scale')).toHaveTextContent('Scaled 0–100 to Level’s range 0–1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bind' }));
    expect(editor.actions).toContainEqual({
      type: 'patch-selected',
      patch: { bindings: { level: { connection: 'sim', source: 'sine:10', transform: { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 } } } },
    });
  });

  it('a library drag released over the canvas stamps the part at the ghost; released elsewhere it cancels', async () => {
    await openPlayground();
    const active = activeDocumentStore.state!;
    act(() => active.startDragItem('holodeck.iso.part', 'tank'));
    expect(editor.props?.placing).toBe('tank');
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-placing', 'tank');
    Object.assign(editor.state, { mode: 'place', placing: 'tank', cursor: { x: 2, y: 5 } });
    const onCanvas = document.createElement('canvas');
    screen.getByTestId('process-editor').append(onCanvas);
    act(() => activeDocumentStore.state!.dropItem('holodeck.iso.part', 'tank', onCanvas));
    expect(editor.actions).toEqual([{ type: 'palette-drop', object: 'tank', x: 2, y: 5 }]);

    editor.actions.length = 0;
    const elsewhere = document.createElement('canvas');
    document.body.append(elsewhere);
    act(() => activeDocumentStore.state!.dropItem('holodeck.iso.part', 'tank', elsewhere));
    expect(editor.actions).toEqual([{ type: 'select-mode' }]);
    act(() => activeDocumentStore.state!.dropItem('holodeck.iso.part', 'tank', null));
    expect(editor.actions).toEqual([{ type: 'select-mode' }, { type: 'select-mode' }]);
    elsewhere.remove();
  });

  it('a provider error shows a badge, the message and a canvas notice in the Viewer; the other connection stays live', async () => {
    const doc = createPlaygroundDocument();
    // Nothing listens on port 9 (discard): the HTTP provider fails to connect.
    doc.connections = [...doc.connections!, { id: 'api', provider: 'holodeck.http', label: 'Broken API', config: { url: 'http://127.0.0.1:9/plant.json', intervalMs: 200 } }];
    const feed = doc.body.objects.find((o) => o.id === 'feed-tank')!;
    feed.bindings = { ...feed.bindings, temp: { connection: 'api', source: '/temp' } };
    withRequires(doc, host);
    await store.create(doc);
    await openPlayground('/playground?tab=viewer');
    await waitFor(() => expect(screen.getByTestId('viewer-status-api')).toHaveAttribute('data-state', 'error'), { timeout: 10_000 });
    expect(screen.getByTestId('viewer-message-api').textContent).not.toBe('');
    expect(screen.getByTestId('viewer-problems')).toHaveTextContent('Broken API');
    await waitFor(() => expect(screen.getByTestId('viewer-status-sim')).toHaveAttribute('data-state', 'live'));
    expect(editor.mounts).toBe(1);
  });

  it('Pause freezes the Viewer on the current values; Resume follows the feed again; leaving the Viewer resumes', async () => {
    await openPlayground('/playground?tab=viewer');
    await waitFor(() => expect(screen.getByLabelText('feed-tank.level')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('viewer-pause'));
    expect(screen.getByTestId('viewer-pause')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('viewer-paused')).toBeInTheDocument();
    const frozen = readValue('feed-tank.level');
    const frozenMetrics = editor.props?.metrics;
    await act(() => new Promise((r) => setTimeout(r, 700)));
    expect(readValue('feed-tank.level')).toBe(frozen);
    expect(editor.props?.metrics).toBe(frozenMetrics);
    fireEvent.click(screen.getByTestId('viewer-pause'));
    await waitFor(() => expect(readValue('feed-tank.level')).not.toBe(frozen), { timeout: 3000 });
    // Pause, then go to Edit: the canvas there is live.
    fireEvent.click(screen.getByTestId('viewer-pause'));
    fireEvent.click(screen.getByRole('tab', { name: /Edit/ }));
    await waitFor(() => expect(editor.props?.mode).toBe('edit'));
    fireEvent.click(screen.getByRole('tab', { name: /Viewer/ }));
    await waitFor(() => expect(screen.getByTestId('viewer-pause')).toHaveAttribute('aria-pressed', 'false'));
  });

  it('Undo / Redo in the header run the editor’s own history', async () => {
    await openPlayground();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(editor.actions).toEqual([{ type: 'undo' }, { type: 'redo' }]);
  });

  it('deleted in another tab: starts again from the starter', async () => {
    await openPlayground();
    act(() => editor.props!.onChange(withTank(editor.props!.scene)));
    await waitFor(async () => expect((await stored())?.body.objects).toHaveLength(starterCount + 1));
    await store.remove(PLAYGROUND_DOCUMENT_ID);
    act(() => listeners.forEach((l) => l({ type: 'deleted', id: PLAYGROUND_DOCUMENT_ID })));
    await waitFor(() => expect(editor.mounts).toBe(2));
    expect(editor.props?.scene.objects).toHaveLength(starterCount);
    expect((await stored())?.body.objects).toHaveLength(starterCount);
    expect(screen.getByText('The playground was deleted in another tab')).toBeInTheDocument();
  });
});
