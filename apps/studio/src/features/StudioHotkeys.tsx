import { useHotkeys } from '@tanstack/react-hotkeys';
import { flushSync } from 'react-dom';
import { notify, panelStore, togglePanel } from '../layout/ui-state';
import { STUDIO_SHORTCUTS, type StudioCommand } from '../shortcuts/shortcuts';
import { activeDocumentStore, shellStore } from './active-document';
import { openImportPicker } from './file-io';
import { describeSaveStatus } from './save-status';
import { LIBRARY_SEARCH_ID } from './LibraryPanel';
import { useStudioActions } from './use-studio-actions';

function focusLibrarySearch() {
  if (!panelStore.state.sidebarOpen) {
    // Render the sidebar now so its search box exists to focus.
    flushSync(() => togglePanel('sidebarOpen'));
  }
  const input = document.getElementById(LIBRARY_SEARCH_ID) as HTMLInputElement | null;
  input?.focus();
  input?.select();
}

/** Binds every `STUDIO_SHORTCUTS` entry (TanStack Hotkeys). Renders nothing. */
export function StudioHotkeys() {
  const { newDocument } = useStudioActions();
  const run: Record<StudioCommand, () => void> = {
    'document.new': () => void newDocument(),
    'document.import': openImportPicker,
    'document.export': () => activeDocumentStore.state?.exportFile(),
    'document.save': () => {
      const active = activeDocumentStore.state;
      if (!active) return;
      void active.save().then((status) => notify(describeSaveStatus(status)));
    },
    'library.search': focusLibrarySearch,
    'panel.sidebar': () => togglePanel('sidebarOpen'),
    'panel.inspector': () => togglePanel('inspectorOpen'),
    'help.shortcuts': () => shellStore.setState((s) => ({ ...s, shortcutsOpen: !s.shortcutsOpen })),
  };
  // Modifier chords fire in text fields too (Mod+K from the search box, Mod+S anywhere).
  useHotkeys(
    STUDIO_SHORTCUTS.map((s) => ({ hotkey: s.hotkey, callback: () => run[s.command]() })),
    { ignoreInputs: false },
  );
  return null;
}
