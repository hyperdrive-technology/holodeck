import type { HolodeckDocument } from '@holodeck/sdk';
import { toIsoDocument, type IsoSceneFile } from '@holodeck/editor-2.5d-react';

export const DEFAULT_DOCUMENT_NAME = 'Untitled';

/** A fresh id for a document: a random UUID (unique across devices, so exported files never collide on import). */
export function newDocumentId(): string {
  return crypto.randomUUID();
}

/** An empty iso document in the shared envelope. */
export function createIsoDocument(name: string = DEFAULT_DOCUMENT_NAME, id: string = newDocumentId()): HolodeckDocument<IsoSceneFile> {
  const scene: IsoSceneFile = { id, name: name.trim() || DEFAULT_DOCUMENT_NAME, gridCellSize: 1, objects: [] };
  return toIsoDocument(scene);
}

/** `Untitled`, `Untitled 2`, `Untitled 3` … the first not in `taken`. */
export function nextUntitledName(taken: Iterable<string>, base: string = DEFAULT_DOCUMENT_NAME): string {
  const names = new Set(taken);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
