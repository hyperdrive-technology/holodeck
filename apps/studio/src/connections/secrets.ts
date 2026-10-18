/**
 * Connection secrets (API tokens, passwords, AWS keys) for this browser tab
 * only. They live in `sessionStorage`: gone when the tab closes, never in
 * IndexedDB, never in a document, an export or an embed. Providers get them
 * through the hub's `secret(connectionId, key)` callback
 * (`ProviderContext.secret`); the UI only ever learns whether one is set.
 *
 * Keys are scoped by document id as well as connection id, so two documents
 * that both have a connection called `api` never share credentials.
 */

export const SECRET_PREFIX = 'holodeck-studio:secret:';

/** The Storage subset we use, so tests can pass a fake. */
export type SecretStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const keyOf = (docId: string, connectionId: string, key: string) =>
  `${SECRET_PREFIX}${JSON.stringify([docId, connectionId, key])}`;

export class SessionSecretStore {
  private readonly listeners = new Set<() => void>();
  private version = 0;

  /** `null`: no storage available (secrets cannot be kept). Default: this tab's `sessionStorage`. */
  constructor(private readonly storage: SecretStorage | null = typeof sessionStorage === 'undefined' ? null : sessionStorage) {}

  get(docId: string, connectionId: string, key: string): string | undefined {
    try {
      return this.storage?.getItem(keyOf(docId, connectionId, key)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  has(docId: string, connectionId: string, key: string): boolean {
    return this.get(docId, connectionId, key) !== undefined;
  }

  /** Store a secret; an empty value clears it. Throws if storage refuses (quota, privacy mode). */
  set(docId: string, connectionId: string, key: string, value: string): void {
    if (!this.storage) throw new Error('session storage is not available; secrets cannot be kept in this browser');
    if (value === '') this.storage.removeItem(keyOf(docId, connectionId, key));
    else this.storage.setItem(keyOf(docId, connectionId, key), value);
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

  /** Hub callback for one document (`ProviderHubOptions.secret`). */
  forDocument(docId: string): (connectionId: string, key: string) => Promise<string | undefined> {
    return async (connectionId, key) => this.get(docId, connectionId, key);
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
