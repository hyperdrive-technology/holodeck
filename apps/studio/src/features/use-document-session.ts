/**
 * One open, editable document: the working copy, its DocumentWriter, the
 * live-data hub, and every command the studio runs on it (library add / arm
 * / drop, inspector edits, connections, rename, adopt, replace).
 *
 * Extracted from DocumentWorkspace (`/d/$docId`) so the playground
 * (`/playground`) edits its document through exactly the same code: one
 * writer per open document, revision-checked autosave, cross-tab adoption,
 * the "restore a removed connection on undo" rule, and the commands the
 * library / header / hotkeys read from `activeDocumentStore`.
 *
 * What stays in the route components: layout, the conflict dialog's
 * navigation choices, and route-specific lifecycle (a document deleted in
 * another tab, the playground's reset).
 */

import { HOLODECK_KINDS, type HolodeckDocument, type HolodeckHost, type ProviderConnection } from '@holodeck/sdk';
import type { IsoSceneFile, ProcessEditorHandle, ProcessEditorProps } from '@holodeck/editor-2.5d-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { StudioCamera } from '../documents/db';
import { withDocumentName } from '../documents/document-ops';
import { imageFileName } from '../documents/io';
import { libraryDropPoint } from '../documents/iso-scene';
import { documentKeys, useSaveCamera } from '../documents/queries';
import type { VersionedDocument } from '../documents/store';
import { DocumentWriter, type WriterState } from '../documents/writer';
import { documentRequires, mergeRequires } from '../host/studio-host';
import { notify } from '../layout/ui-state';
import { useStudio } from '../studio-context';
import { reconcileConnections } from '../connections/bindings';
import { connectionFingerprint } from '../connections/fingerprint';
import { useConnectionHub, type ConnectionHub } from '../connections/use-connection-hub';
import { activeDocumentStore } from './active-document';
import type { ConnectionSubmit } from './connections/ConnectionDialog';
import { inspectorActions, libraryAddActions, libraryDropActions } from './editor-commands';
import { downloadBlob, downloadComponentsCsv, downloadDocument } from './file-io';
import type { InspectorEdit } from './Inspector';
import { describeSaveStatus } from './save-status';

export type IsoDoc = HolodeckDocument<IsoSceneFile>;

/** Recompute `requires` (parts + connection providers, holodeck#172) on a draft document, in place. */
export function withRequires(doc: IsoDoc, host: HolodeckHost): void {
  const requires = mergeRequires(host, doc.requires, documentRequires(host, doc.body, doc.connections));
  if (Object.keys(requires).length) doc.requires = requires;
  else delete doc.requires;
}

export interface DocumentSessionOptions {
  initial: VersionedDocument;
  /** The camera stored for this document; undefined = fit the scene. */
  initialCamera: StudioCamera | undefined;
  /**
   * The canvas element (the `<main>` around ProcessEditor). A library drag
   * only places when it is released over a `<canvas>` inside it.
   */
  canvasHostRef: RefObject<HTMLElement | null>;
}

export interface DocumentSession {
  doc: IsoDoc;
  /** Always the latest working copy (for callbacks that must not go stale). */
  docRef: RefObject<IsoDoc>;
  writer: DocumentWriter;
  writerState: WriterState;
  editorRef: RefObject<ProcessEditorHandle | null>;
  /** Bumped on adopt / replace: key ProcessEditor on it for a fresh undo history. */
  editorEpoch: number;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  placing: string | null;
  live: ConnectionHub;
  /** Set when the user already chose what happens to their edits (copy saved, discard, delete): no leave prompt. */
  leaving: RefObject<boolean>;
  conflict: Extract<WriterState['status'], { kind: 'conflict' }> | null;
  /** Replace the working copy with a stored version (load latest, or another tab's change). */
  adopt: (version: VersionedDocument) => void;
  /**
   * Replace the working copy with new content under the same id (the
   * playground's Reset): fresh undo history, no selection, the scene refitted,
   * this tab's secrets for the document dropped, then saved like any edit.
   */
  replace: (next: IsoDoc) => void;
  saveConnection: (submit: ConnectionSubmit, isNew: boolean) => void;
  removeConnection: (id: string) => void;
  onRename: (name: string) => void;
  onEdit: (id: string, edit: InspectorEdit) => void;
  onDeleteObject: (id: string) => void;
  /** React `key` for ProcessEditor: a different document or epoch mounts a fresh editor. */
  editorKey: string;
  /** The ProcessEditor props every editable canvas shares (add `mode`, `metrics`, `chrome`). */
  editorProps: Pick<
    ProcessEditorProps,
    'scene' | 'onChange' | 'registry' | 'selectedId' | 'onSelect' | 'editorRef' | 'camera' | 'onCameraChange' | 'placing' | 'onPlacingChange'
  >;
}

export function useDocumentSession({ initial, initialCamera, canvasHostRef }: DocumentSessionOptions): DocumentSession {
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
  const docRef = useRef(doc);
  docRef.current = doc;

  const writer = useMemo(
    () =>
      new DocumentWriter(
        store,
        initial.document.id,
        initial.revision,
        (saved) => {
          client.setQueryData(documentKeys.detail(saved.document.id), saved);
          void client.invalidateQueries({ queryKey: documentKeys.list() });
        },
        initial.generation,
      ),
    // One writer per mounted document (the routes key their workspace by id).
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
  // A search-only change on the same path (the playground's Edit / Viewer
  // tab) keeps this document open, so it never asks.
  const leaving = useRef(false);
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.pathname !== next.pathname &&
      !leaving.current &&
      writer.hasUnsavedEdits() &&
      !window.confirm('This document has changes that are not saved. Leave anyway?'),
    // `hasUnsavedEdits`, not `!isClean()`: a document deleted elsewhere with
    // nothing unsaved here has nothing to lose (holodeck#250).
    enableBeforeUnload: () => !leaving.current && writer.hasUnsavedEdits(),
  });

  const saveWorkingCopy = useCallback(() => {
    void writer.save(docRef.current);
  }, [writer]);

  /** Connections removed in this session, so an undo that brings back their bindings can restore them (holodeck#164). */
  const removedConnections = useRef(new Map<string, ProviderConnection>());

  /** Apply a new body: recompute `requires`, update the working copy, persist. */
  const commitScene = useCallback(
    (scene: IsoSceneFile) => {
      const next: IsoDoc = { ...docRef.current, body: scene };
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
      withRequires(next, host);
      docRef.current = next;
      setDoc(next);
      saveWorkingCopy();
    },
    [host, saveWorkingCopy],
  );

  const replace = useCallback(
    (replacement: IsoDoc) => {
      const next: IsoDoc = { ...replacement, id: initial.document.id };
      withRequires(next, host);
      removedConnections.current.clear();
      secrets.clear(initial.document.id);
      // Fit the new scene instead of keeping a view of the old one.
      cameraRef.current = undefined;
      docRef.current = next;
      setDoc(next);
      setEditorEpoch((n) => n + 1);
      setSelectedId(null);
      setPlacing(null);
      saveWorkingCopy();
    },
    [host, initial.document.id, saveWorkingCopy, secrets],
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

  /**
   * Library drag (features/library-drag.ts): past the drag threshold the part
   * is armed, the editor's ghost follows the pointer over the canvas; on
   * release the part is stamped at the ghost (`palette-drop`, one undoable
   * step, selected), or the tool is dropped when released anywhere else.
   */
  const startDragItem = useCallback((kind: string, itemId: string) => {
    if (kind !== HOLODECK_KINDS.isoPart) return;
    setPlacing(itemId);
  }, []);
  const dropItem = useCallback(
    (kind: string, itemId: string, target: Element | null) => {
      const editor = editorRef.current;
      if (kind !== HOLODECK_KINDS.isoPart || !editor) return;
      const overCanvas = target instanceof HTMLCanvasElement && (canvasHostRef.current?.contains(target) ?? false);
      for (const action of libraryDropActions(host.registry, editor.getState(), itemId, overCanvas)) editor.dispatch(action);
    },
    [canvasHostRef, host],
  );

  // Publish this document's commands to the shell (library, header, hotkeys).
  useEffect(() => {
    activeDocumentStore.setState(() => ({
      id: initial.document.id,
      name: doc.name,
      placing,
      armItem,
      addItem,
      startDragItem,
      dropItem,
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
  }, [initial.document.id, doc.name, placing, armItem, addItem, startDragItem, dropItem, writer, host]);

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
      withRequires(next, host);
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
    [host, live, saveWorkingCopy, secrets],
  );

  const removeConnection = useCallback(
    (id: string) => {
      const removed = docRef.current.connections?.find((c) => c.id === id);
      if (removed) removedConnections.current.set(id, removed);
      const connections = (docRef.current.connections ?? []).filter((c) => c.id !== id);
      const next: IsoDoc = { ...docRef.current, connections };
      if (!connections.length) delete next.connections;
      withRequires(next, host);
      docRef.current = next;
      setDoc(next);
      saveWorkingCopy();
      secrets.clear(next.id, id);
    },
    [host, saveWorkingCopy, secrets],
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

  const onCameraChange = useCallback(
    (camera: StudioCamera) => {
      cameraRef.current = camera;
      saveCamera({ id: initial.document.id, camera });
    },
    [initial.document.id, saveCamera],
  );

  const conflict = writerState.status.kind === 'conflict' ? writerState.status : null;

  return {
    doc,
    docRef,
    writer,
    writerState,
    editorRef,
    editorEpoch,
    selectedId,
    setSelectedId,
    placing,
    live,
    leaving,
    conflict,
    adopt,
    replace,
    saveConnection,
    removeConnection,
    onRename,
    onEdit,
    onDeleteObject,
    editorKey: `${doc.id}:${editorEpoch}`,
    editorProps: {
      scene: doc.body,
      onChange: commitScene,
      registry: host.registry,
      selectedId,
      onSelect: setSelectedId,
      editorRef,
      camera: cameraRef.current,
      onCameraChange,
      placing,
      onPlacingChange: setPlacing,
    },
  };
}
