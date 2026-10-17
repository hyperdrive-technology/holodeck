import type { ContributionRegistry, HolodeckDocument } from '@holodeck/sdk';
import { isoComponentsCsv, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { COMPONENTS_FILE_SUFFIX, exportFileName, serializeDocument } from '../documents/io';

/** Trigger a browser download of `blob` as `name`. */
export function downloadBlob(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob);
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

/** Trigger a browser download of `doc` as pretty JSON (the `holodeck.document.v1` envelope). */
export function downloadDocument(doc: HolodeckDocument): string {
  return downloadBlob(new Blob([serializeDocument(doc)], { type: 'application/json' }), exportFileName(doc));
}

/** Trigger a browser download of the document's components table as CSV (formula-safe cells; see the engine's export/csv.ts). */
export function downloadComponentsCsv(doc: HolodeckDocument<IsoSceneFile>, registry: ContributionRegistry): string {
  const csv = isoComponentsCsv(doc.body, registry);
  return downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportFileName(doc, COMPONENTS_FILE_SUFFIX));
}

/** The id of the hidden file input every "Import" entry point clicks. */
export const IMPORT_INPUT_ID = 'studio-import-input';

export function openImportPicker() {
  document.getElementById(IMPORT_INPUT_ID)?.click();
}
