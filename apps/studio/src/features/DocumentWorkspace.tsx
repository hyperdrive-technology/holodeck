import { ISO_ENGINE_ID, ProcessEditor } from '@holodeck/editor-2.5d-react';
import { useNavigate } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioCamera } from '../documents/db';
import { useDocument, useDocumentCamera } from '../documents/queries';
import type { VersionedDocument } from '../documents/store';
import { INSPECTOR_BOUNDS, INSPECTOR_WIDTH_KEY } from '../layout/panel-width.logic';
import { SidePanel } from '../layout/SidePanel';
import { panelStore } from '../layout/ui-state';
import { useStudio } from '../studio-context';
import { LiveValues } from './LiveValues';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { CenteredMessage } from './CenteredMessage';
import { ConflictDialog } from './ConflictDialog';
import { ConnectionsPanel } from './connections/ConnectionsPanel';
import { Inspector } from './Inspector';
import { useDocumentSession } from './use-document-session';
import { useStudioActions } from './use-studio-actions';

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

/**
 * The open document: canvas + inspector. The working copy, its writer and
 * every command live in `useDocumentSession` (shared with the playground).
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
  const { host, secrets } = useStudio();
  const { deleteDocument, openDocument } = useStudioActions();
  const navigate = useNavigate();
  const inspectorOpen = useSelector(panelStore, (s) => s.inspectorOpen);
  const canvasHostRef = useRef<HTMLElement>(null);
  const session = useDocumentSession({ initial, initialCamera, canvasHostRef });
  const { doc, writer, writerState, live, leaving, conflict } = session;

  // Deleted elsewhere: a clean workspace just closes; one with unsaved,
  // failed or pending edits enters the "deleted elsewhere" conflict so the
  // user can save their version as a copy or discard it.
  useEffect(() => {
    if (!deletedElsewhere) return;
    if (leaving.current || writer.isClean()) onReleased();
    else writer.markDeleted();
  }, [deletedElsewhere, leaving, onReleased, writer]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main
        ref={canvasHostRef}
        className="relative min-h-0 min-w-0 flex-1"
        aria-label="Canvas"
        data-testid="canvas"
        data-document-id={doc.id}
        data-save-status={writerState.status.kind}
        data-revision={writerState.revision}
        data-dirty={writerState.dirty ? 'true' : 'false'}
        data-editor-epoch={session.editorEpoch}
        data-placing={session.placing ?? ''}
      >
        <CanvasErrorBoundary resetKey={doc.id}>
          <ProcessEditor key={session.editorKey} {...session.editorProps} mode="edit" chrome="canvas" metrics={live.metrics} />
        </CanvasErrorBoundary>
        <LiveValues metrics={live.metrics} />
      </main>
      {inspectorOpen ? (
        <SidePanel side="right" storageKey={INSPECTOR_WIDTH_KEY} bounds={INSPECTOR_BOUNDS} label="Inspector" testId="inspector-panel">
          <Inspector
            doc={doc}
            selectedId={session.selectedId}
            onRename={session.onRename}
            onEdit={session.onEdit}
            onDeleteObject={session.onDeleteObject}
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
                  onSave={session.saveConnection}
                  onRemove={session.removeConnection}
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
            session.adopt(latest);
            session.setSelectedId(null);
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
