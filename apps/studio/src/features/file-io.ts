import type { HolodeckDocument } from '@holodeck/sdk';
import { exportFileName, serializeDocument } from '../documents/io';

/** Trigger a browser download of `doc` as pretty JSON. */
export function downloadDocument(doc: HolodeckDocument): string {
  const name = exportFileName(doc);
  const url = URL.createObjectURL(new Blob([serializeDocument(doc)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled; the download keeps its own reference.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}

/** The id of the hidden file input every "Import" entry point clicks. */
export const IMPORT_INPUT_ID = 'studio-import-input';

export function openImportPicker() {
  document.getElementById(IMPORT_INPUT_ID)?.click();
}
