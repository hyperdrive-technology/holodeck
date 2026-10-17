/**
 * Document persistence for the studio: `holodeck.document.v1` envelopes in
 * IndexedDB, plus per-document view state (camera).
 *
 * The store validates every write with the SDK's `validateHolodeckDocument`
 * and, when given, a host-aware `validate` (engine body, installed parts), so
 * nothing invalid is ever persisted: a document the studio cannot open again
 * is worse than a failed save, which the UI can report.
 */

import { validateHolodeckDocument, type HolodeckDocument } from '@holodeck/sdk';
import type { StoredDocument, StoredView, StudioCamera, StudioDb } from './db';
import { stampDocument, withDocumentName } from './document-ops';

export interface DocumentSummary {
  id: string;
  name: string;
  engine: string;
  createdAt: number;
  updatedAt: number;
}

export class DocumentValidationError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`document is invalid:\n- ${problems.join('\n- ')}`);
    this.name = 'DocumentValidationError';
  }
}

export class DocumentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`no document with id "${id}"`);
    this.name = 'DocumentNotFoundError';
  }
}

export class DocumentExistsError extends Error {
  constructor(public readonly id: string) {
    super(`a document with id "${id}" already exists`);
    this.name = 'DocumentExistsError';
  }
}

export interface DocumentStoreOptions {
  /** Extra problems for a document (engine body, installed packages); empty = valid. */
  validate?: (doc: HolodeckDocument) => readonly string[];
  /** Clock, for tests. */
  now?: () => number;
}

function cameraProblems(camera: StudioCamera): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) problems.push('camera.zoom: must be a positive finite number');
  if (!Array.isArray(camera.target) || camera.target.length !== 3 || !camera.target.every(Number.isFinite)) {
    problems.push('camera.target: must be three finite numbers');
  }
  if (camera.yaw !== undefined && !(Number.isInteger(camera.yaw) && camera.yaw >= 0 && camera.yaw <= 3)) {
    problems.push('camera.yaw: must be an integer 0-3');
  }
  if (camera.topDown !== undefined && typeof camera.topDown !== 'boolean') problems.push('camera.topDown: must be a boolean');
  return problems;
}

function summarize(record: StoredDocument): DocumentSummary {
  const { id, document, createdAt, updatedAt } = record;
  return { id, name: document.name, engine: document.engine, createdAt, updatedAt };
}

export class DocumentStore {
  private readonly db: Promise<StudioDb>;
  private readonly validateExtra: (doc: HolodeckDocument) => readonly string[];
  private readonly now: () => number;

  constructor(db: StudioDb | Promise<StudioDb>, options: DocumentStoreOptions = {}) {
    this.db = Promise.resolve(db);
    this.validateExtra = options.validate ?? (() => []);
    this.now = options.now ?? Date.now;
  }

  /** Every problem that would stop `doc` from being saved; empty = valid. */
  problems(doc: unknown): string[] {
    const envelope = validateHolodeckDocument(doc);
    // The host check assumes a well-formed envelope.
    return envelope.length ? envelope : [...this.validateExtra(doc as HolodeckDocument)];
  }

  /** All documents, most recently updated first. */
  async list(): Promise<DocumentSummary[]> {
    const db = await this.db;
    const records = await db.getAllFromIndex('documents', 'updatedAt');
    // The index is ascending; ties (same ms) fall back to name for a stable order.
    return records
      .map(summarize)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<HolodeckDocument | undefined> {
    const db = await this.db;
    return (await db.get('documents', id))?.document;
  }

  async has(id: string): Promise<boolean> {
    const db = await this.db;
    return (await db.getKey('documents', id)) !== undefined;
  }

  /** Add a new document; throws `DocumentExistsError` if the id is taken. */
  async create(doc: HolodeckDocument): Promise<HolodeckDocument> {
    return this.write(doc, 'create');
  }

  /** Insert or replace a document (autosave). Keeps the original `createdAt`. */
  async save(doc: HolodeckDocument): Promise<HolodeckDocument> {
    return this.write(doc, 'save');
  }

  async rename(id: string, name: string): Promise<HolodeckDocument> {
    const trimmed = name.trim();
    if (!trimmed) throw new DocumentValidationError(['name: must not be empty']);
    const doc = await this.get(id);
    if (!doc) throw new DocumentNotFoundError(id);
    return this.save(withDocumentName(doc, trimmed));
  }

  /** Delete a document and its view state. Deleting a missing id is a no-op. */
  async remove(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['documents', 'views'], 'readwrite');
    await Promise.all([tx.objectStore('documents').delete(id), tx.objectStore('views').delete(id), tx.done]);
  }

  async getCamera(id: string): Promise<StudioCamera | undefined> {
    const db = await this.db;
    return (await db.get('views', id))?.camera;
  }

  /** Persist the camera of a stored document (ignored for unknown ids, e.g. after a delete raced it). */
  async saveCamera(id: string, camera: StudioCamera): Promise<boolean> {
    const problems = cameraProblems(camera);
    if (problems.length) throw new DocumentValidationError(problems);
    const db = await this.db;
    const tx = db.transaction(['documents', 'views'], 'readwrite');
    const exists = (await tx.objectStore('documents').getKey(id)) !== undefined;
    if (exists) {
      const view: StoredView = { id, camera: { ...camera, target: [...camera.target] }, updatedAt: this.now() };
      await tx.objectStore('views').put(view);
    }
    await tx.done;
    return exists;
  }

  private async write(doc: HolodeckDocument, mode: 'create' | 'save'): Promise<HolodeckDocument> {
    const at = this.now();
    const stamped = stampDocument(doc, new Date(at));
    const problems = this.problems(stamped);
    if (problems.length) throw new DocumentValidationError(problems);
    const db = await this.db;
    const tx = db.transaction('documents', 'readwrite');
    const existing = await tx.store.get(stamped.id);
    if (existing && mode === 'create') {
      tx.abort();
      // `tx.done` rejects with AbortError once aborted; swallow it, report ours.
      await tx.done.catch(() => undefined);
      throw new DocumentExistsError(stamped.id);
    }
    // structuredClone: IndexedDB clones anyway, but cloning first means a
    // non-cloneable value (a function smuggled into a body) fails here with a
    // clear error instead of inside the transaction.
    const record: StoredDocument = {
      id: stamped.id,
      document: structuredClone(stamped),
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    await tx.store.put(record);
    await tx.done;
    return stamped;
  }
}
