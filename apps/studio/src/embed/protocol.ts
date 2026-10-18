/**
 * The embed `postMessage` API (holodeck#42, lane S2): message shapes and the
 * validator every inbound message goes through.
 *
 * A page that embeds `/embed/<docId>` in an iframe drives it with messages:
 *
 *   iframe.contentWindow.postMessage(
 *     { protocol: 'holodeck.embed.v1', type: 'setObjectState', requestId: 'r1',
 *       objectId: 'tank-1', state: { level: 0.42 } },
 *     'https://studio.example',            // always the studio's origin, never '*'
 *   );
 *
 * Inbound (parent -> embed):
 *   setObjectState   { objectId, state: { param: number | string | boolean | null } }
 *                    live values for one placement, merged over provider data
 *   clearObjectState { objectId? }   drop overrides for one placement, or all
 *   loadDocument     { document }    show another holodeck.document.v1 envelope
 *                                   (validated like a file import; never stored)
 *   getInfo          {}              reply with the document id, name and objects
 * Every inbound message may carry `requestId`; the embed then replies with a
 * `result` (and `getInfo` with an `info`) addressed to the sender's origin.
 *
 * Outbound (embed -> parent): `ready` once listening (and after every
 * document change), `result`, `info`. See EmbedBridge.ts for the origin rules.
 *
 * Everything that arrives is untrusted: any page in any frame can post to us.
 * The validator accepts only plain objects of exactly these shapes, bounded
 * sizes, safe property names (no `__proto__` / `constructor` / `prototype`),
 * and builds fresh null-prototype objects for anything it keeps.
 */

import type { SignalValue } from '@holodeck/sdk';

export const EMBED_PROTOCOL = 'holodeck.embed.v1';

/** Bounds for untrusted input. */
export const EMBED_LIMITS = {
  /** Max params per setObjectState. */
  stateKeys: 64,
  /** Max string value length. */
  stringValue: 1024,
  /** Max object id length. */
  objectId: 200,
  /** Max request id length. */
  requestId: 64,
} as const;

export type EmbedStateValue = SignalValue;

export type EmbedInbound =
  | { type: 'setObjectState'; requestId?: string; objectId: string; state: Record<string, EmbedStateValue> }
  | { type: 'clearObjectState'; requestId?: string; objectId?: string }
  | { type: 'loadDocument'; requestId?: string; document: Record<string, unknown> }
  | { type: 'getInfo'; requestId?: string };

export type EmbedOutbound =
  | { protocol: typeof EMBED_PROTOCOL; type: 'ready'; documentId: string | null }
  | { protocol: typeof EMBED_PROTOCOL; type: 'result'; requestId: string; ok: true }
  | { protocol: typeof EMBED_PROTOCOL; type: 'result'; requestId: string; ok: false; error: string }
  | {
      protocol: typeof EMBED_PROTOCOL;
      type: 'info';
      requestId: string;
      documentId: string | null;
      name: string | null;
      objects: Array<{ id: string; part: string }>;
    };

/**
 * `ignore`: not an embed message at all (other libraries post to windows too;
 * stay silent). `error`: an embed message we refuse; `requestId` is set when
 * the sender's request id itself was valid, so it can be told why.
 */
export type ParseResult =
  | { kind: 'ok'; message: EmbedInbound }
  | { kind: 'ignore' }
  | { kind: 'error'; error: string; requestId?: string };

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PARAM_KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
// Printable, no control characters; placement ids are short slugs in practice.
const OBJECT_ID = /^[^\u0000-\u001f\u007f]{1,200}$/;

const ALLOWED_KEYS: Record<EmbedInbound['type'], ReadonlySet<string>> = {
  setObjectState: new Set(['protocol', 'type', 'requestId', 'objectId', 'state']),
  clearObjectState: new Set(['protocol', 'type', 'requestId', 'objectId']),
  loadDocument: new Set(['protocol', 'type', 'requestId', 'document']),
  getInfo: new Set(['protocol', 'type', 'requestId']),
};

/**
 * A plain data object: `{}` literal or null-prototype. Structured clone turns
 * class instances into plain objects, but Maps, Dates, Blobs, typed arrays...
 * survive it; none of them is a valid message part.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const own = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);

function stateValue(value: unknown): value is EmbedStateValue {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.length <= EMBED_LIMITS.stringValue;
}

function parseState(raw: unknown): { state: Record<string, EmbedStateValue> } | { error: string } {
  if (!isPlainObject(raw)) return { error: 'state: must be an object of param -> value' };
  const keys = Object.keys(raw);
  if (keys.length === 0) return { error: 'state: must set at least one param' };
  if (keys.length > EMBED_LIMITS.stateKeys) return { error: `state: at most ${EMBED_LIMITS.stateKeys} params per message` };
  // Null prototype: a key like "toString" can never resolve to an inherited function.
  const state: Record<string, EmbedStateValue> = Object.create(null);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key) || !PARAM_KEY.test(key)) return { error: `state: "${key.slice(0, 64)}" is not a valid param name` };
    const value = raw[key];
    if (!stateValue(value)) {
      return { error: `state.${key}: must be a finite number, a boolean, null or a string of at most ${EMBED_LIMITS.stringValue} characters` };
    }
    state[key] = value;
  }
  return { state };
}

/** Validate one `MessageEvent.data`. Never throws (getters cannot run: plain objects only, own data read once). */
export function parseEmbedMessage(data: unknown): ParseResult {
  if (!isPlainObject(data) || data.protocol !== EMBED_PROTOCOL) return { kind: 'ignore' };
  let requestId: string | undefined;
  if (own(data, 'requestId')) {
    if (typeof data.requestId !== 'string' || !REQUEST_ID.test(data.requestId)) {
      return { kind: 'error', error: `requestId: must be 1-${EMBED_LIMITS.requestId} characters of A-Z a-z 0-9 _ . : -` };
    }
    requestId = data.requestId;
  }
  const fail = (error: string): ParseResult => ({ kind: 'error', error, ...(requestId ? { requestId } : {}) });
  const type = data.type;
  // Never coerce a non-string: `String({ toString: 0 })` throws, and this runs outside the bridge's try/catch (holodeck#161).
  if (typeof type !== 'string') return fail('type: must be a string');
  if (!own(ALLOWED_KEYS, type)) return fail(`type: unknown message type ${JSON.stringify(type.slice(0, 40))}`);
  const kind = type as EmbedInbound['type'];
  const extra = Object.keys(data).filter((k) => !ALLOWED_KEYS[kind].has(k));
  if (extra.length) return fail(`${kind}: unexpected field(s) ${extra.slice(0, 5).map((k) => JSON.stringify(k.slice(0, 40))).join(', ')}`);
  const base = requestId ? { requestId } : {};
  const objectIdOf = (required: boolean): { objectId?: string } | { error: string } => {
    if (!own(data, 'objectId')) return required ? { error: `${kind}: objectId is required` } : {};
    const id = data.objectId;
    if (typeof id !== 'string' || !OBJECT_ID.test(id)) return { error: `objectId: must be a string of 1-${EMBED_LIMITS.objectId} printable characters` };
    return { objectId: id };
  };
  switch (kind) {
    case 'setObjectState': {
      const id = objectIdOf(true);
      if ('error' in id) return fail(id.error);
      const state = parseState(data.state);
      if ('error' in state) return fail(state.error);
      return { kind: 'ok', message: { type: kind, ...base, objectId: id.objectId!, state: state.state } };
    }
    case 'clearObjectState': {
      const id = objectIdOf(false);
      if ('error' in id) return fail(id.error);
      return { kind: 'ok', message: { type: kind, ...base, ...id } };
    }
    case 'loadDocument': {
      // Shape only here; the document itself is validated against the host
      // (envelope, engine, packages, body) by the same code as a file import.
      if (!isPlainObject(data.document)) return fail('document: must be a holodeck.document.v1 object');
      return { kind: 'ok', message: { type: kind, ...base, document: data.document } };
    }
    case 'getInfo':
      return { kind: 'ok', message: { type: kind, ...base } };
  }
}

/** Live values from `setObjectState`: objectId -> param -> value (null-prototype maps). */
export type ObjectStates = Readonly<Record<string, Readonly<Record<string, EmbedStateValue>>>>;

/** `states` with `state` merged into `objectId` (a new object; the input is not changed). */
export function withObjectState(states: ObjectStates, objectId: string, state: Readonly<Record<string, EmbedStateValue>>): ObjectStates {
  const next: Record<string, Record<string, EmbedStateValue>> = Object.assign(Object.create(null), states);
  next[objectId] = Object.assign(Object.create(null), states[objectId], state);
  return next;
}

/** `states` without `objectId` (or empty when omitted). */
export function withoutObjectState(states: ObjectStates, objectId?: string): ObjectStates {
  if (objectId === undefined) return Object.create(null);
  const next: Record<string, Record<string, EmbedStateValue>> = Object.assign(Object.create(null), states);
  delete next[objectId];
  return next;
}

/**
 * Provider metrics with embed overrides on top, per param: what the canvas
 * shows. Returns `base` itself when there is nothing to merge (stable identity
 * means no extra render revision).
 */
export function mergeObjectStates(
  base: Readonly<Record<string, Record<string, unknown>>>,
  states: ObjectStates,
): Record<string, Record<string, unknown>> {
  const ids = Object.keys(states);
  if (ids.length === 0) return base as Record<string, Record<string, unknown>>;
  // Null prototype: assigning an id such as "__proto__" defines a key instead of swapping the prototype.
  const merged: Record<string, Record<string, unknown>> = Object.assign(Object.create(null), base);
  for (const id of ids) merged[id] = Object.assign(Object.create(null), base[id], states[id]);
  return merged;
}
