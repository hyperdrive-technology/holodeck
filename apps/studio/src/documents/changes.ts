/**
 * Cross-tab change notices over a BroadcastChannel. The store posts after
 * every committed write; other tabs refresh their document list and, if they
 * have that document open and idle, adopt the new revision. A tab with
 * unsaved edits does not adopt: its next save conflicts and the user picks.
 * (BroadcastChannel never delivers a message back to the posting instance.)
 */

import type { DocumentChange } from './store';

export const DOCUMENT_CHANNEL = 'holodeck-studio:documents';

export interface DocumentChannel {
  post(change: DocumentChange): void;
  subscribe(listener: (change: DocumentChange) => void): () => void;
}

const isChange = (v: unknown): v is DocumentChange =>
  !!v && typeof v === 'object' && typeof (v as DocumentChange).id === 'string' &&
  ((v as DocumentChange).type === 'deleted' || ((v as DocumentChange).type === 'saved' && Number.isInteger((v as { revision?: unknown }).revision)));

/** A channel over BroadcastChannel, or a no-op where it is missing. */
export function createDocumentChannel(name = DOCUMENT_CHANNEL): DocumentChannel {
  if (typeof BroadcastChannel === 'undefined') return { post: () => undefined, subscribe: () => () => undefined };
  const channel = new BroadcastChannel(name);
  return {
    post: (change) => channel.postMessage(change),
    subscribe(listener) {
      const onMessage = (event: MessageEvent) => {
        if (isChange(event.data)) listener(event.data);
      };
      channel.addEventListener('message', onMessage);
      return () => channel.removeEventListener('message', onMessage);
    },
  };
}
