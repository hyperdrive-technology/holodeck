import { describe, expect, it, vi } from 'vitest';
import { SECRET_PREFIX, SessionSecretStore } from './secrets';

const FP = 'fp-1';

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
    store.set('doc-a', 'api', 'token', 's3cret', FP);
    store.set('doc-b', 'api', 'token', 'other', FP);
    expect(store.get('doc-a', 'api', 'token', FP)).toBe('s3cret');
    expect(store.get('doc-b', 'api', 'token', FP)).toBe('other');
    expect(store.has('doc-a', 'db', 'token', FP)).toBe(false);
    expect(await store.forDocument('doc-a', () => FP)('api', 'token')).toBe('s3cret');
    expect(await store.forDocument('doc-a', () => FP)('api', 'password')).toBeUndefined();
    expect([...storage.map.keys()].every((k) => k.startsWith(SECRET_PREFIX))).toBe(true);
  });

  it('an empty value clears; clear() removes a connection or a whole document', () => {
    const storage = memoryStorage();
    const store = new SessionSecretStore(storage);
    store.set('d', 'a', 'token', 'x', FP);
    store.set('d', 'a', 'password', 'y', FP);
    store.set('d', 'b', 'token', 'z', FP);
    store.set('e', 'a', 'token', 'keep', FP);
    store.set('d', 'a', 'password', '', FP);
    expect(store.has('d', 'a', 'password', FP)).toBe(false);
    store.clear('d', 'a');
    expect(store.has('d', 'a', 'token', FP)).toBe(false);
    expect(store.has('d', 'b', 'token', FP)).toBe(true);
    store.clear('d');
    expect(store.has('d', 'b', 'token', FP)).toBe(false);
    expect(store.get('e', 'a', 'token', FP)).toBe('keep');
  });

  it('ids with separators cannot collide', () => {
    const store = new SessionSecretStore(memoryStorage());
    store.set('a:b', 'c', 'token', '1', FP);
    expect(store.get('a', 'b:c', 'token', FP)).toBeUndefined();
  });

  it('notifies on change and bumps its version', () => {
    const store = new SessionSecretStore(memoryStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    store.set('d', 'a', 'token', 'x', FP);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getVersion()).toBe(1);
  });

  it('without storage, reads are empty and writes fail loudly', () => {
    const store = new SessionSecretStore(null);
    expect(store.get('d', 'a', 'token', FP)).toBeUndefined();
    expect(() => store.set('d', 'a', 'token', 'x', FP)).toThrow('session storage');
  });

  it('defaults to sessionStorage, not localStorage or IndexedDB', () => {
    sessionStorage.clear();
    localStorage.clear();
    const store = new SessionSecretStore();
    store.set('d', 'a', 'token', 'x', FP);
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  // holodeck#166: secrets are bound to the endpoint they were entered for.
  it('hands out a secret only for the fingerprint it was entered with', async () => {
    const store = new SessionSecretStore(memoryStorage());
    store.set('d', 'api', 'token', 'tok', 'endpoint-A');
    expect(store.get('d', 'api', 'token', 'endpoint-A')).toBe('tok');
    expect(store.get('d', 'api', 'token', 'endpoint-B')).toBeUndefined();
    expect(store.has('d', 'api', 'token', 'endpoint-B')).toBe(false);
    let current = 'endpoint-A';
    const lookup = store.forDocument('d', () => current);
    expect(await lookup('api', 'token')).toBe('tok');
    current = 'endpoint-B';
    expect(await lookup('api', 'token')).toBeUndefined();
    expect(await store.forDocument('d', () => undefined)('api', 'token')).toBeUndefined();
  });

  it('ignores values stored in another format (fail closed)', () => {
    const storage = memoryStorage();
    const store = new SessionSecretStore(storage);
    store.set('d', 'api', 'token', 'tok', 'fp');
    const key = [...storage.map.keys()][0]!;
    storage.map.set(key, 'plain-old-value');
    expect(store.get('d', 'api', 'token', 'fp')).toBeUndefined();
  });
});
