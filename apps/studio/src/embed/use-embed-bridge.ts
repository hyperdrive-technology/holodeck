/**
 * The embed's `message` listener (holodeck#42). Order of checks for every
 * inbound event: direct parent frame + allowed origin (origins.ts), then the
 * message schema (protocol.ts), then what it may do (handler.ts). Replies go
 * to `event.origin` (already verified); `ready` goes to each allowed origin
 * with that exact `targetOrigin`, so the browser delivers it only if the
 * parent really is that origin. Nothing is ever posted with `'*'`.
 */

import { useEffect, useRef } from 'react';
import type { EmbedOriginPolicy } from './origins';
import { acceptMessage } from './origins';
import { EMBED_PROTOCOL, parseEmbedMessage, type EmbedInbound, type EmbedOutbound } from './protocol';
import type { EmbedOutcome } from './handler';

/** The window we talk to. A parameter so tests can stand in for a parent frame. */
export interface EmbedParent {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface EmbedBridgeOptions {
  policy: EmbedOriginPolicy;
  /**
   * The document id to announce in `ready` to `origin` (null: none). Re-announced
   * when `readyKey` changes. Lets the route withhold a stored document's id from
   * untrusted origins (holodeck#151).
   */
  documentIdFor: (origin: string) => string | null;
  /** Changes whenever what `documentIdFor` returns may have changed. */
  readyKey: string;
  /** Handle one validated message from `origin`; returns the action already applied and the reply. */
  onMessage: (message: EmbedInbound, origin: string) => EmbedOutcome;
  /** Default: `window.parent`, or null when not framed (the API is then off). */
  parent?: EmbedParent | null;
  /** The window that receives messages. Default: `window`. */
  target?: Window;
}

export function useEmbedBridge({ policy, documentIdFor, readyKey, onMessage, parent: parentOption, target: targetOption }: EmbedBridgeOptions): { enabled: boolean } {
  const target = targetOption ?? window;
  const parent = parentOption !== undefined ? parentOption : target.parent !== target ? target.parent : null;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!parent) return;
    const post = (message: EmbedOutbound, origin: string) => {
      try {
        parent.postMessage(message, origin);
      } catch (error) {
        // A malformed targetOrigin throws SyntaxError; allowed origins are validated, so this is a bug.
        console.error('holodeck embed: could not post to the parent', error);
      }
    };
    const listener = (event: MessageEvent) => {
      if (!acceptMessage(event, policy, parent as unknown as MessageEventSource, target)) return;
      const parsed = parseEmbedMessage(event.data);
      if (parsed.kind === 'ignore') return;
      if (parsed.kind === 'error') {
        console.warn(`holodeck embed: refused a message from ${event.origin}: ${parsed.error}`);
        if (parsed.requestId) post({ protocol: EMBED_PROTOCOL, type: 'result', requestId: parsed.requestId, ok: false, error: parsed.error }, event.origin);
        return;
      }
      let outcome: EmbedOutcome;
      try {
        outcome = onMessageRef.current(parsed.message, event.origin);
      } catch (error) {
        console.error('holodeck embed: message handler failed', error);
        const requestId = parsed.message.requestId;
        if (requestId) post({ protocol: EMBED_PROTOCOL, type: 'result', requestId, ok: false, error: 'internal error' }, event.origin);
        return;
      }
      if (outcome.reply) post(outcome.reply, event.origin);
    };
    target.addEventListener('message', listener);
    return () => target.removeEventListener('message', listener);
  }, [parent, policy, target]);

  // `ready`: once listening, and again whenever the shown document changes.
  const documentIdForRef = useRef(documentIdFor);
  documentIdForRef.current = documentIdFor;
  useEffect(() => {
    if (!parent) return;
    for (const origin of policy.allowed) {
      try {
        const documentId = documentIdForRef.current(origin);
        parent.postMessage({ protocol: EMBED_PROTOCOL, type: 'ready', documentId } satisfies EmbedOutbound, origin);
      } catch (error) {
        console.error('holodeck embed: could not post ready', error);
      }
    }
  }, [parent, policy, readyKey]);

  return { enabled: parent !== null };
}
