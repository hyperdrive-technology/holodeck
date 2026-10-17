import { HOLODECK_DOCUMENT_FORMAT, type HolodeckDocument } from '@holodeck/sdk';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { openStudioDb, STUDIO_DB_VERSION, type StudioDb } from './db';
import { createIsoDocument } from './new-document';
import { DocumentExistsError, DocumentNotFoundError, DocumentStore, DocumentValidationError } from './store';

let db: StudioDb;
let clock: number;
const now = () => clock;

beforeEach(async () => {
  // A fresh in-memory IndexedDB per test: no state leaks between tests.
  globalThis.indexedDB = new IDBFactory();
  db = await openStudioDb('test');
  clock = 1_000;
});

function makeStore(validate?: (doc: HolodeckDocument) => string[]) {
  return new DocumentStore(db, { now, validate });
}

describe('DocumentStore', () => {
  it('opens the current schema version with both stores', () => {
    expect(db.version).toBe(STUDIO_DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['documents', 'views']);
  });

  it('creates and reads back a document, stamping metadata', async () => {
    const store = makeStore();
    const doc = createIsoDocument('Plant', 'doc-1');
    const saved = await store.create(doc);
    expect(saved.metadata?.created).toBe(new Date(1_000).toISOString());
    expect(saved.metadata?.updated).toBe(new Date(1_000).toISOString());
    const read = await store.get('doc-1');
    expect(read).toEqual(saved);
    expect(read?.format).toBe(HOLODECK_DOCUMENT_FORMAT);
  });

  it('returns undefined for a missing document', async () => {
    expect(await makeStore().get('nope')).toBeUndefined();
    expect(await makeStore().has('nope')).toBe(false);
  });

  it('refuses to create over an existing id and leaves the original intact', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('First', 'same'));
    await expect(store.create(createIsoDocument('Second', 'same'))).rejects.toBeInstanceOf(DocumentExistsError);
    expect((await store.get('same'))?.name).toBe('First');
  });

  it('save upserts and keeps createdAt while bumping updatedAt', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('A', 'a'));
    clock = 5_000;
    await store.save({ ...createIsoDocument('A2', 'a') });
    const [summary] = await store.list();
    expect(summary).toMatchObject({ id: 'a', name: 'A2', createdAt: 1_000, updatedAt: 5_000 });
  });

  it('keeps metadata.created from the document across saves', async () => {
    const store = makeStore();
    const first = await store.create(createIsoDocument('A', 'a'));
    clock = 9_000;
    const second = await store.save(first);
    expect(second.metadata?.created).toBe(new Date(1_000).toISOString());
    expect(second.metadata?.updated).toBe(new Date(9_000).toISOString());
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

  it('rejects an invalid envelope with every problem', async () => {
    const store = makeStore();
    const bad = { ...createIsoDocument('X', 'x'), engine: 'not a dotted id', format: 'nope' } as unknown as HolodeckDocument;
    const error = await store.save(bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentValidationError);
    expect((error as DocumentValidationError).problems).toEqual(
      expect.arrayContaining([expect.stringContaining('format'), expect.stringContaining('engine')]),
    );
    expect(await store.list()).toEqual([]);
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
    (doc.body as { objects: unknown[] }).objects.push({ id: 'x' });
    expect(((await store.get('a'))?.body as { objects: unknown[] }).objects).toEqual([]);
  });

  it('renames the envelope and the body name, trimming whitespace', async () => {
    const store = makeStore();
    await store.create(createIsoDocument('A', 'a'));
    const renamed = await store.rename('a', '  Brewhouse  ');
    expect(renamed.name).toBe('Brewhouse');
    expect((renamed.body as { name: string }).name).toBe('Brewhouse');
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
      expect((await makeStore().get('a'))?.name).toBe('A');
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
      [{ zoom: 10, target: [0, 0, 0], yaw: 4 }, 'yaw'],
      [{ zoom: 10, target: [0, 0, 0], topDown: 'yes' }, 'topDown'],
    ])('rejects an invalid camera %j', async (camera, field) => {
      const store = makeStore();
      await store.create(createIsoDocument('A', 'a'));
      // Casting: these are deliberately ill-typed inputs.
      await expect(store.saveCamera('a', camera as never)).rejects.toThrow(field);
    });
  });
});
