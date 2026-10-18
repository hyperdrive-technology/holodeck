import { HOLODECK_KINDS, type HolodeckDocument, type ProviderConnection } from '@holodeck/sdk';
import { ISO_ENGINE_ID, ProcessEditor, type IsoSceneFile, type ProcessEditorHandle } from '@holodeck/editor-2.5d-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { StudioCamera } from '../documents/db';
import { libraryDropPoint, usedIsoContributions } from '../documents/iso-scene';
import { documentKeys, useDocument, useDocumentCamera, useSaveCamera } from '../documents/queries';
import { withDocumentName } from '../documents/document-ops';
import type { VersionedDocument } from '../documents/store';
import { DocumentWriter } from '../documents/writer';
import { INSPECTOR_BOUNDS, INSPECTOR_WIDTH_KEY } from '../layout/panel-width.logic';
import { SidePanel } from '../layout/SidePanel';
import { notify, panelStore } from '../layout/ui-state';
import { requiresFor } from '../host/studio-host';
import { useStudio } from '../studio-context';
import { LiveValues } from './LiveValues';
import { activeDocumentStore } from './active-document';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { ConflictDialog } from './ConflictDialog';
import { inspectorActions, libraryAddActions } from './editor-commands';
import { downloadBlob, downloadComponentsCsv, downloadDocument } from './file-io';
import { imageFileName } from '../documents/io';
import { reconcileConnections } from '../connections/bindings';
import { connectionFingerprint } from '../connections/fingerprint';
import { useConnectionHub } from '../connections/use-connection-hub';
import { ConnectionsPanel } from './connections/ConnectionsPanel';
import type { ConnectionSubmit } from './connections/ConnectionDialog';
import { Inspector, type InspectorEdit } from './Inspector';
import { describeSaveStatus } from './save-status';
import { useStudioActions } from './use-studio-actions';

type IsoDoc = HolodeckDocument<IsoSceneFile>;

/** Route component for `/d/$docId`: loads the document, then hands it to the editor. */
export function DocumentRoute({ docId }: { docId: string }) {
  const { data, isPending, error, isFetchedAfterMount } = useDocument(docId);
  const camera = useDocumentCamera(docId);
  // The version this route last opened. If the document then disappears
  // (deleted in another tab, holodeck#115), the workspace stays mounted with
  // its working copy until it is clean or the user has chosen what to keep;
  // unmounting it here would drop unsaved edits without any prompt.
  const [opened, setOpened] = useState<VersionedDocument | null>(null);
  // Open only on a read made after mount: a cached copy can be stale (holodeck#117).
  // ... and only once the stored camera is known too: opening first would mount
  // the editor without it and the camera arriving later would be ignored
  // (review of holodeck#128). "Known" means read after mount as well: with a
  // cached camera `isPending` is already false during the mount refetch, and
  // opening then would start from a camera another tab has since replaced
  // (holodeck#134). A failed camera read still opens (fit the scene).
  const cameraReady = camera.isFetchedAfterMount;
  if (data && isFetchedAfterMount && cameraReady && data !== opened) setOpened(data);
  const kept = opened?.document.id === docId ? opened : null;
  const release = useCallback(() => setOpened(null), []);
  if (error && !kept) return <CenteredMessage tone="error">Could not open the document: {error.message}</CenteredMessage>;
  if (!kept && (isPending || !isFetchedAfterMount || !cameraReady)) return <CenteredMessage>Loading document…</CenteredMessage>;
  const current = (isFetchedAfterMount ? data : undefined) ?? kept;
  if (!current) return <CenteredMessage>This document does not exist (it may have been deleted).</CenteredMessage>;
  if (current.document.engine !== ISO_ENGINE_ID) return <CenteredMessage>No editor for engine “{current.document.engine}” yet.</CenteredMessage>;
  // key: a different document gets fresh editor state (selection, working copy, writer).
  return (
    <DocumentWorkspace
      key={current.document.id}
      initial={current}
      initialCamera={camera.isError ? undefined : (camera.data ?? undefined)}
      deletedElsewhere={!isPending && data === null}
      onReleased={release}
    />
  );
}

function CenteredMessage({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex h-full flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * The open document: canvas + inspector. Owns the working copy; every
 * committed change goes through one DocumentWriter (serial, revision-checked
 * writes; see documents/writer.ts).
 */
function DocumentWorkspace({
  initial,
  initialCamera,
  deletedElsewhere,
  onReleased,
}: {
  initial: VersionedDocument;
  /** The camera stored for this document; undefined = fit the scene. */
  initialCamera: StudioCamera | undefined;
  /** The stored document is gone (another tab deleted it). */
  deletedElsewhere: boolean;
  /** Let the route drop this workspace (nothing here needs keeping). */
  onReleased: () => void;
}) {
  const { host, store, channel, secrets } = useStudio();
  const client = useQueryClient();
  const [doc, setDoc] = useState<IsoDoc>(initial.document as IsoDoc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Part armed on the canvas place tool from the library (controlled `placing`). */
  const [placing, setPlacing] = useState<string | null>(null);
  const editorRef = useRef<ProcessEditorHandle>(null);
  /**
   * Latest view, as the editor reported it (debounced to gesture end).
   * Persisted per document, and handed back to the editor when it remounts
   * on adopt so the view does not jump (holodeck#118).
   */
  const cameraRef = useRef<StudioCamera | undefined>(initialCamera);
  const { mutate: saveCamera } = useSaveCamera();
  const { deleteDocument, openDocument } = useStudioActions();
  const navigate = useNavigate();
  const inspectorOpen = useSelector(panelStore, (s) => s.inspectorOpen);
  const docRef = useRef(doc);
  docRef.current = doc;

  const writer = useMemo(
    () =>
      new DocumentWriter(store, initial.document.id, initial.revision, (saved) => {
        client.setQueryData(documentKeys.detail(saved.document.id), saved);
        void client.invalidateQueries({ queryKey: documentKeys.list() });
      }),
    // One writer per mounted document (the route keys this component by id).
    [],
  );
  const writerState = useSyncExternalStore(writer.subscribe, writer.getState);

  /**
   * Bumped on every adopt to remount ProcessEditor. The editor keeps its
   * undo history across a `load` of the same scene id (editor-state.ts
   * `loadDocument`), so without a remount Undo after adopting another
   * version restored a pre-adopt scene and saved it at the adopted revision:
   * the other version vanished with no conflict (review of holodeck#102 @
   * 2b2a498). ProcessEditor has no history-reset action yet, so the remount
   * stays; the camera and selection are passed back in so it is seamless
   * (holodeck#118).
   */
  const [editorEpoch, setEditorEpoch] = useState(0);

  /** Replace the working copy with a stored version (load latest, or another tab's change). */
  const adopt = useCallback(
    (version: VersionedDocument) => {
      const next = version.document as IsoDoc;
      // The live view: `cameraRef` only updates after the editor's gesture
      // debounce, so a pan just before an adopt would otherwise be undone (#130).
      const live = editorRef.current?.getCamera();
      if (live) cameraRef.current = live;
      docRef.current = next;
      setDoc(next);
      setEditorEpoch((n) => n + 1);
      setSelectedId((id) => (id && next.body.objects.some((o) => o.id === id) ? id : null));
      setPlacing(null);
      writer.adopt(version);
      // Keep the query cache on the adopted version (holodeck#117).
      client.setQueryData(documentKeys.detail(version.document.id), version);
    },
    [client, writer],
  );

  // Unsaved, failed or conflicting edits: warn before the tab closes or the
  // route changes (holodeck#116). `isClean` is read at the moment of leaving.
  /** Set when the user already chose what happens to their edits (copy saved, discard, delete). */
  const leaving = useRef(false);
  useBlocker({
    shouldBlockFn: () => !leaving.current && !writer.isClean() && !window.confirm('This document has changes that are not saved. Leave anyway?'),
    enableBeforeUnload: () => !leaving.current && !writer.isClean(),
  });

  const saveWorkingCopy = useCallback(() => {
    void writer.save(docRef.current);
  }, [writer]);

  /** Apply a new body: recompute `requires`, update the working copy, persist. */
  /** Connections removed in this session, so an undo that brings back their bindings can restore them (holodeck#164). */
  const removedConnections = useRef(new Map<string, ProviderConnection>());

  const commitScene = useCallback(
    (scene: IsoSceneFile) => {
      const requires = requiresFor(host, usedIsoContributions(scene));
      const next: IsoDoc = { ...docRef.current, body: scene };
      if (Object.keys(requires).length) next.requires = requires;
      else delete next.requires;
      const reconciled = reconcileConnections(scene, next.connections ?? [], removedConnections.current);
      if (reconciled.restored.length) {
        next.connections = reconciled.connections;
        for (const id of reconciled.restored) removedConnections.current.delete(id);
        notify({
          tone: 'info',
          title: `Restored connection ${reconciled.restored.map((id) => `“${id}”`).join(', ')}`,
          details: ['Undo brought back bindings that use it. Its secrets were cleared when it was removed: enter them again if it needs any.'],
        });
      }
      docRef.current = next;
      setDoc(next);
      saveWorkingCopy();
    },
    [host, saveWorkingCopy],
  );

  // Failures surface once per transition into error / conflict.
  const lastStatus = useRef(writerState.status.kind);
  useEffect(() => {
    const kind = writerState.status.kind;
    if (kind === 'error' && lastStatus.current !== 'error') notify(describeSaveStatus(writerState.status));
    lastStatus.current = kind;
  }, [writerState.status]);

  // Another tab saved this document: adopt it when nothing here is pending.
  // With pending edits the next write conflicts and the user chooses.
  useEffect(
    () =>
      channel.subscribe((change) => {
        if (change.id !== initial.document.id || change.type !== 'saved') return;
        // Only a clean working copy (nothing queued, unsaved, failed or in conflict) may be replaced.
        if (!writer.isClean() || change.revision <= writer.getState().revision) return;
        void store.get(change.id).then((latest) => {
          if (!latest || !writer.isClean() || latest.revision <= writer.getState().revision) return;
          adopt(latest);
          notify({ tone: 'info', title: 'Updated with changes from another tab' });
        });
      }),
    [adopt, channel, initial.document.id, store, writer],
  );

  /** Library click: arm the canvas place tool (click again to disarm); the next floor click stamps it. */
  const armItem = useCallback(
    (kind: string, itemId: string) => {
      if (kind !== HOLODECK_KINDS.isoPart) return;
      if (placing === itemId) {
        setPlacing(null);
        // Disarm explicitly: a run part (Pipe) arms draw-pipe, whose editor
        // state keeps `placing: null`, so `placing` going back to null alone
        // looked like no change and canvas clicks kept drawing pipes (holodeck#133).
        editorRef.current?.dispatch({ type: 'select-mode' });
        return;
      }
      setPlacing(itemId);
    },
    [placing],
  );

  /**
   * Library "+": stamp the part next to the scene through the editor's own
   * place tool (`place-mode` + `floor-click`), so it is one undoable step
   * with the palette's defaults and inline-part attachment (holodeck#111).
   */
  const addItem = useCallback(
    (kind: string, itemId: string) => {
      const editor = editorRef.current;
      if (kind !== HOLODECK_KINDS.isoPart || !editor) return;
      const at = libraryDropPoint(docRef.current.body, host.registry);
      for (const action of libraryAddActions(host.registry, itemId, at)) editor.dispatch(action);
    },
    [host],
  );

  // Publish this document's commands to the shell (library, header, hotkeys).
  useEffect(() => {
    activeDocumentStore.setState(() => ({
      id: initial.document.id,
      name: doc.name,
      placing,
      armItem,
      addItem,
      exportFile: () => downloadDocument(docRef.current),
      exportComponents: () => downloadComponentsCsv(docRef.current, host.registry),
      exportImage: async (scale, signal) => {
        const editor = editorRef.current;
        if (!editor) throw new Error('the canvas is not ready');
        const image = await editor.exportImage({ scale, signal });
        const name = downloadBlob(image.blob, imageFileName(docRef.current, scale));
        return { ...image, name };
      },
      // Writes only when something is unsaved; reports the real outcome (holodeck#118).
      save: () => writer.persist(docRef.current),
    }));
    return () => activeDocumentStore.setState((current) => (current?.id === initial.document.id ? null : current));
  }, [initial.document.id, doc.name, placing, armItem, addItem, writer, host]);

  /**
   * Inspector edits run as editor actions on the selected object, so they
   * share the canvas undo history (holodeck#111). Delete is the editor's
   * `delete`, which detaches connector anchors and hosted inline parts
   * (`removeObjects`, holodeck#124).
   */
  const runOnObject = useCallback((id: string, edit: InspectorEdit | { kind: 'delete' }) => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const action of inspectorActions(editor.getState().selectedIds, id, edit)) editor.dispatch(action);
  }, []);
  const onEdit = useCallback((id: string, edit: InspectorEdit) => runOnObject(id, edit), [runOnObject]);
  const onDeleteObject = useCallback((id: string) => runOnObject(id, { kind: 'delete' }), [runOnObject]);
  // Live data: a hub on this document's connections + bindings, secrets from this tab (holodeck#101).
  const live = useConnectionHub(host, doc, secrets);

  /**
   * Add or edit a connection. The connection (non-secret settings) goes into
   * the document envelope and is saved; secrets go to this tab's
   * sessionStorage only, then the connection reopens to pick them up.
   * Envelope edits are not on the canvas undo stack (they are not body edits).
   */
  const saveConnection = useCallback(
    ({ connection, secrets: secretUpdates }: ConnectionSubmit, isNew: boolean) => {
      const current = docRef.current.connections ?? [];
      const previous = current.find((c) => c.id === connection.id);
      const connections = isNew ? [...current, connection] : current.map((c) => (c.id === connection.id ? connection : c));
      const fingerprint = connectionFingerprint(connection);
      // Pointed elsewhere: secrets entered for the old endpoint are dropped,
      // not carried over (they would be ignored anyway, holodeck#166).
      if (previous && connectionFingerprint(previous) !== fingerprint) secrets.clear(docRef.current.id, connection.id);
      const next: IsoDoc = { ...docRef.current, connections };
      docRef.current = next;
      setDoc(next);
      saveWorkingCopy();
      try {
        for (const [key, value] of Object.entries(secretUpdates)) secrets.set(next.id, connection.id, key, value, fingerprint);
      } catch (error) {
        notify({ tone: 'error', title: 'Could not keep the secrets in this tab', details: [error instanceof Error ? error.message : String(error)] });
      }
      if (Object.keys(secretUpdates).length || (previous && connectionFingerprint(previous) !== fingerprint)) live.reconnect(connection.id);
    },
    [live, saveWorkingCopy, secrets],
  );

  const removeConnection = useCallback(
    (id: string) => {
      const removed = docRef.current.connections?.find((c) => c.id === id);
      if (removed) removedConnections.current.set(id, removed);
      const connections = (docRef.current.connections ?? []).filter((c) => c.id !== id);
      const next: IsoDoc = { ...docRef.current, connections };
      if (!connections.length) delete next.connections;
      docRef.current = next;
      setDoc(next);
      saveWorkingCopy();
      secrets.clear(next.id, id);
    },
    [saveWorkingCopy, secrets],
  );

  const onRename = useCallback(
    (name: string) => {
      // Optimistic in the working copy; the store applies it to the stored
      // document inside its own transaction (store.rename).
      const next = withDocumentName(docRef.current, name);
      docRef.current = next;
      setDoc(next);
      void writer.rename(name);
    },
    [writer],
  );

  // Deleted elsewhere: a clean workspace just closes; one with unsaved,
  // failed or pending edits enters the "deleted elsewhere" conflict so the
  // user can save their version as a copy or discard it.
  useEffect(() => {
    if (!deletedElsewhere) return;
    if (leaving.current || writer.isClean()) onReleased();
    else writer.markDeleted();
  }, [deletedElsewhere, onReleased, writer]);

  const conflict = writerState.status.kind === 'conflict' ? writerState.status : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main
        className="relative min-h-0 min-w-0 flex-1"
        aria-label="Canvas"
        data-testid="canvas"
        data-document-id={doc.id}
        data-save-status={writerState.status.kind}
        data-revision={writerState.revision}
        data-dirty={writerState.dirty ? 'true' : 'false'}
        data-editor-epoch={editorEpoch}
        data-placing={placing ?? ''}
      >
        <CanvasErrorBoundary resetKey={doc.id}>
          <ProcessEditor
            key={`${doc.id}:${editorEpoch}`}
            scene={doc.body}
            onChange={commitScene}
            mode="edit"
            registry={host.registry}
            selectedId={selectedId}
            onSelect={setSelectedId}
            editorRef={editorRef}
            chrome="canvas"
            camera={cameraRef.current}
            onCameraChange={(camera) => {
              cameraRef.current = camera;
              saveCamera({ id: initial.document.id, camera });
            }}
            placing={placing}
            onPlacingChange={setPlacing}
            metrics={live.metrics}
          />
        </CanvasErrorBoundary>
        <LiveValues metrics={live.metrics} />
      </main>
      {inspectorOpen ? (
        <SidePanel side="right" storageKey={INSPECTOR_WIDTH_KEY} bounds={INSPECTOR_BOUNDS} label="Inspector" testId="inspector-panel">
          <Inspector
            doc={doc}
            selectedId={selectedId}
            onRename={onRename}
            onEdit={onEdit}
            onDeleteObject={onDeleteObject}
            onDeleteDocument={() => {
              leaving.current = true;
              secrets.clear(doc.id);
              void deleteDocument(doc.id, { navigateAway: true });
            }}
            live={{
              metrics: live.metrics,
              statuses: live.statuses,
              hub: live.hub,
              connectionsPanel: (
                <ConnectionsPanel
                  host={host}
                  doc={doc}
                  statuses={live.statuses}
                  secrets={secrets}
                  onSave={saveConnection}
                  onRemove={removeConnection}
                />
              ),
            }}
          />
        </SidePanel>
      ) : null}
      {conflict ? (
        <ConflictDialog
          name={doc.name}
          latest={conflict.latest}
          mine={doc}
          onLoadLatest={(latest) => {
            adopt(latest);
            setSelectedId(null);
          }}
          onSavedCopy={(copyId) => {
            leaving.current = true;
            void openDocument(copyId);
          }}
          onDiscard={() => {
            leaving.current = true;
            void navigate({ to: '/' });
          }}
        />
      ) : null}
    </div>
  );
}
