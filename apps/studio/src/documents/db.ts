/**
 * The studio's IndexedDB schema (via `idb`, a thin promise wrapper over the
 * raw IndexedDB API).
 *
 *   documents  key: document id  value: StoredDocument (the envelope + timestamps)
 *   views      key: document id  value: StoredView (per-device view state: camera)
 *
 * View state is kept apart from the document on purpose: it is not part of
 * the `holodeck.document.v1` envelope, is never exported, and changes far more
 * often (every pan or zoom) than the content.
 *
 * Bump STUDIO_DB_VERSION and extend `upgrade` for schema changes; never edit a
 * shipped upgrade step (users may be on any older version).
 */

import type { HolodeckDocument } from '@holodeck/sdk';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const STUDIO_DB_NAME = 'holodeck-studio';
export const STUDIO_DB_VERSION = 1;

export interface StoredDocument {
  id: string;
  document: HolodeckDocument;
  /**
   * Optimistic-concurrency counter: 1 on create, +1 on every write. A save
   * names the revision its copy was based on; a mismatch is a conflict
   * (DocumentStore.save). Not part of the exported envelope.
   */
  revision: number;
  /** ms since epoch. */
  createdAt: number;
  /** ms since epoch; the document list sorts by it, newest first. */
  updatedAt: number;
}

/**
 * Camera of one document's canvas, the editor's `EditorCamera` shape
 * (@holodeck/editor-2.5d-react, kept structurally here so the store does not
 * depend on the engine): orthographic `zoom`, look-at `target`, view `yaw`
 * in radians and the 2D `topDown` toggle.
 */
export interface StudioCamera {
  zoom: number;
  target: [number, number, number];
  yaw?: number;
  topDown?: boolean;
}

export interface StoredView {
  id: string;
  camera?: StudioCamera;
  updatedAt: number;
}

export interface StudioDbSchema extends DBSchema {
  documents: { key: string; value: StoredDocument; indexes: { updatedAt: number } };
  views: { key: string; value: StoredView };
}

export type StudioDb = IDBPDatabase<StudioDbSchema>;

export function openStudioDb(name = STUDIO_DB_NAME): Promise<StudioDb> {
  return openDB<StudioDbSchema>(name, STUDIO_DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const documents = db.createObjectStore('documents', { keyPath: 'id' });
        documents.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('views', { keyPath: 'id' });
      }
    },
  });
}
