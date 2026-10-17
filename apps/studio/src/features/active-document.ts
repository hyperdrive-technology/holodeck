/**
 * The open document's commands, published by the document route for UI that
 * lives outside it (library sidebar, header, hotkeys). `null` when no
 * document is open. One writer: the mounted <DocumentWorkspace />.
 */

import type { ExportedImage } from '@holodeck/editor-2.5d-react';
import { Store } from '@tanstack/react-store';
import type { SaveStatus } from '../documents/writer';

export interface ActiveDocument {
  id: string;
  /** Display name (for dialogs and file names). */
  name: string;
  /** Part armed on the canvas place tool (the next floor click stamps it), or null. */
  placing: string | null;
  /** Arm (or, if already armed, disarm) the place tool for a library item. */
  armItem: (kind: string, itemId: string) => void;
  /** Add a library item next to the scene right away (one undoable editor step) and select it. */
  addItem: (kind: string, itemId: string) => void;
  /** Download the document as a `.holodeck.json` file. */
  exportFile: () => void;
  /** Download the components table as a `.components.csv` file. */
  exportComponents: () => void;
  /** Render the canvas at `scale` (tiled) and download it as PNG; resolves with the image and file name. */
  exportImage: (scale: number, signal?: AbortSignal) => Promise<ExportedImage & { name: string }>;
  /** Save the working copy now (retrying a failed autosave) and resolve with the real outcome. */
  save: () => Promise<SaveStatus>;
}

export const activeDocumentStore = new Store<ActiveDocument | null>(null);

/** UI-only flags shared by the shell and the hotkeys. */
export const shellStore = new Store<{ shortcutsOpen: boolean; exportOpen: boolean }>({ shortcutsOpen: false, exportOpen: false });
