/**
 * The open document's commands, published by the document route for UI that
 * lives outside it (library sidebar, header, hotkeys). `null` when no
 * document is open. One writer: the mounted <DocumentWorkspace />.
 */

import { Store } from '@tanstack/react-store';
import type { SaveStatus } from '../documents/writer';

export interface ActiveDocument {
  id: string;
  /** Place a library item into the document (and select it). */
  placeItem: (kind: string, itemId: string) => void;
  /** Download the document as a `.holodeck.json` file. */
  exportFile: () => void;
  /** Save the working copy now (retrying a failed autosave) and resolve with the real outcome. */
  save: () => Promise<SaveStatus>;
}

export const activeDocumentStore = new Store<ActiveDocument | null>(null);

/** UI-only flags shared by the shell and the hotkeys. */
export const shellStore = new Store<{ shortcutsOpen: boolean }>({ shortcutsOpen: false });
