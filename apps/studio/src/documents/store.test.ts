import { HOLODECK_DOCUMENT_FORMAT, type HolodeckDocument } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudioDb, STUDIO_DB_VERSION, type StudioDb } from './db';
import { withDocumentId } from './document-ops';
import { createIsoDocument } from './new-document';
import {
  DocumentConflictError,
  DocumentExistsError,
  DocumentNotFoundError,
  DocumentStore,
  DocumentValidationError,
  type DocumentChange,
} from './store';

let db: StudioDb;
let clock: number;
const now = () => clock;

beforeEach(async () => {
  // A fresh in-memory IndexedDB per test: no state leaks between tests.
  globalThis.indexedDB = new IDBFactory();
  db = await openStudioDb('test');
  clock = 1_000;
});

function makeStore(validate?: (doc: HolodeckDocument) => string[], onChange?: (c: DocumentChange) => void) {
  return new DocumentStore(db, { now, validate, onChange });
}

type IsoDoc = HolodeckDocument<IsoSceneFile>;
const withObject = (doc: HolodeckDocument, id: string): IsoDoc => {
  const iso = doc as IsoDoc;
  return { ...iso, body: { ...iso.body, objects: [...iso.body.objects, { id, object: 'tank', x: 0, y: 0 }] } };
};
const objectIds = (doc: HolodeckDocument | undefined) => (doc as IsoDoc | undefined)?.body.objects.map((o) => o.id);

describe('DocumentStore', () => {
  it('opens the current schema version with both stores', () => {
    expect(db.version).toBe(STUDIO_DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['documents', 'views']);
  });

  it('creates at revision 1 and reads back, stamping metadata', async () => {
    const store = makeStore();
    const saved = await store.create(createIsoDocument('Plant', 'doc-1'));
    expect(saved.revision).toBe(1);
    expect(saved.document.metadata?.created).toBe(new Date(1_000).toISOString());
    expect(saved.document.metadata?.updated).toBe(new Date(1_000).toISOString());
    const read = await store.get('doc-1');
    expect(read).toEqual(saved);
    expect(read?.document.format).toBe(HOLODECK_DOCUMENT_FORMAT);
  });

  it('returns undefined for a missing document', async () => {
    expect(await makeStore().get('nope')).toBeUndefined();
    expect(await makeStore().has('nope')).toBe(false);
  });

  it('refuses to create over an existing id and leaves the original intact', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('First', 'same'));
    await expect(store.create(createIsoDocument('Second', 'same'))).rejects.toBeInstanceOf(DocumentExistsError);
    expect((await store.get('same'))?.document.name).toBe('First');
  });

  it('save bumps the revision, keeps createdAt and bumps updatedAt', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('A', 'a'));
    clock = 5_000;
    const saved = await store.save(createIsoDocument('A2', 'a'), 1);
    expect(saved.revision).toBe(2);
    const [summary] = await store.list();
    expect(summary).toMatchObject({ id: 'a', name: 'A2', createdAt: 1_000, updatedAt: 5_000 });
  });

  it('save of a missing document is a conflict (deleted elsewhere), with no latest version', async () => {
    const error = await makeStore().save(createIsoDocument('A', 'gone'), 3).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentConflictError);
    expect((error as DocumentConflictError).latest).toBeUndefined();
  });

  it('keeps metadata.created from the document across saves', async () => {
    const store = makeStore();
    const first = await store.create(createIsoDocument('A', 'a'));
    clock = 9_000;
    const second = await store.save(first.document, first.revision);
    expect(second.document.metadata?.created).toBe(new Date(1_000).toISOString());
    expect(second.document.metadata?.updated).toBe(new Date(9_000).toISOString());
  });

  it('lists newest first, ties broken by name', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('Old', 'old'));
    clock = 2_000;
    await store.create(createIsoDocument('Zed', 'z'));
    await store.create(createIsoDocument('Alpha', 'alpha'));
    clock = 3_000;
    await store.create(createIsoDocument('New', 'new'));
    expect((await store.list()).map((d) => d.id)).toEqual(['new', 'alpha', 'z', 'old']);
  });

  it('rejects an invalid envelope with every problem and writes nothing', async () => {
    const store = makeStore();
    const bad = { ...createIsoDocument('X', 'x'), engine: 'not a dotted id', format: 'nope' } as unknown as HolodeckDocument;
    const error = await store.create(bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentValidationError);
    expect((error as DocumentValidationError).problems).toEqual(
      expect.arrayContaining([expect.stringContaining('format'), expect.stringContaining('engine')]),
    );
    expect(await store.list()).toEqual([]);
  });

  it('rejects unparsable metadata timestamps (they would crash date formatting)', async () => {
    const store = makeStore();
    const doc = { ...createIsoDocument('X', 'x'), metadata: { created: 'c' } };
    await expect(store.create(doc)).rejects.toThrow('metadata.created');
    expect(await store.has('x')).toBe(false);
  });

  it('runs the host validator on well-formed envelopes only', async () => {
    const calls: string[] = [];
    const store = makeStore((doc) => {
      calls.push(doc.id);
      return doc.name === 'bad' ? ['body: nope'] : [];
    });
    await store.create(createIsoDocument('good', 'g'));
    await expect(store.create(createIsoDocument('bad', 'b'))).rejects.toThrow('body: nope');
    expect(store.problems({ format: 'x' })).not.toContain('body: nope');
    expect(calls).toEqual(['g', 'b']);
    expect((await store.list()).map((d) => d.id)).toEqual(['g']);
  });

  it('stores a copy: later mutation of the saved object does not leak in', async () => {
    const store = makeStore();
    const doc = createIsoDocument('A', 'a');
    await store.create(doc);
    doc.body.objects.push({ id: 'x', object: 'tank', x: 0, y: 0 });
    expect(objectIds((await store.get('a'))?.document)).toEqual([]);
  });

  // holodeck#117 (2): a rejected put left `tx.done` unawaited -> unhandled rejection.
  it('reports a failed put as the save error, with no unhandled rejection', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('A', 'a'));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      // What a quota failure looks like: the request fails and the transaction aborts.
      this.transaction.abort();
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      await expect(store.save(createIsoDocument('A2', 'a'), 1)).rejects.toThrow('quota');
      // Let any stray rejection surface.
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      put.mockRestore();
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect((await store.get('a'))?.document.name).toBe('A');
  });

  it('refuses a save that changes the id', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('A', 'a'));
    // save() keys by doc.id, so an id change is a different (missing) document.
    await expect(store.save(withDocumentId(createIsoDocument('A', 'a'), 'b'), 1)).rejects.toBeInstanceOf(DocumentConflictError);
  });

  it('renames the envelope and the body name, trimming whitespace', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('A', 'a'));
    const renamed = await store.rename('a', '  Brewhouse  ');
    expect(renamed.revision).toBe(2);
    expect(renamed.document.name).toBe('Brewhouse');
    expect((renamed.document.body as { name: string }).name).toBe('Brewhouse');
    await expect(store.rename('a', '   ')).rejects.toBeInstanceOf(DocumentValidationError);
    await expect(store.rename('missing', 'X')).rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it('removes a document and its view state; removing twice is fine', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('A', 'a'));
    await store.saveCamera('a', { zoom: 30, target: [1, 0, 2] });
    await store.remove('a');
    await store.remove('a');
    expect(await store.get('a')).toBeUndefined();
    expect(await store.getCamera('a')).toBeUndefined();
  });

  it('reports every committed change, and nothing for rejected writes', async () => {
    const changes: DocumentChange[] = [];
    const store = makeStore(undefined, (c) => changes.push(c));
    await store.create(createIsoDocument('A', 'a'));
    await store.save(createIsoDocument('A', 'a'), 1);
    await store.save(createIsoDocument('A', 'a'), 1).catch(() => undefined);
    await store.remove('a');
    expect(changes).toEqual([
      { type: 'saved', id: 'a', revision: 1 },
      { type: 'saved', id: 'a', revision: 2 },
      { type: 'deleted', id: 'a' },
    ]);
  });

  // GPT review of holodeck#102, finding 1 (holodeck#110): rename read the
  // document, then saved it in a second transaction, so a canvas save that
  // landed in between was overwritten with the old body.
  describe('rename racing a canvas save', () => {
    it.each(['rename first', 'save first'])('keeps both the new body and the new name (%s)', async (order) => {
      const store = makeStore();
      const { document, revision } = await store.create(createIsoDocument('A', 'a'));
      const save = () => store.save(withObject(document, 'tank-1'), revision);
      const rename = () => store.rename('a', 'Renamed');
      // Started in the same tick: IndexedDB orders the two transactions, neither waits for the other's result.
      await Promise.all(order === 'rename first' ? [rename(), save().catch(() => undefined)] : [save(), rename()]);
      const stored = await store.get('a');
      expect(stored?.document.name).toBe('Renamed');
      if (order === 'save first') expect(objectIds(stored?.document)).toEqual(['tank-1']);
      else {
        // The save was based on revision 1, the rename made it 2: a conflict, not a silent overwrite of the name.
        expect(stored?.revision).toBe(2);
      }
    });

    it('a rename never resurrects an older body', async () => {
      const store = makeStore();
      const first = await store.create(createIsoDocument('A', 'a'));
      // Interleave many saves and renames; every save is based on the latest revision it knows.
      let revision = first.revision;
      let doc: HolodeckDocument = first.document;
      for (let i = 1; i <= 5; i++) {
        const [saved] = await Promise.all([store.save(withObject(doc, `t${i}`), revision), store.rename('a', `Name ${i}`)]);
        const latest = (await store.get('a'))!;
        expect(objectIds(latest.document)).toEqual(objectIds(saved.document));
        revision = latest.revision;
        doc = latest.document;
      }
      const final = (await store.get('a'))!;
      expect(objectIds(final.document)).toEqual(['t1', 't2', 't3', 't4', 't5']);
      expect(final.document.name).toBe('Name 5');
    });
  });

  // GPT review of holodeck#102, finding 2: a stale second tab silently replaced newer edits.
  describe('two tabs (independent working copies)', () => {
    it('the stale save is a conflict carrying the latest version; both versions are recoverable', async () => {
      const store = makeStore();
      const base = await store.create(createIsoDocument('Plant', 'p'));
      // Both tabs loaded revision 1.
      const tabA = { doc: base.document, revision: base.revision };
      const tabB = { doc: base.document, revision: base.revision };

      const a = await store.save(withObject(tabA.doc, 'tank-1'), tabA.revision);
      expect(a.revision).toBe(2);

      const mine = withObject(tabB.doc, 'valve-1');
      const error = await store.save(mine, tabB.revision).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DocumentConflictError);
      const conflict = error as DocumentConflictError;
      expect(conflict.expectedRevision).toBe(1);
      expect(conflict.latest?.revision).toBe(2);
      expect(objectIds(conflict.latest?.document)).toEqual(['tank-1']);

      // Nothing was overwritten.
      expect(objectIds((await store.get('p'))?.document)).toEqual(['tank-1']);

      // Tab B keeps its version as a copy: both versions now exist.
      const copy = await store.create(withDocumentId(mine, 'p-copy'));
      expect(objectIds(copy.document)).toEqual(['valve-1']);
      expect(objectIds((await store.get('p'))?.document)).toEqual(['tank-1']);

      // Or tab B loads the latest and continues from it.
      const latest = conflict.latest!;
      const continued = await store.save(withObject(latest.document, 'valve-1'), latest.revision);
      expect(objectIds(continued.document)).toEqual(['tank-1', 'valve-1']);
    });

    it('a stale rename is a conflict too', async () => {
      const store = makeStore();
      const base = await store.create(createIsoDocument('Plant', 'p'));
      await store.save(withObject(base.document, 'tank-1'), base.revision);
      await expect(store.rename('p', 'Other', base.revision)).rejects.toBeInstanceOf(DocumentConflictError);
      expect((await store.get('p'))?.document.name).toBe('Plant');
    });
  });

  describe('camera', () => {
    it('persists per document', async () => {
      const store = makeStore();
      await store.create(createIsoDocument('A', 'a'));
      await store.create(createIsoDocument('B', 'b'));
      await store.saveCamera('a', { zoom: 30, target: [1, 0, 2], yaw: 1, topDown: false });
      await store.saveCamera('b', { zoom: 12, target: [0, 0, 0] });
      expect(await store.getCamera('a')).toEqual({ zoom: 30, target: [1, 0, 2], yaw: 1, topDown: false });
      expect(await store.getCamera('b')).toEqual({ zoom: 12, target: [0, 0, 0] });
    });

    it('survives reopening the database (a page reload)', async () => {
      const store = makeStore();
      await store.create(createIsoDocument('A', 'a'));
      await store.saveCamera('a', { zoom: 44, target: [3, 0, -1] });
      db.close();
      db = await openStudioDb('test');
      expect(await makeStore().getCamera('a')).toEqual({ zoom: 44, target: [3, 0, -1] });
      expect((await makeStore().get('a'))?.document.name).toBe('A');
    });

    it('ignores cameras for unknown documents', async () => {
      const store = makeStore();
      expect(await store.saveCamera('ghost', { zoom: 10, target: [0, 0, 0] })).toBe(false);
      expect(await store.getCamera('ghost')).toBeUndefined();
    });

    it.each([
      [{ zoom: 0, target: [0, 0, 0] }, 'zoom'],
      [{ zoom: Number.NaN, target: [0, 0, 0] }, 'zoom'],
      [{ zoom: 10, target: [0, 0] }, 'target'],
      [{ zoom: 10, target: [0, Infinity, 0] }, 'target'],
      [{ zoom: 10, target: [0, 0, 0], yaw: Number.NaN }, 'yaw'],
      [{ zoom: 10, target: [0, 0, 0], topDown: 'yes' }, 'topDown'],
    ])('rejects an invalid camera %j', async (camera, field) => {
      const store = makeStore();
      await store.create(createIsoDocument('A', 'a'));
      // Casting: these are deliberately ill-typed inputs.
      await expect(store.saveCamera('a', camera as never)).rejects.toThrow(field);
    });
  });
});
