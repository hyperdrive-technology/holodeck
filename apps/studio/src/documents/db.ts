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
  /** ms since epoch. */
  createdAt: number;
  /** ms since epoch; the document list sorts by it, newest first. */
  updatedAt: number;
}

/**
 * Camera of one document's canvas. `zoom` is the orthographic zoom; `target`
 * the world point the camera looks at; `yaw` the quarter-turn index of the
 * isometric pose (0–3) and `topDown` the 2D toggle.
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
