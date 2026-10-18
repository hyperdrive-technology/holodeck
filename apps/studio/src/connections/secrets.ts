/**
 * Connection secrets (API tokens, passwords, AWS keys) for this browser tab
 * only. They live in `sessionStorage`: gone when the tab closes, never in
 * IndexedDB, never in a document, an export or an embed. Providers get them
 * through the hub's `secret(connectionId, key)` callback
 * (`ProviderContext.secret`); the UI only ever learns whether one is set.
 *
 * Keys are scoped by document id as well as connection id, so two documents
 * that both have a connection called `api` never share credentials. Each
 * value also records the fingerprint of the endpoint it was entered for
 * (connections/fingerprint.ts); a lookup with another fingerprint finds
 * nothing (holodeck#166).
 *
 * Note: the browser's "Duplicate tab" copies sessionStorage, so a duplicated
 * tab starts with the same secrets; closing either tab does not clear the
 * other.
 */

export const SECRET_PREFIX = 'holodeck-studio:secret:';

/** The Storage subset we use, so tests can pass a fake. */
export type SecretStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const keyOf = (docId: string, connectionId: string, key: string) =>
  `${SECRET_PREFIX}${JSON.stringify([docId, connectionId, key])}`;

export class SessionSecretStore {
  private readonly listeners = new Set<() => void>();
  private version = 0;

  /** `null`: no storage available (secrets cannot be kept). Default: this tab's `sessionStorage`, else memory (see `resolveSecretStorage`). */
  constructor(private readonly storage: SecretStorage | null = resolveSecretStorage().storage) {}

  /** The secret, if one was entered for this connection while it had `fingerprint`. */
  get(docId: string, connectionId: string, key: string, fingerprint: string): string | undefined {
    try {
      const raw = this.storage?.getItem(keyOf(docId, connectionId, key));
      if (raw == null) return undefined;
      const entry = JSON.parse(raw) as { fp?: unknown; v?: unknown };
      return entry.fp === fingerprint && typeof entry.v === 'string' ? entry.v : undefined;
    } catch {
      return undefined; // Not ours, or from an older format: treat as not set.
    }
  }

  has(docId: string, connectionId: string, key: string, fingerprint: string): boolean {
    return this.get(docId, connectionId, key, fingerprint) !== undefined;
  }

  /** Store a secret for the endpoint `fingerprint`; an empty value clears it. Throws if storage refuses (quota, privacy mode). */
  set(docId: string, connectionId: string, key: string, value: string, fingerprint: string): void {
    if (!this.storage) throw new Error('session storage is not available; secrets cannot be kept in this browser');
    if (value === '') this.storage.removeItem(keyOf(docId, connectionId, key));
    else this.storage.setItem(keyOf(docId, connectionId, key), JSON.stringify({ fp: fingerprint, v: value }));
    this.changed();
  }

  delete(docId: string, connectionId: string, key: string): void {
    this.storage?.removeItem(keyOf(docId, connectionId, key));
    this.changed();
  }

  /** Remove every secret of one connection (it was removed or renamed) or, without `connectionId`, of a document. */
  clear(docId: string, connectionId?: string): void {
    if (!this.storage) return;
    const doomed: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (!k?.startsWith(SECRET_PREFIX)) continue;
      try {
        const [d, c] = JSON.parse(k.slice(SECRET_PREFIX.length)) as [string, string, string];
        if (d === docId && (connectionId === undefined || c === connectionId)) doomed.push(k);
      } catch {
        // Not ours.
      }
    }
    for (const k of doomed) this.storage.removeItem(k);
    if (doomed.length) this.changed();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Bumped on every change; a `useSyncExternalStore` snapshot. */
  getVersion = (): number => this.version;

  private changed() {
    this.version += 1;
    for (const l of this.listeners) l();
  }
}

/** A Storage that lives in this page's memory only (lost on reload). */
export function memoryStorage(): SecretStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/**
 * This tab's sessionStorage if the browser lets us use it, else an in-memory
 * store. Browser policies can make merely READING `window.sessionStorage`
 * throw (`SecurityError`), which used to abort app startup (review of
 * holodeck#163). `kind` says which one, for a notice.
 */
export function resolveSecretStorage(get: () => Storage | undefined = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)): {
  storage: SecretStorage;
  kind: 'session' | 'memory';
} {
  try {
    const storage = get();
    if (storage) {
      // Some policies allow the getter but refuse writes.
      const probe = `${SECRET_PREFIX}probe`;
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return { storage, kind: 'session' };
    }
  } catch {
    // Fall through to memory.
  }
  return { storage: memoryStorage(), kind: 'memory' };
}
