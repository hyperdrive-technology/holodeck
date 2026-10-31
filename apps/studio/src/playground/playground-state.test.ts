import type { HolodeckHost } from '@holodeck/sdk';
import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudioDb } from '../documents/db';
import { DocumentExistsError, DocumentStore } from '../documents/store';
import { createStudioHost, hostDocumentProblems } from '../host/studio-host';
import { DEFAULT_PLAYGROUND_TAB, ensurePlaygroundDocument, parsePlaygroundSearch } from './playground-state';
import { createPlaygroundDocument, PLAYGROUND_DOCUMENT_ID } from './starter';

let host: HolodeckHost;
let store: DocumentStore;
beforeAll(async () => {
  host = await createStudioHost();
});
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  store = new DocumentStore(openStudioDb('playground-state-test'), { validate: (doc) => hostDocumentProblems(host, doc) });
});

describe('tab search param', () => {
  it('reads edit and viewer', () => {
    expect(parsePlaygroundSearch({ tab: 'edit' })).toEqual({ tab: 'edit' });
    expect(parsePlaygroundSearch({ tab: 'viewer' })).toEqual({ tab: 'viewer' });
  });
  it('falls back to Edit for anything else instead of failing the route', () => {
    expect(DEFAULT_PLAYGROUND_TAB).toBe('edit');
    for (const tab of [undefined, '', 'Viewer', 'run', 42, ['viewer'], { tab: 'viewer' }, null]) {
      expect(parsePlaygroundSearch({ tab })).toEqual({ tab: 'edit' });
    }
    expect(parsePlaygroundSearch({})).toEqual({ tab: 'edit' });
  });
});

describe('ensurePlaygroundDocument', () => {
  it('creates the starter on first use (validated by the host) and returns the stored copy afterwards', async () => {
    const first = await ensurePlaygroundDocument(store, host);
    expect(first.revision).toBe(1);
    expect(first.document.id).toBe(PLAYGROUND_DOCUMENT_ID);
    expect(first.document.connections).toHaveLength(1);
    // Edited and saved: the next visit opens the edit, not the starter.
    const edited = { ...first.document, name: 'Mine' };
    await store.save(edited, 1);
    const second = await ensurePlaygroundDocument(store, host);
    expect(second.revision).toBe(2);
    expect(second.document.name).toBe('Mine');
  });

  it('another tab creating it at the same moment is not an error', async () => {
    const create = vi.spyOn(store, 'create').mockImplementationOnce(async (doc) => {
      // The other tab wins the race...
      create.mockRestore();
      await store.create(doc);
      throw new DocumentExistsError(doc.id);
    });
    const result = await ensurePlaygroundDocument(store, host);
    expect(result.document.id).toBe(PLAYGROUND_DOCUMENT_ID);
    expect(result.revision).toBe(1);
  });

  it('surfaces other store failures', async () => {
    vi.spyOn(store, 'create').mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(ensurePlaygroundDocument(store, host)).rejects.toThrow('quota exceeded');
  });

  it('stores exactly the starter content', async () => {
    const stored = await ensurePlaygroundDocument(store, host);
    expect((stored.document.body as { objects: unknown[] }).objects).toEqual(createPlaygroundDocument().body.objects);
  });
});
