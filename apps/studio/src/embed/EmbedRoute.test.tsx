/**
 * The read-only embed route and its postMessage bridge (holodeck#42), with
 * the engine's ProcessEditor replaced by a prop-recording stub (rendering is
 * covered by the engine and the e2e). A fake parent frame stands in for
 * `window.parent`; messages are dispatched on `window` like the browser does.
 */
import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import type { ProcessEditorProps } from '@holodeck/editor-2.5d-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudioDb } from '../documents/db';
import { createIsoDocument } from '../documents/new-document';
import { DocumentStore } from '../documents/store';
import { createStudioHost, hostDocumentProblems } from '../host/studio-host';
import { StudioProvider } from '../studio-context';
import { NO_CHANNEL, withPart } from '../test-support';
import { EmbedRoute } from './EmbedRoute';
import type { FrameContext } from './origins';
import { EMBED_PROTOCOL } from './protocol';

const editor = vi.hoisted(() => ({ props: null as ProcessEditorProps | null, mounts: 0 }));

vi.mock('@holodeck/editor-2.5d-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@holodeck/editor-2.5d-react')>();
  const { useEffect } = await import('react');
  function StubEditor(props: ProcessEditorProps) {
    editor.props = props;
    useEffect(() => {
      editor.mounts += 1;
    }, []);
    return <div data-testid="process-editor" data-host-mode={props.mode} data-scene-id={props.scene.id} />;
  }
  return { ...actual, ProcessEditor: StubEditor };
});

let host: HolodeckHost;
let store: DocumentStore;
let parent: { postMessage: ReturnType<typeof vi.fn<(message: unknown, targetOrigin: string) => void>> };
const ORIGIN = window.location.origin;

beforeAll(async () => {
  host = await createStudioHost();
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store = new DocumentStore(openStudioDb('embed-test'), { validate: (doc) => hostDocumentProblems(host, doc) });
  parent = { postMessage: vi.fn<(message: unknown, targetOrigin: string) => void>() };
  editor.props = null;
  editor.mounts = 0;
});

function plant(id = 'plant-1', name = 'Plant') {
  const doc = createIsoDocument(name, id);
  doc.body = withPart(doc.body, host.registry, 'tank').scene;
  return doc;
}

function renderEmbed(docId: string, embedParent: typeof parent | null = parent, frameContext?: FrameContext) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  return render(
    <StudioProvider services={{ host, store, channel: NO_CHANNEL }}>
      <QueryClientProvider client={client}>
        <EmbedRoute docId={docId} embedParent={embedParent} frameContext={frameContext} />
      </QueryClientProvider>
    </StudioProvider>,
  );
}

/** Dispatch a message the way the browser would deliver one from `source` at `origin`. */
function deliver(data: unknown, { origin = ORIGIN, source = parent as unknown }: { origin?: string; source?: unknown } = {}) {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

const posted = () => parent.postMessage.mock.calls.map(([message, target]) => ({ message, target }));

describe('/embed/$docId', () => {
  it('shows the stored document in run mode without editing chrome', async () => {
    await store.create(plant());
    renderEmbed('plant-1');
    const root = await screen.findByTestId('embed');
    await screen.findByTestId('process-editor');
    expect(editor.props).toMatchObject({ mode: 'run', chrome: 'canvas' });
    expect(editor.props?.scene.objects.map((o) => o.id)).toEqual(['tank-1']);
    expect(root).toHaveAttribute('data-embed-api', 'on');
    expect(root).toHaveAttribute('data-document-id', 'plant-1');
    // No studio chrome at all.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('announces ready to its own origin only (no wildcard)', async () => {
    await store.create(plant());
    renderEmbed('plant-1');
    await screen.findByTestId('process-editor');
    await waitFor(() => expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'ready', documentId: 'plant-1' }, target: ORIGIN }));
    expect(posted().every((p) => p.target !== '*')).toBe(true);
  });

  it('opens on the stored camera', async () => {
    await store.create(plant());
    await store.saveCamera('plant-1', { zoom: 40, target: [1, 0, 1] });
    renderEmbed('plant-1');
    await screen.findByTestId('process-editor');
    expect(editor.props?.camera).toEqual({ zoom: 40, target: [1, 0, 1] });
  });

  it('setObjectState overrides live values and replies to the sender', async () => {
    await store.create(plant());
    renderEmbed('plant-1');
    await screen.findByTestId('process-editor');
    deliver({ protocol: EMBED_PROTOCOL, type: 'setObjectState', requestId: 's1', objectId: 'tank-1', state: { level: 0.5 } });
    await waitFor(() => expect(editor.props?.metrics?.['tank-1']?.level).toBe(0.5));
    expect(screen.getByTestId('embed')).toHaveAttribute('data-object-states', '1');
    expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'result', requestId: 's1', ok: true }, target: ORIGIN });
    deliver({ protocol: EMBED_PROTOCOL, type: 'clearObjectState', objectId: 'tank-1' });
    await waitFor(() => expect(editor.props?.metrics?.['tank-1']).toBeUndefined());
  });

  it('ignores messages from other origins and other frames', async () => {
    await store.create(plant());
    renderEmbed('plant-1');
    await screen.findByTestId('process-editor');
    parent.postMessage.mockClear();
    const set = { protocol: EMBED_PROTOCOL, type: 'setObjectState', requestId: 'x', objectId: 'tank-1', state: { level: 1 } };
    deliver(set, { origin: 'https://evil.example' });
    deliver(set, { source: { postMessage: vi.fn() } });
    deliver(set, { source: null });
    expect(editor.props?.metrics?.['tank-1']).toBeUndefined();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('answers invalid messages with an error when they carry a request id, and ignores foreign ones', async () => {
    await store.create(plant());
    renderEmbed('plant-1');
    await screen.findByTestId('process-editor');
    parent.postMessage.mockClear();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      deliver({ protocol: EMBED_PROTOCOL, type: 'setObjectState', requestId: 'bad', objectId: 'tank-1', state: { level: Number.NaN } });
      deliver({ protocol: EMBED_PROTOCOL, type: 'setObjectState', requestId: 'missing', objectId: 'ghost', state: { level: 1 } });
      deliver({ type: 'webpackOk' });
      deliver('hello');
    } finally {
      warn.mockRestore();
    }
    expect(posted().map((p) => p.message)).toEqual([
      expect.objectContaining({ requestId: 'bad', ok: false, error: expect.stringMatching(/finite number/) }),
      expect.objectContaining({ requestId: 'missing', ok: false, error: 'objectId: "ghost" is not in the document' }),
    ]);
    expect(editor.props?.metrics?.['tank-1']).toBeUndefined();
  });

  it('loadDocument shows the sent document, resets overrides, re-announces, and never stores it', async () => {
    await store.create(plant());
    renderEmbed('plant-1');
    await screen.findByTestId('process-editor');
    deliver({ protocol: EMBED_PROTOCOL, type: 'setObjectState', objectId: 'tank-1', state: { level: 0.5 } });
    const other = plant('other-1', 'Other') as HolodeckDocument;
    deliver({ protocol: EMBED_PROTOCOL, type: 'loadDocument', requestId: 'l1', document: JSON.parse(JSON.stringify(other)) });
    await waitFor(() => expect(editor.props?.scene.id).toBe('other-1'));
    expect(editor.props?.metrics?.['tank-1']).toBeUndefined();
    expect(editor.props?.camera).toBeUndefined();
    expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'result', requestId: 'l1', ok: true }, target: ORIGIN });
    await waitFor(() => expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'ready', documentId: 'other-1' }, target: ORIGIN }));
    expect(await store.has('other-1')).toBe(false);
    expect((await store.get('plant-1'))?.revision).toBe(1);
  });

  it('getInfo lists the objects', async () => {
    await store.create(plant());
    renderEmbed('plant-1');
    await screen.findByTestId('process-editor');
    deliver({ protocol: EMBED_PROTOCOL, type: 'getInfo', requestId: 'i' });
    expect(posted()).toContainEqual({
      message: { protocol: EMBED_PROTOCOL, type: 'info', requestId: 'i', documentId: 'plant-1', name: 'Plant', objects: [{ id: 'tank-1', part: 'tank' }] },
      target: ORIGIN,
    });
  });

  it('waits for loadDocument when the document is not stored here', async () => {
    renderEmbed('elsewhere');
    expect(await screen.findByText('This document is not available here.')).toBeInTheDocument();
    expect(screen.getByTestId('embed')).toHaveAttribute('data-embed-api', 'on');
    deliver({ protocol: EMBED_PROTOCOL, type: 'loadDocument', document: JSON.parse(JSON.stringify(plant())) });
    await screen.findByTestId('process-editor');
    expect(editor.props?.scene.id).toBe('plant-1');
  });

  it('turns the message API off when not framed', async () => {
    await store.create(plant());
    renderEmbed('plant-1', null);
    await screen.findByTestId('process-editor');
    expect(screen.getByTestId('embed')).toHaveAttribute('data-embed-api', 'off');
  });

  describe('framed by a URL-granted (untrusted) parent (holodeck#151)', () => {
    const SIBLING = 'https://sibling.example';
    const sibling: FrameContext = { framed: true, ancestorOrigins: [SIBLING], referrer: `${SIBLING}/`, parentIsTop: true };
    beforeEach(() => window.history.replaceState(null, '', `/embed/plant-1?parentOrigin=${encodeURIComponent(SIBLING)}`));
    afterEach(() => window.history.replaceState(null, '', '/'));

    it('never shows, announces or describes the stored document', async () => {
      await store.create(plant());
      const get = vi.spyOn(store, 'get');
      const getCamera = vi.spyOn(store, 'getCamera');
      renderEmbed('plant-1', parent, sibling);
      expect(await screen.findByText('Waiting for the embedding page to send a document.')).toBeInTheDocument();
      expect(screen.getByTestId('embed')).toHaveAttribute('data-stored-documents', 'hidden');
      expect(screen.queryByTestId('process-editor')).toBeNull();
      expect(get).not.toHaveBeenCalled();
      expect(getCamera).not.toHaveBeenCalled();
      await waitFor(() => expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'ready', documentId: null }, target: SIBLING }));
      deliver({ protocol: EMBED_PROTOCOL, type: 'getInfo', requestId: 'i' }, { origin: SIBLING });
      expect(posted()).toContainEqual({
        message: { protocol: EMBED_PROTOCOL, type: 'info', requestId: 'i', documentId: null, name: null, objects: [] },
        target: SIBLING,
      });
      deliver({ protocol: EMBED_PROTOCOL, type: 'setObjectState', requestId: 's', objectId: 'tank-1', state: { level: 1 } }, { origin: SIBLING });
      expect(posted()).toContainEqual({ message: expect.objectContaining({ requestId: 's', ok: false, error: 'no document is loaded' }), target: SIBLING });
      // Nothing it posted carries the stored name or objects.
      expect(JSON.stringify(posted())).not.toContain('Plant');
      expect(JSON.stringify(posted())).not.toContain('tank-1"');
    });

    it('still shows a document the parent sends', async () => {
      await store.create(plant());
      renderEmbed('plant-1', parent, sibling);
      await screen.findByText('Waiting for the embedding page to send a document.');
      deliver({ protocol: EMBED_PROTOCOL, type: 'loadDocument', requestId: 'l', document: JSON.parse(JSON.stringify(plant('mine', 'Mine'))) }, { origin: SIBLING });
      await screen.findByTestId('process-editor');
      expect(editor.props?.scene.id).toBe('mine');
      await waitFor(() => expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'ready', documentId: 'mine' }, target: SIBLING }));
    });

    it('shows the stored document to a same-origin parent', async () => {
      await store.create(plant());
      renderEmbed('plant-1', parent, { framed: true, ancestorOrigins: [ORIGIN], referrer: `${ORIGIN}/`, parentIsTop: true });
      await screen.findByTestId('process-editor');
      expect(screen.getByTestId('embed')).toHaveAttribute('data-stored-documents', 'shown');
      // ...but its id is still announced to the URL-granted origin as null.
      await waitFor(() => expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'ready', documentId: 'plant-1' }, target: ORIGIN }));
      expect(posted()).toContainEqual({ message: { protocol: EMBED_PROTOCOL, type: 'ready', documentId: null }, target: SIBLING });
    });
  });
});
