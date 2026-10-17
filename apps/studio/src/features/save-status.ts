import type { SaveStatus } from '../documents/writer';

/** User-facing text for a save outcome (Mod+S, autosave failures). Only `saved` claims success. */
export function describeSaveStatus(status: SaveStatus): { tone: 'info' | 'error'; title: string; details?: string[] } {
  switch (status.kind) {
    case 'saved':
      return { tone: 'info', title: 'All changes are saved in this browser' };
    case 'saving':
      return { tone: 'info', title: 'Saving…' };
    case 'error':
      return { tone: 'error', title: 'Saving failed', details: [status.message, 'Your changes are still open here; press Save to retry or export a copy.'] };
    case 'conflict':
      return { tone: 'error', title: 'Not saved: this document changed in another tab', details: ['Choose which version to keep.'] };
  }
}

