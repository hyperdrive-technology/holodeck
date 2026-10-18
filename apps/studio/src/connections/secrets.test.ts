import { describe, expect, it, vi } from 'vitest';
import { SECRET_PREFIX, SessionSecretStore } from './secrets';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('SessionSecretStore', () => {
  it('keeps secrets per document and connection', async () => {
    const storage = memoryStorage();
    const store = new SessionSecretStore(storage);
    store.set('doc-a', 'api', 'token', 's3cret');
    store.set('doc-b', 'api', 'token', 'other');
    expect(store.get('doc-a', 'api', 'token')).toBe('s3cret');
    expect(store.get('doc-b', 'api', 'token')).toBe('other');
    expect(store.has('doc-a', 'db', 'token')).toBe(false);
    expect(await store.forDocument('doc-a')('api', 'token')).toBe('s3cret');
    expect(await store.forDocument('doc-a')('api', 'password')).toBeUndefined();
    expect([...storage.map.keys()].every((k) => k.startsWith(SECRET_PREFIX))).toBe(true);
  });

  it('an empty value clears; clear() removes a connection or a whole document', () => {
    const storage = memoryStorage();
    const store = new SessionSecretStore(storage);
    store.set('d', 'a', 'token', 'x');
    store.set('d', 'a', 'password', 'y');
    store.set('d', 'b', 'token', 'z');
    store.set('e', 'a', 'token', 'keep');
    store.set('d', 'a', 'password', '');
    expect(store.has('d', 'a', 'password')).toBe(false);
    store.clear('d', 'a');
    expect(store.has('d', 'a', 'token')).toBe(false);
    expect(store.has('d', 'b', 'token')).toBe(true);
    store.clear('d');
    expect(store.has('d', 'b', 'token')).toBe(false);
    expect(store.get('e', 'a', 'token')).toBe('keep');
  });

  it('ids with separators cannot collide', () => {
    const store = new SessionSecretStore(memoryStorage());
    store.set('a:b', 'c', 'token', '1');
    expect(store.get('a', 'b:c', 'token')).toBeUndefined();
  });

  it('notifies on change and bumps its version', () => {
    const store = new SessionSecretStore(memoryStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('d', 'a', 'token', 'x');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getVersion()).toBe(1);
  });

  it('without storage, reads are empty and writes fail loudly', () => {
    const store = new SessionSecretStore(null);
    expect(store.get('d', 'a', 'token')).toBeUndefined();
    expect(() => store.set('d', 'a', 'token', 'x')).toThrow('session storage');
  });

  it('defaults to sessionStorage, not localStorage or IndexedDB', () => {
    sessionStorage.clear();
    localStorage.clear();
    const store = new SessionSecretStore();
    store.set('d', 'a', 'token', 'x');
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });
});
