import { HOLODECK_KINDS, type HolodeckDocument } from '@holodeck/sdk';
import { ISO_ENGINE_ID, ProcessEditor, type IsoPlacement, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { useSelector } from '@tanstack/react-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addPart, removePlacement, updatePlacement, usedIsoContributions } from '../documents/iso-scene';
import { useDocument, useRenameDocument, useSaveDocument } from '../documents/queries';
import { withDocumentName } from '../documents/document-ops';
import { INSPECTOR_BOUNDS, INSPECTOR_WIDTH_KEY } from '../layout/panel-width.logic';
import { SidePanel } from '../layout/SidePanel';
import { notify, panelStore } from '../layout/ui-state';
import { requiresFor } from '../host/studio-host';
import { useStudio } from '../studio-context';
import { activeDocumentStore } from './active-document';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { downloadDocument } from './file-io';
import { Inspector } from './Inspector';
import { useStudioActions } from './use-studio-actions';

type IsoDoc = HolodeckDocument<IsoSceneFile>;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Route component for `/d/$docId`: loads the document, then hands it to the editor. */
export function DocumentRoute({ docId }: { docId: string }) {
  const { data, isPending, error } = useDocument(docId);
  if (isPending) return <CenteredMessage>Loading document…</CenteredMessage>;
  if (error) return <CenteredMessage tone="error">Could not open the document: {error.message}</CenteredMessage>;
  if (!data) return <CenteredMessage>This document does not exist (it may have been deleted).</CenteredMessage>;
  if (data.engine !== ISO_ENGINE_ID) return <CenteredMessage>No editor for engine “{data.engine}” yet.</CenteredMessage>;
  // key: a different document gets fresh editor state (selection, working copy).
  return <DocumentWorkspace key={data.id} initial={data as IsoDoc} />;
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
 * committed change is written to IndexedDB straight away (writes are
 * serialised by IndexedDB's transaction order, so the last edit wins).
 */
function DocumentWorkspace({ initial }: { initial: IsoDoc }) {
  const { host } = useStudio();
  const [doc, setDoc] = useState<IsoDoc>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `mutate` is stable across renders; the mutation result object is not.
  // Depending on the result object re-created `placeItem` on every render and,
  // through the activeDocumentStore effect below, re-rendered the shell in an
  // endless loop (the page froze as soon as a document was open).
  const { mutate: saveDocument } = useSaveDocument();
  const { mutate: renameDocument } = useRenameDocument();
  const { deleteDocument } = useStudioActions();
  const inspectorOpen = useSelector(panelStore, (s) => s.inspectorOpen);
  const docRef = useRef(doc);
  docRef.current = doc;

  /** Apply a new body: recompute `requires`, update the working copy, persist. */
  const commitScene = useCallback(
    (scene: IsoSceneFile) => {
      const requires = requiresFor(host, usedIsoContributions(scene));
      const next: IsoDoc = { ...docRef.current, body: scene };
      if (Object.keys(requires).length) next.requires = requires;
      else delete next.requires;
      docRef.current = next;
      setDoc(next);
      saveDocument(next, {
        onError: (error) => notify({ tone: 'error', title: 'Could not save the document', details: [messageOf(error)] }),
      });
    },
    [host, saveDocument],
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
      id: initial.id,
      placeItem,
      exportFile: () => downloadDocument(docRef.current),
    }));
    return () => activeDocumentStore.setState((current) => (current?.id === initial.id ? null : current));
  }, [initial.id, placeItem]);

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
      // Optimistic: the canvas body name follows immediately.
      const next = withDocumentName(docRef.current, name);
      docRef.current = next;
      setDoc(next);
      renameDocument(
        { id: next.id, name },
        { onError: (error) => notify({ tone: 'error', title: 'Could not rename the document', details: [messageOf(error)] }) },
      );
    },
    [renameDocument],
  );

  // TODO(holodeck#16 follow-up, E2): persist the camera per document. The
  // store side is done (DocumentStore.getCamera / saveCamera, `views` object
  // store), but ProcessEditor keeps zoom / target / pose in private state
  // with no props to read or restore them. Needs `camera` + `onCameraChange`
  // props on ProcessEditor (packages/editor-2.5d-react, owned by lane E2).
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative min-h-0 min-w-0 flex-1" aria-label="Canvas" data-testid="canvas" data-document-id={doc.id}>
        <CanvasErrorBoundary resetKey={doc.id}>
          <ProcessEditor
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
            onDeleteDocument={() => void deleteDocument(doc.id, { navigateAway: true })}
          />
        </SidePanel>
      ) : null}
    </div>
  );
}
