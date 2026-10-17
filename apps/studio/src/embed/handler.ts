/**
 * What one validated embed message does (holodeck#42): pure, so every rule
 * is unit-tested without frames. EmbedRoute applies the returned action and
 * the bridge posts the reply.
 */

import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import { ISO_ENGINE_ID, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { MAX_IMPORT_BYTES, parseDocumentValue } from '../documents/io';
import { EMBED_PROTOCOL, type EmbedInbound, type EmbedOutbound, type EmbedStateValue } from './protocol';

export type IsoDocument = HolodeckDocument<IsoSceneFile>;

export type EmbedAction =
  | { kind: 'none' }
  | { kind: 'set-state'; objectId: string; state: Record<string, EmbedStateValue> }
  | { kind: 'clear-state'; objectId?: string }
  | { kind: 'load'; document: IsoDocument };

export interface EmbedOutcome {
  action: EmbedAction;
  /** Reply to the sender (only when it sent a `requestId`). */
  reply?: EmbedOutbound;
}

const NONE: EmbedAction = { kind: 'none' };

/** Serialized size of an untrusted value, or null when it cannot be serialized (cycles, BigInt). */
function jsonSize(value: unknown): number | null {
  try {
    return JSON.stringify(value).length;
  } catch {
    return null;
  }
}

export function handleEmbedMessage(message: EmbedInbound, context: { document: IsoDocument | null; host: HolodeckHost }): EmbedOutcome {
  const { requestId } = message;
  const ok = (action: EmbedAction): EmbedOutcome => ({
    action,
    ...(requestId ? { reply: { protocol: EMBED_PROTOCOL, type: 'result', requestId, ok: true } } : {}),
  });
  const fail = (error: string): EmbedOutcome => ({
    action: NONE,
    ...(requestId ? { reply: { protocol: EMBED_PROTOCOL, type: 'result', requestId, ok: false, error } } : {}),
  });
  const doc = context.document;
  switch (message.type) {
    case 'getInfo':
      if (!requestId) return { action: NONE };
      return {
        action: NONE,
        reply: {
          protocol: EMBED_PROTOCOL,
          type: 'info',
          requestId,
          documentId: doc?.id ?? null,
          name: doc?.name ?? null,
          objects: doc ? doc.body.objects.map((o) => ({ id: o.id, part: o.object })) : [],
        },
      };
    case 'setObjectState':
      if (!doc) return fail('no document is loaded');
      if (!doc.body.objects.some((o) => o.id === message.objectId)) return fail(`objectId: "${message.objectId}" is not in the document`);
      return ok({ kind: 'set-state', objectId: message.objectId, state: message.state });
    case 'clearObjectState':
      return ok({ kind: 'clear-state', ...(message.objectId !== undefined ? { objectId: message.objectId } : {}) });
    case 'loadDocument': {
      const size = jsonSize(message.document);
      if (size === null) return fail('document: must be plain JSON data');
      if (size > MAX_IMPORT_BYTES) return fail(`document: larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB`);
      const result = parseDocumentValue(message.document, context.host);
      if (!result.ok) return fail(result.problems.slice(0, 20).join('; '));
      if (result.document.engine !== ISO_ENGINE_ID) return fail(`document: engine "${result.document.engine}" cannot be embedded yet`);
      return ok({ kind: 'load', document: result.document as IsoDocument });
    }
  }
}
