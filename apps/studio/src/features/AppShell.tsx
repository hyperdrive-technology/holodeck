import { formatForDisplay } from '@tanstack/react-hotkeys';
import { Outlet } from '@tanstack/react-router';
import { useSelector } from '@tanstack/react-store';
import { DownloadIcon, KeyboardIcon, PanelLeftIcon, PanelRightIcon, PlusIcon, UploadIcon } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { SIDEBAR_BOUNDS, SIDEBAR_WIDTH_KEY } from '../layout/panel-width.logic';
import { SidePanel } from '../layout/SidePanel';
import { panelStore, togglePanel } from '../layout/ui-state';
import { activeDocumentStore, shellStore } from './active-document';
import { DocumentList } from './DocumentList';
import { IMPORT_INPUT_ID, openImportPicker } from './file-io';
import { LibraryPanel } from './LibraryPanel';
import { Notices } from './Notices';
import { ShortcutsDialog } from './ShortcutsDialog';
import { StudioHotkeys } from './StudioHotkeys';
import { useStudioActions } from './use-studio-actions';

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/**
 * Root layout (T3 Code idiom): header, resizable left sidebar (documents +
 * library), the routed main area. The document route adds the canvas and the
 * resizable inspector on the right. Dropping `.json` files anywhere imports them.
 */
export function AppShell() {
  const sidebarOpen = useSelector(panelStore, (s) => s.sidebarOpen);
  const inspectorOpen = useSelector(panelStore, (s) => s.inspectorOpen);
  const active = useSelector(activeDocumentStore);
  const { newDocument, importFiles } = useStudioActions();
  const [dropping, setDropping] = useState(false);

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        void importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle sidebar"
          aria-pressed={sidebarOpen}
          title={`Toggle sidebar (${formatForDisplay('Mod+B')})`}
          onClick={() => togglePanel('sidebarOpen')}
        >
          <PanelLeftIcon />
        </Button>
        <span className="px-1 text-sm font-semibold">Holodeck Studio</span>
        <Separator orientation="vertical" className="mx-1 h-5!" />
        <Button variant="ghost" size="sm" onClick={() => void newDocument()} title={`New document (${formatForDisplay('Mod+Alt+N')})`}>
          <PlusIcon /> New
        </Button>
        <Button variant="ghost" size="sm" onClick={openImportPicker} title={`Import (${formatForDisplay('Mod+O')})`}>
          <UploadIcon /> Import
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!active}
          onClick={() => active?.exportFile()}
          title={`Export (${formatForDisplay('Mod+Shift+E')})`}
        >
          <DownloadIcon /> Export
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Keyboard shortcuts"
          title={`Keyboard shortcuts (${formatForDisplay('Mod+/')})`}
          onClick={() => shellStore.setState((s) => ({ ...s, shortcutsOpen: true }))}
        >
          <KeyboardIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Toggle inspector"
          aria-pressed={inspectorOpen}
          title={`Toggle inspector (${formatForDisplay('Mod+I')})`}
          onClick={() => togglePanel('inspectorOpen')}
        >
          <PanelRightIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <SidePanel side="left" storageKey={SIDEBAR_WIDTH_KEY} bounds={SIDEBAR_BOUNDS} label="Sidebar" testId="sidebar">
            <DocumentList />
            <LibraryPanel />
          </SidePanel>
        ) : null}
        <Outlet />
      </div>
      <input
        id={IMPORT_INPUT_ID}
        data-testid="import-input"
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          // Reset so picking the same file again still fires `change`.
          e.currentTarget.value = '';
          if (files.length) void importFiles(files);
        }}
      />
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-2 z-40 hidden items-center justify-center rounded-xl border-2 border-dashed border-ring bg-background/70 text-sm font-medium',
          dropping && 'flex',
        )}
      >
        Drop .holodeck.json files to import
      </div>
      <StudioHotkeys />
      <ShortcutsDialog />
      <Notices />
    </div>
  );
}
