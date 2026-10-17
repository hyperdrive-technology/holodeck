import { HOLODECK_KINDS, type HolodeckDocument } from '@holodeck/sdk';
import { ISO_ENGINE_ID, ProcessEditor, type IsoPlacement, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { addPart, removePlacement, updatePlacement, usedIsoContributions } from '../documents/iso-scene';
import { documentKeys, useDocument } from '../documents/queries';
import { withDocumentName } from '../documents/document-ops';
import type { VersionedDocument } from '../documents/store';
import { DocumentWriter } from '../documents/writer';
import { INSPECTOR_BOUNDS, INSPECTOR_WIDTH_KEY } from '../layout/panel-width.logic';
import { SidePanel } from '../layout/SidePanel';
import { notify, panelStore } from '../layout/ui-state';
import { requiresFor } from '../host/studio-host';
import { useStudio } from '../studio-context';
import { activeDocumentStore } from './active-document';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { ConflictDialog } from './ConflictDialog';
import { downloadDocument } from './file-io';
import { Inspector } from './Inspector';
import { describeSaveStatus } from './save-status';
import { useStudioActions } from './use-studio-actions';

type IsoDoc = HolodeckDocument<IsoSceneFile>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Route component for `/d/$docId`: loads the document, then hands it to the editor. */
export function DocumentRoute({ docId }: { docId: string }) {
  const { data, isPending, error } = useDocument(docId);
  if (isPending) return <CenteredMessage>Loading document…</CenteredMessage>;
  if (error) return <CenteredMessage tone="error">Could not open the document: {error.message}</CenteredMessage>;
  if (!data) return <CenteredMessage>This document does not exist (it may have been deleted).</CenteredMessage>;
  if (data.document.engine !== ISO_ENGINE_ID) return <CenteredMessage>No editor for engine “{data.document.engine}” yet.</CenteredMessage>;
  // key: a different document gets fresh editor state (selection, working copy, writer).
  return <DocumentWorkspace key={data.document.id} initial={data} />;
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
function DocumentWorkspace({ initial }: { initial: VersionedDocument }) {
  const { host, store, channel } = useStudio();
  const client = useQueryClient();
  const [doc, setDoc] = useState<IsoDoc>(initial.document as IsoDoc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
   * 2b2a498). A history-reset prop on ProcessEditor would be cleaner (#100).
   */
  const [editorEpoch, setEditorEpoch] = useState(0);

  /** Replace the working copy with a stored version (load latest, or another tab's change). */
  const adopt = useCallback(
    (version: VersionedDocument) => {
      const next = version.document as IsoDoc;
      docRef.current = next;
      setDoc(next);
      setEditorEpoch((n) => n + 1);
      writer.adopt(version);
    },
    [writer],
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
  const commitScene = useCallback(
    (scene: IsoSceneFile) => {
      const requires = requiresFor(host, usedIsoContributions(scene));
      const next: IsoDoc = { ...docRef.current, body: scene };
      if (Object.keys(requires).length) next.requires = requires;
      else delete next.requires;
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

  const placeItem = useCallback(
    (kind: string, itemId: string) => {
      if (kind !== HOLODECK_KINDS.isoPart) return;
      try {
        const { scene, id } = addPart(docRef.current.body, host.registry, itemId);
        commitScene(scene);
        setSelectedId(id);
      } catch (error) {
        notify({ tone: 'error', title: 'Could not place the component', details: [messageOf(error)] });
      }
    },
    [commitScene, host],
  );

  // Publish this document's commands to the shell (library, header, hotkeys).
  useEffect(() => {
    activeDocumentStore.setState(() => ({
      id: initial.document.id,
      placeItem,
      exportFile: () => downloadDocument(docRef.current),
      save: async () => {
        // Re-save the working copy (a retry after a failure), then report the real outcome.
        if (writer.getState().status.kind !== 'conflict') void writer.save(docRef.current);
        return writer.flush();
      },
    }));
    return () => activeDocumentStore.setState((current) => (current?.id === initial.document.id ? null : current));
  }, [initial.document.id, placeItem, writer]);

  const onPatch = useCallback(
    (id: string, patch: Partial<Omit<IsoPlacement, 'id' | 'object'>>) => commitScene(updatePlacement(docRef.current.body, id, patch)),
    [commitScene],
  );
  const onDeleteObject = useCallback(
    (id: string) => {
      commitScene(removePlacement(docRef.current.body, id));
      setSelectedId(null);
    },
    [commitScene],
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

  const conflict = writerState.status.kind === 'conflict' ? writerState.status : null;

  // TODO(holodeck#100, lane E2): persist the camera per document. The
  // store side is done (DocumentStore.getCamera / saveCamera, `views` object
  // store), but ProcessEditor keeps zoom / target / pose in private state
  // with no props to read or restore them. Needs `camera` + `onCameraChange`
  // props on ProcessEditor (packages/editor-2.5d-react, owned by lane E2).
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
          />
        </CanvasErrorBoundary>
      </main>
      {inspectorOpen ? (
        <SidePanel side="right" storageKey={INSPECTOR_WIDTH_KEY} bounds={INSPECTOR_BOUNDS} label="Inspector" testId="inspector-panel">
          <Inspector
            doc={doc}
            selectedId={selectedId}
            onRename={onRename}
            onPatch={onPatch}
            onDeleteObject={onDeleteObject}
            onDeleteDocument={() => {
              leaving.current = true;
              void deleteDocument(doc.id, { navigateAway: true });
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
