/**
 * `/playground`: one page to build a scene and watch it run.
 *
 *   Edit tab    library (click or drag onto the canvas), canvas in edit mode,
 *               inspector (object params, bindings, the Connections tab)
 *   Viewer tab  the same canvas in run mode, connection status, live values
 *
 * One persistent document (`PLAYGROUND_DOCUMENT_ID`) in the studio store,
 * created from the starter on first use and autosaved like any document. The
 * canvas stays mounted across tabs (only its `mode` changes), so switching
 * tabs keeps unsaved edits, the selection and the undo history.
 */

import { ISO_ENGINE_ID, ProcessEditor, type IsoMetrics } from '@holodeck/editor-2.5d-react';
import { useQuery } from '@tanstack/react-query';
import { EyeIcon, PencilRulerIcon, Redo2Icon, RotateCcwIcon, Undo2Icon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { StudioCamera } from '../documents/db';
import { useDocumentCamera } from '../documents/queries';
import type { VersionedDocument } from '../documents/store';
import type { SaveStatus } from '../documents/writer';
import { INSPECTOR_BOUNDS, INSPECTOR_WIDTH_KEY, SIDEBAR_BOUNDS, SIDEBAR_WIDTH_KEY } from '../layout/panel-width.logic';
import { SidePanel } from '../layout/SidePanel';
import { notify } from '../layout/ui-state';
import { useStudio } from '../studio-context';
import { CanvasErrorBoundary } from '../features/CanvasErrorBoundary';
import { CenteredMessage } from '../features/CenteredMessage';
import { ConflictDialog } from '../features/ConflictDialog';
import { ConnectionsPanel } from '../features/connections/ConnectionsPanel';
import { Inspector } from '../features/Inspector';
import { LibraryPanel } from '../features/LibraryPanel';
import { LiveValues } from '../features/LiveValues';
import { Notices } from '../features/Notices';
import { useDocumentSession } from '../features/use-document-session';
import { ensurePlaygroundDocument, PLAYGROUND_TABS, playgroundStarter, type PlaygroundTab } from './playground-state';
import { PLAYGROUND_DOCUMENT_ID } from './starter';
import { connectionProblems, ViewerPanel } from './ViewerPanel';

export const playgroundKeys = { document: ['playground', 'document'] as const };

export interface PlaygroundRouteProps {
  tab: PlaygroundTab;
  onTabChange: (tab: PlaygroundTab) => void;
}

/** Loads (or creates) the playground document and its camera, then opens the workspace. */
export function PlaygroundRoute({ tab, onTabChange }: PlaygroundRouteProps) {
  const { store, host, channel } = useStudio();
  const loaded = useQuery({
    queryKey: playgroundKeys.document,
    queryFn: () => ensurePlaygroundDocument(store, host),
    // Re-read on every visit: another tab may have saved since (holodeck#117).
    refetchOnMount: 'always',
  });
  const camera = useDocumentCamera(PLAYGROUND_DOCUMENT_ID);
  // Opened once (from a read made after mount, with the camera known, as
  // DocumentRoute does); from then on the workspace owns the working copy.
  const [opened, setOpened] = useState<VersionedDocument | null>(null);
  /** Bumped when the document is recreated (deleted in another tab): a fresh workspace. */
  const [generation, setGeneration] = useState(0);
  if (!opened && loaded.data && loaded.isFetchedAfterMount && camera.isFetchedAfterMount) setOpened(loaded.data);

  // Deleted elsewhere (e.g. from the studio's document list): there is no
  // "no document" state on this page, so start again from the starter.
  useEffect(
    () =>
      channel.subscribe((change) => {
        if (change.type !== 'deleted' || change.id !== PLAYGROUND_DOCUMENT_ID) return;
        void ensurePlaygroundDocument(store, host).then(
          (fresh) => {
            setOpened(fresh);
            setGeneration((n) => n + 1);
            notify({ tone: 'info', title: 'The playground was deleted in another tab', details: ['It starts again from the starter scene.'] });
          },
          (error: unknown) => notify({ tone: 'error', title: 'Could not recreate the playground', details: [String(error)] }),
        );
      }),
    [channel, host, store],
  );

  let content: React.ReactNode;
  if (loaded.error && !opened) content = <CenteredMessage tone="error">Could not open the playground: {loaded.error.message}</CenteredMessage>;
  else if (!opened) content = <CenteredMessage>Loading the playground…</CenteredMessage>;
  else if (opened.document.engine !== ISO_ENGINE_ID) content = <CenteredMessage tone="error">The stored playground uses engine “{opened.document.engine}”: press Reset.</CenteredMessage>;
  else
    content = (
      <PlaygroundWorkspace
        key={generation}
        initial={opened}
        initialCamera={camera.isError ? undefined : (camera.data ?? undefined)}
        tab={tab}
        onTabChange={onTabChange}
      />
    );
  return (
    <div className="flex h-full flex-col">
      {content}
      <Notices />
    </div>
  );
}

const TAB_META: Record<PlaygroundTab, { label: string; icon: typeof EyeIcon; hint: string }> = {
  edit: { label: 'Edit', icon: PencilRulerIcon, hint: 'Build the scene: drag parts in, configure them, bind them to signals' },
  viewer: { label: 'Viewer', icon: EyeIcon, hint: 'Run the scene: objects follow the incoming data' },
};

const SAVE_TEXT: Record<SaveStatus['kind'], string> = { saved: 'Saved', saving: 'Saving…', error: 'Not saved', conflict: 'Not saved (changed in another tab)' };

function PlaygroundWorkspace({
  initial,
  initialCamera,
  tab,
  onTabChange,
}: {
  initial: VersionedDocument;
  initialCamera: StudioCamera | undefined;
} & PlaygroundRouteProps) {
  const { host, secrets } = useStudio();
  const canvasHostRef = useRef<HTMLElement>(null);
  const session = useDocumentSession({ initial, initialCamera, canvasHostRef });
  const { doc, writerState, live, conflict, editorRef } = session;
  const [resetOpen, setResetOpen] = useState(false);
  const viewing = tab === 'viewer';

  // Pause freezes what the Viewer shows (the providers keep running), so
  // resuming jumps straight to the current values.
  const [frozen, setFrozen] = useState<IsoMetrics | null>(null);
  const setPaused = useCallback((paused: boolean) => setFrozen(paused ? live.metrics : null), [live.metrics]);
  const metrics = viewing && frozen ? frozen : live.metrics;
  const connections = doc.connections ?? [];
  const problems = connectionProblems(connections, live.statuses);

  // Leaving the Viewer resumes the feed: a paused Edit canvas would look broken.
  useEffect(() => {
    if (!viewing) setFrozen(null);
  }, [viewing]);

  const tabKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    const i = PLAYGROUND_TABS.indexOf(tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = PLAYGROUND_TABS[(i + step + PLAYGROUND_TABS.length) % PLAYGROUND_TABS.length]!;
    onTabChange(next);
    document.getElementById(`playground-tab-${next}`)?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="playground" data-tab={tab}>
      <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <span className="px-1 text-sm font-semibold">Holodeck Playground</span>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <div role="tablist" aria-label="Playground" className="flex items-center gap-1">
          {PLAYGROUND_TABS.map((t) => {
            const { label, icon: Icon, hint } = TAB_META[t];
            return (
              <button
                key={t}
                id={`playground-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls="playground-canvas"
                tabIndex={tab === t ? 0 : -1}
                title={hint}
                data-testid={`playground-tab-${t}`}
                onClick={() => onTabChange(t)}
                onKeyDown={tabKeys}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent aria-selected:bg-primary aria-selected:text-primary-foreground [&_svg]:size-3.5"
              >
                <Icon aria-hidden /> {label}
              </button>
            );
          })}
        </div>
        {!viewing ? (
          <>
            <Separator orientation="vertical" className="mx-1 h-5!" />
            <Button variant="ghost" size="icon-sm" aria-label="Undo" title="Undo (Mod+Z)" onClick={() => editorRef.current?.dispatch({ type: 'undo' })}>
              <Undo2Icon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Redo" title="Redo (Mod+Shift+Z)" onClick={() => editorRef.current?.dispatch({ type: 'redo' })}>
              <Redo2Icon />
            </Button>
          </>
        ) : null}
        <div className="flex-1" />
        <span
          className={cn('px-2 text-xs', writerState.status.kind === 'error' || writerState.status.kind === 'conflict' ? 'text-destructive' : 'text-muted-foreground')}
          data-testid="playground-save-status"
          role="status"
        >
          {SAVE_TEXT[writerState.status.kind]}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)} title="Restore the starter scene, connection and bindings">
          <RotateCcwIcon /> Reset
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {!viewing ? (
          <SidePanel side="left" storageKey={SIDEBAR_WIDTH_KEY} bounds={SIDEBAR_BOUNDS} label="Library" testId="sidebar">
            <LibraryPanel />
          </SidePanel>
        ) : null}
        <main
          ref={canvasHostRef}
          id="playground-canvas"
          role="tabpanel"
          aria-labelledby={`playground-tab-${tab}`}
          className="relative min-h-0 min-w-0 flex-1"
          data-testid="canvas"
          data-document-id={doc.id}
          data-save-status={writerState.status.kind}
          data-revision={writerState.revision}
          data-dirty={writerState.dirty ? 'true' : 'false'}
          data-editor-epoch={session.editorEpoch}
          data-placing={session.placing ?? ''}
          data-mode={viewing ? 'run' : 'edit'}
        >
          <CanvasErrorBoundary resetKey={doc.id}>
            {/* Same element in both tabs (only `mode` changes): edits, selection and undo history survive a tab switch. */}
            <ProcessEditor key={session.editorKey} {...session.editorProps} mode={viewing ? 'run' : 'edit'} chrome="canvas" metrics={metrics} />
          </CanvasErrorBoundary>
          {viewing && problems.length ? (
            <div role="alert" data-testid="viewer-problems" className="absolute inset-x-3 top-3 z-10 rounded-md border border-destructive/40 bg-background/95 px-3 py-2 text-xs shadow-sm">
              {problems.map((p) => (
                <p key={p.id}>
                  <span className="font-medium text-destructive">{p.label}:</span> {p.message}. The objects it drives stay on their last values.
                </p>
              ))}
            </div>
          ) : null}
          {viewing && frozen ? (
            <span className="absolute bottom-3 left-3 z-10 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700" data-testid="viewer-paused">
              Paused
            </span>
          ) : null}
          {/* Screen-reader readings in the Edit tab; the Viewer shows them in its panel. */}
          {!viewing ? <LiveValues metrics={metrics} /> : null}
        </main>
        {viewing ? (
          <SidePanel side="right" storageKey={INSPECTOR_WIDTH_KEY} bounds={INSPECTOR_BOUNDS} label="Live data" testId="viewer-side">
            <ViewerPanel connections={connections} statuses={live.statuses} metrics={metrics} paused={frozen !== null} onPausedChange={setPaused} />
          </SidePanel>
        ) : (
          <SidePanel side="right" storageKey={INSPECTOR_WIDTH_KEY} bounds={INSPECTOR_BOUNDS} label="Inspector" testId="inspector-panel">
            <Inspector
              doc={doc}
              selectedId={session.selectedId}
              onRename={session.onRename}
              onEdit={session.onEdit}
              onDeleteObject={session.onDeleteObject}
              live={{
                metrics: live.metrics,
                statuses: live.statuses,
                hub: live.hub,
                connectionsPanel: (
                  <ConnectionsPanel host={host} doc={doc} statuses={live.statuses} secrets={secrets} onSave={session.saveConnection} onRemove={session.removeConnection} />
                ),
              }}
            />
          </SidePanel>
        )}
      </div>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent data-testid="reset-dialog">
          <DialogHeader>
            <DialogTitle>Reset the playground?</DialogTitle>
            <DialogDescription>
              The scene, its connections and bindings go back to the starter. Your changes and the undo history are discarded (export from the studio first
              to keep a copy).
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setResetOpen(false);
                setFrozen(null);
                session.replace(playgroundStarter(host));
              }}
            >
              Reset
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {conflict ? (
        <ConflictDialog
          name={doc.name}
          latest={conflict.latest}
          mine={doc}
          onLoadLatest={(latest) => {
            session.adopt(latest);
            session.setSelectedId(null);
          }}
          onSavedCopy={() => {
            // The copy is a normal studio document (listed on `/`); the
            // playground carries on with the other tab's version.
            if (conflict.latest) session.adopt(conflict.latest);
            notify({ tone: 'info', title: 'Your version was saved as a copy', details: ['Open it from the studio’s document list.'] });
          }}
          onDiscard={() => {
            // Deleted elsewhere while edits were pending: the route recreates the starter.
            session.leaving.current = true;
            session.replace(playgroundStarter(host));
          }}
        />
      ) : null}
    </div>
  );
}
