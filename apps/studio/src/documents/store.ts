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
import { metadataProblems, stampDocument, withDocumentName } from './document-ops';

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

/**
 * A write based on `expectedRevision` found the stored document at another
 * revision (another tab saved first), or deleted (`latest` undefined).
 * Nothing was written; the caller decides what to keep.
 */
export class DocumentConflictError extends Error {
  constructor(
    public readonly id: string,
    public readonly expectedRevision: number,
    public readonly latest: VersionedDocument | undefined,
  ) {
    super(
      latest
        ? `document "${id}" changed elsewhere (revision ${latest.revision}, this copy is based on ${expectedRevision})`
        : `document "${id}" was deleted elsewhere`,
    );
    this.name = 'DocumentConflictError';
  }
}

export class DocumentExistsError extends Error {
  constructor(public readonly id: string) {
    super(`a document with id "${id}" already exists`);
    this.name = 'DocumentExistsError';
  }
}

/** A stored document and its revision (1 on create, +1 on every write). */
export interface VersionedDocument {
  document: HolodeckDocument;
  revision: number;
}

/** Posted after every committed write, e.g. to a BroadcastChannel so other tabs can refresh. */
export type DocumentChange = { type: 'saved'; id: string; revision: number } | { type: 'deleted'; id: string };

export interface DocumentStoreOptions {
  /** Called after a write commits. */
  onChange?: (change: DocumentChange) => void;
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
  if (camera.yaw !== undefined && !Number.isFinite(camera.yaw)) {
    problems.push('camera.yaw: must be a finite number (radians)');
  }
  if (camera.topDown !== undefined && typeof camera.topDown !== 'boolean') problems.push('camera.topDown: must be a boolean');
  return problems;
}

/** Records written before revisions existed count as revision 0. */
const revisionOf = (record: StoredDocument) => record.revision ?? 0;
const versioned = (record: StoredDocument): VersionedDocument => ({ document: record.document, revision: revisionOf(record) });

function summarize(record: StoredDocument): DocumentSummary {
  const { id, document, createdAt, updatedAt } = record;
  return { id, name: document.name, engine: document.engine, createdAt, updatedAt };
}

export class DocumentStore {
  private readonly db: Promise<StudioDb>;
  private readonly validateExtra: (doc: HolodeckDocument) => readonly string[];
  private readonly now: () => number;
  private readonly onChange: ((change: DocumentChange) => void) | undefined;

  constructor(db: StudioDb | Promise<StudioDb>, options: DocumentStoreOptions = {}) {
    this.db = Promise.resolve(db);
    this.validateExtra = options.validate ?? (() => []);
    this.now = options.now ?? Date.now;
    this.onChange = options.onChange;
  }

  /** Every problem that would stop `doc` from being saved; empty = valid. */
  problems(doc: unknown): string[] {
    const envelope = validateHolodeckDocument(doc);
    // The host check assumes a well-formed envelope.
    if (envelope.length) return envelope;
    return [...metadataProblems(doc as HolodeckDocument), ...this.validateExtra(doc as HolodeckDocument)];
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

  /** A document and its revision; `undefined` if there is none. */
  async get(id: string): Promise<VersionedDocument | undefined> {
    const db = await this.db;
    const record = await db.get('documents', id);
    return record ? versioned(record) : undefined;
  }

  async has(id: string): Promise<boolean> {
    const db = await this.db;
    return (await db.getKey('documents', id)) !== undefined;
  }

  /** Add a new document at revision 1; throws `DocumentExistsError` if the id is taken. */
  async create(doc: HolodeckDocument): Promise<VersionedDocument> {
    return this.write(doc.id, 'create', () => doc);
  }

  /**
   * Replace a document with `doc`, but only if the stored revision is still
   * `expectedRevision` (the one the caller's copy was based on). Otherwise
   * throws `DocumentConflictError` carrying the latest stored version, and
   * nothing is written. Keeps the original `createdAt`.
   */
  async save(doc: HolodeckDocument, expectedRevision: number): Promise<VersionedDocument> {
    return this.write(doc.id, 'update', () => doc, expectedRevision);
  }

  /**
   * Rename inside one transaction: the name is applied to the document as
   * stored at that moment (read-modify-write), never to a copy read earlier,
   * so a concurrent save is never undone. With `expectedRevision`, a newer
   * stored revision is a conflict, like `save`.
   */
  async rename(id: string, name: string, expectedRevision?: number): Promise<VersionedDocument> {
    const trimmed = name.trim();
    if (!trimmed) throw new DocumentValidationError(['name: must not be empty']);
    return this.write(id, 'update', (current) => withDocumentName(current!, trimmed), expectedRevision);
  }

  /** Delete a document and its view state. Deleting a missing id is a no-op. */
  async remove(id: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['documents', 'views'], 'readwrite');
    await Promise.all([tx.objectStore('documents').delete(id), tx.objectStore('views').delete(id), tx.done]);
    this.onChange?.({ type: 'deleted', id });
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

  /**
   * The one write path. Everything between reading the current record and
   * putting the new one happens in a single IndexedDB readwrite transaction,
   * which IndexedDB runs exclusively for the `documents` store: no other
   * write (from this tab or another) can land in between. `next` and the
   * validation are synchronous on purpose: awaiting anything that is not an
   * IndexedDB request inside the transaction would let it auto-commit.
   */
  private async write(
    id: string,
    mode: 'create' | 'update',
    next: (current: HolodeckDocument | undefined) => HolodeckDocument,
    expectedRevision?: number,
  ): Promise<VersionedDocument> {
    const db = await this.db;
    const tx = db.transaction('documents', 'readwrite');
    const fail = async (error: Error): Promise<never> => {
      tx.abort();
      // `tx.done` rejects with AbortError once aborted; swallow it, report ours.
      await tx.done.catch(() => undefined);
      throw error;
    };
    const existing = await tx.store.get(id);
    if (mode === 'create' && existing) return fail(new DocumentExistsError(id));
    if (mode === 'update') {
      if (!existing) {
        return fail(expectedRevision === undefined ? new DocumentNotFoundError(id) : new DocumentConflictError(id, expectedRevision, undefined));
      }
      if (expectedRevision !== undefined && revisionOf(existing) !== expectedRevision) {
        return fail(new DocumentConflictError(id, expectedRevision, versioned(existing)));
      }
    }
    const at = this.now();
    let stamped: HolodeckDocument;
    try {
      stamped = stampDocument(next(existing?.document), new Date(at));
      if (stamped.id !== id) throw new DocumentValidationError([`id: cannot change from "${id}" to "${stamped.id}"`]);
      const problems = this.problems(stamped);
      if (problems.length) throw new DocumentValidationError(problems);
    } catch (error) {
      return fail(error instanceof Error ? error : new Error(String(error)));
    }
    // structuredClone: IndexedDB clones anyway, but cloning first means a
    // non-cloneable value (a function smuggled into a body) fails here with a
    // clear error, and later mutation of the caller's object cannot leak in.
    const record: StoredDocument = {
      id,
      document: structuredClone(stamped),
      revision: existing ? revisionOf(existing) + 1 : 1,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    };
    try {
      await tx.store.put(record);
      await tx.done;
    } catch (error) {
      // A failed put (QuotaExceededError …) aborts the transaction, so
      // `tx.done` rejects too; it was never awaited on this path and surfaced
      // as an unhandled rejection (holodeck#117). Settle it, report the put.
      await tx.done.catch(() => undefined);
      throw error;
    }
    this.onChange?.({ type: 'saved', id, revision: record.revision });
    return { document: stamped, revision: record.revision };
  }
}
