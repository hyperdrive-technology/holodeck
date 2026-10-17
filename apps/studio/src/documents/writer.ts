/**
 * DocumentWriter: the only way an open document is written. One per open
 * document (per tab).
 *
 * - Writes run one at a time, in call order. Each uses the revision the
 *   previous write produced as its `expectedRevision`, so this tab never
 *   conflicts with itself (a rename racing an autosave is just two writes in
 *   a row).
 * - A write that finds a newer revision (another tab saved first) stops the
 *   writer in the `conflict` state: nothing more is written until the user
 *   picks a version (`adopt` the latest, or save theirs as a copy). Neither
 *   version is dropped silently.
 * - Any other failure leaves the writer in `error` with the message; the next
 *   write (e.g. Mod+S re-saving the working copy) retries.
 *
 * Plain class with a subscribe/getState pair, so React reads it with
 * useSyncExternalStore and tests drive it without a DOM.
 */

import type { HolodeckDocument } from '@holodeck/sdk';
import { DocumentConflictError, type DocumentStore, type VersionedDocument } from './store';

export type SaveStatus =
  | { kind: 'saved' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; latest: VersionedDocument | undefined };

export interface WriterState {
  revision: number;
  status: SaveStatus;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class DocumentWriter {
  private state: WriterState;
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: DocumentStore,
    readonly id: string,
    revision: number,
    /** Called with every committed version (e.g. to refresh query caches). */
    private readonly onCommitted: (saved: VersionedDocument) => void = () => undefined,
  ) {
    this.state = { revision, status: { kind: 'saved' } };
  }

  getState = (): WriterState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Writes queued or running. */
  get busy(): boolean {
    return this.queued > 0;
  }

  /** Save the whole working copy. Resolves with the committed version, or undefined if it was not written. */
  save(doc: HolodeckDocument): Promise<VersionedDocument | undefined> {
    return this.enqueue((expected) => this.store.save(doc, expected));
  }

  /** Rename, applied by the store to the stored document inside its transaction. */
  rename(name: string): Promise<VersionedDocument | undefined> {
    return this.enqueue((expected) => this.store.rename(this.id, name, expected));
  }

  /** Resolves once every write queued so far has finished, with the resulting status. */
  async flush(): Promise<SaveStatus> {
    await this.tail;
    return this.state.status;
  }

  /**
   * Leave the conflict state by taking `version` as the new base (the user
   * chose "load latest", or another tab's change was adopted while idle).
   */
  adopt(version: VersionedDocument) {
    this.set({ revision: version.revision, status: { kind: 'saved' } });
  }

  private enqueue(write: (expectedRevision: number) => Promise<VersionedDocument>): Promise<VersionedDocument | undefined> {
    this.queued += 1;
    if (this.state.status.kind !== 'conflict') this.set({ ...this.state, status: { kind: 'saving' } });
    const run = async (): Promise<VersionedDocument | undefined> => {
      try {
        // Blocked: the user has not chosen a version yet.
        if (this.state.status.kind === 'conflict') return undefined;
        const saved = await write(this.state.revision);
        this.set({ revision: saved.revision, status: this.queued > 1 ? { kind: 'saving' } : { kind: 'saved' } });
        this.onCommitted(saved);
        return saved;
      } catch (error) {
        if (error instanceof DocumentConflictError) this.set({ ...this.state, status: { kind: 'conflict', latest: error.latest } });
        else this.set({ ...this.state, status: { kind: 'error', message: messageOf(error) } });
        return undefined;
      } finally {
        this.queued -= 1;
      }
    };
    const result = this.tail.then(run);
    this.tail = result.then(() => undefined);
    return result;
  }

  private set(next: WriterState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
