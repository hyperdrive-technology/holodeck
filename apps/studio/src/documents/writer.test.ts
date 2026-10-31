import type { HolodeckDocument } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudioDb } from './db';
import { createIsoDocument } from './new-document';
import { DocumentConflictError, DocumentStore, type VersionedDocument } from './store';
import { DocumentWriter } from './writer';

type IsoDoc = HolodeckDocument<IsoSceneFile>;
const withObject = (doc: HolodeckDocument, id: string): IsoDoc => {
  const iso = doc as IsoDoc;
  return { ...iso, body: { ...iso.body, objects: [...iso.body.objects, { id, object: 'tank', x: 0, y: 0 }] } };
};
const ids = (doc: HolodeckDocument | undefined) => (doc as IsoDoc | undefined)?.body.objects.map((o) => o.id);

let store: DocumentStore;
let base: VersionedDocument;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  store = new DocumentStore(openStudioDb('writer-test'));
  base = await store.create(createIsoDocument('Plant', 'p'));
});

describe('DocumentWriter', () => {
  it('serialises a rename and saves fired together: no self-conflict, nothing lost', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    const one = withObject(base.document, 'tank-1');
    const two = withObject(one, 'tank-2');
    // Same tick, like a canvas commit, an inspector rename and another canvas commit.
    void writer.save(one);
    void writer.rename('Brewhouse');
    void writer.save({ ...two, name: 'Brewhouse' });
    expect(writer.busy).toBe(true);
    expect(writer.getState().status.kind).toBe('saving');
    expect(await writer.flush()).toEqual({ kind: 'saved' });
    const stored = await store.get('p');
    expect(stored?.revision).toBe(4);
    expect(stored?.document.name).toBe('Brewhouse');
    expect(ids(stored?.document)).toEqual(['tank-1', 'tank-2']);
    expect(writer.getState().revision).toBe(4);
  });

  it('reports each committed version and notifies subscribers', async () => {
    const committed = vi.fn();
    const writer = new DocumentWriter(store, 'p', base.revision, committed);
    const listener = vi.fn();
    writer.subscribe(listener);
    await writer.save(withObject(base.document, 't'));
    expect(committed).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
    expect(listener).toHaveBeenCalled();
  });

  it('stops in conflict when another tab saved first, writes nothing more until a version is adopted', async () => {
    const tabA = new DocumentWriter(store, 'p', base.revision);
    const tabB = new DocumentWriter(store, 'p', base.revision);
    await tabA.save(withObject(base.document, 'tank-1'));

    expect(await tabB.save(withObject(base.document, 'valve-1'))).toBeUndefined();
    const status = tabB.getState().status;
    expect(status.kind).toBe('conflict');
    const latest = status.kind === 'conflict' ? status.latest : undefined;
    expect(ids(latest?.document)).toEqual(['tank-1']);

    // Blocked: later edits in tab B are not written over tab A's version.
    expect(await tabB.save(withObject(base.document, 'valve-2'))).toBeUndefined();
    expect(await tabB.rename('B name')).toBeUndefined();
    expect(ids((await store.get('p'))?.document)).toEqual(['tank-1']);

    // "Load latest": continue from tab A's version.
    tabB.adopt(latest!);
    const saved = await tabB.save(withObject(latest!.document, 'valve-1'));
    expect(ids(saved?.document)).toEqual(['tank-1', 'valve-1']);
    expect(tabB.getState().status.kind).toBe('saved');
  });

  it('keeps a failed write as an error until the next write succeeds (retry)', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    const save = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('QuotaExceededError'));
    expect(await writer.save(withObject(base.document, 't'))).toBeUndefined();
    expect(await writer.flush()).toEqual({ kind: 'error', message: 'QuotaExceededError' });
    // Retry (what Mod+S does): the same working copy saves now.
    const retried = await writer.save(withObject(base.document, 't'));
    expect(retried?.revision).toBe(2);
    expect(await writer.flush()).toEqual({ kind: 'saved' });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('reports a document deleted elsewhere as a conflict without a latest version', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    await store.remove('p');
    await writer.save(base.document);
    expect(writer.getState().status).toEqual({ kind: 'conflict', latest: undefined });
  });

  // Review of holodeck#102 @ 2b2a498: a successful rename after a failed body
  // save reported `saved`, so unsaved edits looked saved, could be replaced
  // by another tab's version, and Mod+S said everything was saved.
  describe('dirty body', () => {
    it('a failed body save stays unsaved through a successful rename', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('QuotaExceededError'));
      await writer.save(withObject(base.document, 'tank-1'));
      const renamed = await writer.rename('Brewhouse');
      expect(renamed?.revision).toBe(2);
      expect(writer.getState()).toMatchObject({ dirty: true, status: { kind: 'error', message: 'QuotaExceededError' } });
      expect(writer.isClean()).toBe(false);
      // The stored body never got the tank.
      expect(ids((await store.get('p'))?.document)).toEqual([]);
    });

    it('Mod+S semantics: re-saving reports the failure while the body cannot be saved, then clears it', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      const save = vi.spyOn(store, 'save');
      save.mockRejectedValueOnce(new Error('disk full')).mockRejectedValueOnce(new Error('disk full'));
      const working = withObject(base.document, 'tank-1');
      await writer.save(working);
      await writer.rename('Brewhouse');
      // Mod+S: save the working copy again and flush.
      void writer.save({ ...working, name: 'Brewhouse' });
      expect(await writer.flush()).toEqual({ kind: 'error', message: 'disk full' });
      void writer.save({ ...working, name: 'Brewhouse' });
      expect(await writer.flush()).toEqual({ kind: 'saved' });
      expect(writer.isClean()).toBe(true);
      expect(ids((await store.get('p'))?.document)).toEqual(['tank-1']);
    });

    it('only the latest body save clears dirty', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      const one = withObject(base.document, 'a');
      const save = vi.spyOn(store, 'save');
      // First save succeeds, the second (newer working copy) fails.
      save.mockImplementationOnce((doc, rev) => DocumentStore.prototype.save.call(store, doc, rev)).mockRejectedValueOnce(new Error('boom'));
      void writer.save(one);
      void writer.save(withObject(one, 'b'));
      expect(await writer.flush()).toMatchObject({ kind: 'error' });
      expect(writer.getState().dirty).toBe(true);
    });

    it('is clean only with nothing queued, unsaved, failed or in conflict', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      expect(writer.isClean()).toBe(true);
      const pending = writer.save(withObject(base.document, 'x'));
      expect(writer.isClean()).toBe(false);
      await pending;
      expect(writer.isClean()).toBe(true);
      // Another tab saves; this tab's next save conflicts and stays dirty.
      await store.save(withObject(base.document, 'other'), 2);
      await writer.save(withObject(base.document, 'mine'));
      expect(writer.getState()).toMatchObject({ dirty: true, status: { kind: 'conflict' } });
      expect(writer.isClean()).toBe(false);
      // Adopting the latest is an explicit choice: clean again.
      writer.adopt((await store.get('p'))!);
      expect(writer.isClean()).toBe(true);
    });
  });

  // holodeck#115: another tab deleted the document while this one had unsaved edits.
  describe('deleted elsewhere', () => {
    it('markDeleted blocks further writes and keeps the edits dirty for a copy', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk full'));
      await writer.save(withObject(base.document, 'tank-1'));
      await store.remove('p');
      writer.markDeleted();
      writer.markDeleted(); // idempotent: no extra notifications
      expect(writer.getState()).toMatchObject({ dirty: true, status: { kind: 'conflict', latest: undefined } });
      expect(await writer.save(withObject(base.document, 'tank-1'))).toBeUndefined();
      expect(await store.get('p')).toBeUndefined();
    });

    it('markDeleted notifies once', () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      const listener = vi.fn();
      writer.subscribe(listener);
      writer.markDeleted();
      writer.markDeleted();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // holodeck#118: Mod+S on a clean document wrote a new revision, so every
  // other open tab adopted (and remounted for) a no-op save.
  describe('persist (Mod+S)', () => {
    it('writes nothing when clean', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      const save = vi.spyOn(store, 'save');
      expect(await writer.persist(base.document)).toEqual({ kind: 'saved' });
      expect(save).not.toHaveBeenCalled();
      expect((await store.get('p'))?.revision).toBe(base.revision);
    });

    it('re-saves a working copy whose last save failed, and reports the outcome', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk full'));
      const working = withObject(base.document, 'tank-1');
      await writer.save(working);
      expect(await writer.persist(working)).toEqual({ kind: 'saved' });
      expect(ids((await store.get('p'))?.document)).toEqual(['tank-1']);
    });

    it('does not write while in conflict', async () => {
      const writer = new DocumentWriter(store, 'p', base.revision);
      await store.save(withObject(base.document, 'other'), base.revision);
      await writer.save(withObject(base.document, 'mine'));
      const save = vi.spyOn(store, 'save');
      expect((await writer.persist(withObject(base.document, 'mine'))).kind).toBe('conflict');
      expect(save).not.toHaveBeenCalled();
    });
  });
});

/** A promise whose settling the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Review of holodeck#241 (round 3): a deletion must freeze the writer for good,
// even when a save was already running when it arrived.
describe('DocumentWriter: deleted elsewhere is sticky', () => {
  const deletedConflict = { kind: 'conflict', latest: undefined };

  it('a running save that RESOLVES after markDeleted keeps the deletion conflict and writes nothing more', async () => {
    const committed = vi.fn();
    const writer = new DocumentWriter(store, 'p', base.revision, committed);
    const running = deferred<VersionedDocument>();
    const save = vi.spyOn(store, 'save').mockImplementationOnce(() => running.promise);
    void writer.save(withObject(base.document, 'tank-1'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    writer.markDeleted();
    running.resolve({ document: base.document, revision: 2 });
    await writer.flush();
    expect(writer.getState()).toMatchObject({ status: deletedConflict, revision: base.revision, dirty: true });
    expect(committed).not.toHaveBeenCalled();
    expect(writer.isDeleted()).toBe(true);
    // The next edit is not written.
    expect(await writer.save(withObject(base.document, 'tank-2'))).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
    expect(writer.getState().status).toEqual(deletedConflict);
  });

  it('a running save that REJECTS (not a conflict) after markDeleted keeps the deletion conflict, not `error`', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    const running = deferred<VersionedDocument>();
    const save = vi.spyOn(store, 'save').mockImplementationOnce(() => running.promise);
    void writer.save(withObject(base.document, 'tank-1'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    writer.markDeleted();
    running.reject(new Error('disk full'));
    await writer.flush();
    expect(writer.getState().status).toEqual(deletedConflict);
    expect(await writer.save(withObject(base.document, 'tank-2'))).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a running save that hits a CONFLICT with a newer version after markDeleted still reports the deletion', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    const running = deferred<VersionedDocument>();
    const save = vi.spyOn(store, 'save').mockImplementationOnce(() => running.promise);
    void writer.save(withObject(base.document, 'tank-1'));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    writer.markDeleted();
    running.reject(new DocumentConflictError('p', 1, { document: base.document, revision: 5 }));
    await writer.flush();
    expect(writer.getState().status).toEqual(deletedConflict);
  });

  it('writes queued behind the running one are dropped (saves and renames)', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    const running = deferred<VersionedDocument>();
    const save = vi.spyOn(store, 'save').mockImplementationOnce(() => running.promise);
    const rename = vi.spyOn(store, 'rename');
    void writer.save(withObject(base.document, 'tank-1'));
    void writer.save(withObject(base.document, 'tank-2'));
    void writer.rename('Gone');
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    writer.markDeleted();
    running.resolve({ document: base.document, revision: 2 });
    expect(await writer.flush()).toEqual(deletedConflict);
    expect(save).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
    expect(writer.busy).toBe(false);
  });

  it('markDeleted then adopt re-opens the writer on the adopted version', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    writer.markDeleted();
    expect(await writer.save(withObject(base.document, 'x'))).toBeUndefined();
    const latest = (await store.get('p'))!;
    writer.adopt(latest);
    expect(writer.isDeleted()).toBe(false);
    const saved = await writer.save(withObject(latest.document, 'tank-9'));
    expect(saved?.revision).toBe(latest.revision + 1);
    expect(writer.getState().status).toEqual({ kind: 'saved' });
  });

  it('hasUnsavedEdits: nothing to lose when deleted while clean; edits, failures and conflicts count', async () => {
    const clean = new DocumentWriter(store, 'p', base.revision);
    expect(clean.hasUnsavedEdits()).toBe(false);
    clean.markDeleted();
    expect(clean.isClean()).toBe(false);
    expect(clean.hasUnsavedEdits()).toBe(false);
    const dirty = new DocumentWriter(store, 'p', base.revision);
    // Deleted before the queued save runs: it is dropped, the edit stays unsaved.
    void dirty.save(withObject(base.document, 'tank-1'));
    dirty.markDeleted();
    expect(dirty.hasUnsavedEdits()).toBe(true);
    const failed = new DocumentWriter(store, 'p', base.revision);
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk full'));
    await failed.save(withObject(base.document, 'tank-1'));
    expect(failed.hasUnsavedEdits()).toBe(true);
  });
});

// A deleted id created again restarts at revision 1: a writer holding the old life must not write over the new one.
describe('DocumentWriter: another life of the same id', () => {
  it('a writer from before a delete + re-create conflicts instead of overwriting, even at the same revision', async () => {
    const old = new DocumentWriter(store, 'p', base.revision, undefined, base.generation);
    expect(base.generation).toEqual(expect.any(String));
    await store.remove('p');
    const reborn = await store.create(withObject(createIsoDocument('Plant', 'p'), 'new-life'));
    expect(reborn.revision).toBe(base.revision);
    expect(reborn.generation).not.toBe(base.generation);
    expect(await old.save(withObject(base.document, 'old-life'))).toBeUndefined();
    expect(old.getState().status).toEqual({ kind: 'conflict', latest: expect.objectContaining({ revision: 1, generation: reborn.generation }) });
    expect(ids((await store.get('p'))?.document)).toEqual(['new-life']);
    // Renames too.
    const renamer = new DocumentWriter(store, 'p', 1, undefined, base.generation);
    await renamer.rename('Old life');
    expect((await store.get('p'))?.document.name).toBe('Plant');
  });

  it('a writer opened without a generation (older records) learns it from its first save', async () => {
    const writer = new DocumentWriter(store, 'p', base.revision);
    await writer.save(withObject(base.document, 'a'));
    await store.remove('p');
    await store.create(createIsoDocument('Plant', 'p'));
    await store.save(withObject(createIsoDocument('Plant', 'p'), 'b'), 1);
    // Same revision (2) as the writer's, other life: refused.
    expect(await writer.save(withObject(base.document, 'c'))).toBeUndefined();
    expect(writer.getState().status.kind).toBe('conflict');
  });
});
