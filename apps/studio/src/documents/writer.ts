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
 * - `dirty`: the working copy has edits no successful body `save` has
 *   persisted yet. Only a body save clears it (a rename persists the name
 *   alone), so a failed save stays visible as `error` until the body is
 *   saved, and `isClean()` stays false: the workspace must not replace the
 *   working copy with another tab's version, and closing the tab warns.
 *   (Review of holodeck#102 @ 2b2a498: a successful rename used to report
 *   `saved` over a failed body save.)
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
  /** Edits in the working copy that no successful body save has persisted. */
  dirty: boolean;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class DocumentWriter {
  private state: WriterState;
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  /** Sequence number of the latest body save enqueued; only its success clears `dirty`. */
  private bodySeq = 0;
  /** Why the latest failed body save failed (kept while `dirty`). */
  private bodyError: string | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: DocumentStore,
    readonly id: string,
    revision: number,
    /** Called with every committed version (e.g. to refresh query caches). */
    private readonly onCommitted: (saved: VersionedDocument) => void = () => undefined,
  ) {
    this.state = { revision, status: { kind: 'saved' }, dirty: false };
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
    this.bodySeq += 1;
    const seq = this.bodySeq;
    if (!this.state.dirty) this.set({ ...this.state, dirty: true });
    return this.enqueue((expected) => this.store.save(doc, expected), seq);
  }

  /**
   * Mod+S: make sure the working copy is stored and report the real outcome.
   * A clean writer (nothing unsaved, queued, failed or in conflict) writes
   * nothing: a new revision for an unchanged document would make every other
   * open tab adopt a no-op (holodeck#118). Otherwise the working copy is
   * saved (a retry after a failure) and every queued write is awaited.
   */
  async persist(doc: HolodeckDocument): Promise<SaveStatus> {
    if (this.isClean()) return this.state.status;
    if (this.state.status.kind !== 'conflict') void this.save(doc);
    return this.flush();
  }

  /** Rename, applied by the store to the stored document inside its transaction. Leaves `dirty` alone. */
  rename(name: string): Promise<VersionedDocument | undefined> {
    return this.enqueue((expected) => this.store.rename(this.id, name, expected));
  }

  /**
   * True when the working copy equals what is stored at `revision`: nothing
   * queued, nothing unsaved, no error or conflict. Only then may the
   * workspace adopt another tab's version or leave without a warning.
   */
  isClean(): boolean {
    return !this.busy && !this.state.dirty && this.state.status.kind === 'saved';
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
    this.bodyError = undefined;
    this.set({ revision: version.revision, status: { kind: 'saved' }, dirty: false });
  }

  /**
   * The document was deleted elsewhere while this tab still has it open.
   * Only meaningful when not clean: the writer enters the same conflict
   * state a save against a missing record produces (`latest` undefined), so
   * nothing more is written and the user saves a copy or discards.
   */
  markDeleted() {
    if (this.state.status.kind === 'conflict' && this.state.status.latest === undefined) return;
    this.set({ ...this.state, status: { kind: 'conflict', latest: undefined } });
  }

  /** Status after a write settles: still saving if more are queued, else saved unless the body is unsaved. */
  private settledStatus(): SaveStatus {
    if (this.queued > 1) return { kind: 'saving' };
    if (this.state.dirty) return { kind: 'error', message: this.bodyError ?? 'changes not saved yet' };
    return { kind: 'saved' };
  }

  private enqueue(
    write: (expectedRevision: number) => Promise<VersionedDocument>,
    /** Set for body saves: the save's sequence number. */
    bodySeq?: number,
  ): Promise<VersionedDocument | undefined> {
    this.queued += 1;
    if (this.state.status.kind !== 'conflict') this.set({ ...this.state, status: { kind: 'saving' } });
    const run = async (): Promise<VersionedDocument | undefined> => {
      try {
        // Blocked: the user has not chosen a version yet.
        if (this.state.status.kind === 'conflict') return undefined;
        const saved = await write(this.state.revision);
        // Only the latest body save persists the whole current working copy.
        const persistedBody = bodySeq !== undefined && bodySeq === this.bodySeq;
        if (persistedBody) this.bodyError = undefined;
        this.state = { ...this.state, revision: saved.revision, dirty: this.state.dirty && !persistedBody };
        this.set({ ...this.state, status: this.settledStatus() });
        this.onCommitted(saved);
        return saved;
      } catch (error) {
        if (bodySeq !== undefined) this.bodyError = messageOf(error);
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
