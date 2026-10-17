import type { HolodeckDocument } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudioDb } from './db';
import { createIsoDocument } from './new-document';
import { DocumentStore, type VersionedDocument } from './store';
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
});
