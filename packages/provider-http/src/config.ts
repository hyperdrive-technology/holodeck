/**
 * Connection config of `holodeck.http` (non-secret: it is stored in documents).
 * Secrets (tokens, passwords) reach the provider only through
 * `ProviderContext.secret(key)`; see `HTTP_PROVIDER_SECRETS`.
 */

import type { ProviderSecretSpec, SignalValue } from '@holodeck/sdk';
import { parseSelector, type SelectorToken } from './selector';

export type HttpMode = 'poll' | 'sse' | 'websocket';
export const HTTP_MODES: readonly HttpMode[] = ['poll', 'sse', 'websocket'];

export type HttpAuth =
  /** `Authorization: Bearer <token>` (secret `token`). */
  | { scheme: 'bearer' }
  /** `<name>: <token>`, e.g. `X-API-Key` (secret `token`). */
  | { scheme: 'header'; name: string }
  /** `?<name>=<token>` on every URL (secret `token`). The only scheme browsers allow for WebSocket. */
  | { scheme: 'query'; name: string }
  /** `Authorization: Basic …` from `username` and the secret `password`. */
  | { scheme: 'basic'; username: string };

export interface BackoffConfig {
  /** First retry delay (default 1000 ms). */
  initialMs: number;
  /** Ceiling (default 30000 ms). */
  maxMs: number;
  /** Growth per consecutive failure (default 2). */
  factor: number;
  /** ± fraction of random spread, 0–1 (default 0.2), so many clients do not retry in lockstep. */
  jitter: number;
}

export type WriteBody = 'envelope' | 'value';

export interface WriteConfig {
  /** Default `POST`. */
  method: 'POST' | 'PUT' | 'PATCH';
  /**
   * Target: absolute path (`/api/write`) on the connection's origin, or a full
   * URL on the same origin. `{source}` and `{selector}` are replaced with the
   * URI-encoded source / selector part. Default: the connection URL.
   */
  url?: string;
  /** `envelope` (default) sends `{"source": …, "value": …}`; `value` sends the bare JSON value. */
  body: WriteBody;
}

export interface HttpConnectionConfig {
  /** Default endpoint. `http(s)://` for `poll` / `sse`, `ws(s)://` for `websocket`. */
  url: string;
  /** Default `poll`. */
  mode: HttpMode;
  /** Poll period (default 5000 ms, minimum 50 ms). The next poll starts after the previous one finishes. */
  intervalMs: number;
  /** Per-request timeout; for streams, the time allowed to open the stream (default 10000 ms). */
  timeoutMs: number;
  backoff: BackoffConfig;
  /** Extra non-secret request headers. `Authorization`, `Cookie` and `Proxy-Authorization` are refused: use `auth`. */
  headers: Record<string, string>;
  auth?: HttpAuth;
  /** Poll request method (default `GET`). */
  method: 'GET' | 'POST';
  /** JSON request body for `method: "POST"` polls. */
  body?: unknown;
  /** Selector (pointer or `$` path) of the message timestamp: epoch milliseconds or an ISO 8601 string. Default: receive time. */
  timestamp?: string;
  /** SSE only: event names to accept (default: all). An event without `event:` is named `message`. */
  events?: string[];
  /** WebSocket only: JSON value sent once after every (re)connect, e.g. a subscribe request. */
  subscribe?: unknown;
  /** WebSocket only: subprotocols. */
  protocols?: string[];
  /** Enables `session.write`. */
  write?: WriteConfig;
  /** Largest response body / SSE event / WebSocket message accepted (default 4 MiB). */
  maxBytes: number;
  /** Follow HTTP redirects (default false: a redirect is an error, so requests cannot leave the configured origin). */
  followRedirects: boolean;
}

export const HTTP_DEFAULTS = Object.freeze({
  mode: 'poll' as HttpMode,
  intervalMs: 5000,
  timeoutMs: 10_000,
  backoff: Object.freeze({ initialMs: 1000, maxMs: 30_000, factor: 2, jitter: 0.2 }),
  method: 'GET' as const,
  maxBytes: 4 * 1024 * 1024,
  followRedirects: false as boolean,
});

export const MIN_INTERVAL_MS = 50;

/** Secrets a connection may use, by auth scheme. All optional: only the one `auth` names is read. */
export const HTTP_PROVIDER_SECRETS: ProviderSecretSpec[] = [
  { key: 'token', label: 'API token', description: 'Used by auth schemes bearer, header and query.', optional: true },
  { key: 'password', label: 'Password', description: 'Used by auth scheme basic.', optional: true },
];

/** Header names that carry credentials; they belong in secrets, never in a document. */
const SECRET_HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie']);
/** RFC 9110 token characters. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const QUERY_NAME = /^[A-Za-z0-9._~-]+$/;

export class HttpConfigError extends TypeError {
  constructor(readonly details: string[]) {
    super(`holodeck.http config is invalid:\n  ${details.join('\n  ')}`);
    this.name = 'HttpConfigError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const KNOWN_KEYS = new Set([
  'url',
  'mode',
  'intervalMs',
  'timeoutMs',
  'backoff',
  'headers',
  'auth',
  'method',
  'body',
  'timestamp',
  'events',
  'subscribe',
  'protocols',
  'write',
  'maxBytes',
  'followRedirects',
]);

/** Is `v` a JSON value (no functions, undefined, NaN, cycles or class instances)? Bounded depth. */
function isJsonValue(v: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJsonValue(x, depth + 1));
  if (isObj(v) && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.values(v).every((x) => isJsonValue(x, depth + 1));
  }
  return false;
}

function positiveInt(errors: string[], key: string, value: unknown, fallback: number, min = 1, max = 86_400_000): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.push(`${key}: must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

function parseUrl(errors: string[], key: string, raw: unknown, schemes: readonly string[]): URL | undefined {
  if (typeof raw !== 'string' || raw.trim() !== raw || raw === '') {
    errors.push(`${key}: must be a URL string without surrounding whitespace`);
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    errors.push(`${key}: is not a valid URL`);
    return undefined;
  }
  if (!schemes.includes(url.protocol.slice(0, -1))) {
    errors.push(`${key}: scheme must be one of ${schemes.map((s) => `${s}:`).join(', ')}`);
    return undefined;
  }
  if (url.username || url.password) errors.push(`${key}: must not embed credentials (use auth + secrets)`);
  if (url.hash) errors.push(`${key}: must not have a #fragment`);
  return url;
}

/**
 * Validate and normalise a raw `ProviderConnection.config`. Throws one
 * `HttpConfigError` listing every problem. Unknown keys are errors (typos fail loudly).
 */
export function parseHttpConfig(raw: unknown): HttpConnectionConfig {
  const errors: string[] = [];
  if (!isObj(raw)) throw new HttpConfigError(['config: must be an object']);
  for (const key of Object.keys(raw)) if (!KNOWN_KEYS.has(key)) errors.push(`${key}: unknown setting`);

  let mode: HttpMode = HTTP_DEFAULTS.mode;
  if (raw.mode !== undefined) {
    if (HTTP_MODES.includes(raw.mode as HttpMode)) mode = raw.mode as HttpMode;
    else errors.push(`mode: must be one of ${HTTP_MODES.join(', ')}`);
  }
  const schemes = mode === 'websocket' ? ['ws', 'wss'] : ['http', 'https'];
  const url = parseUrl(errors, 'url', raw.url, schemes);

  const intervalMs = positiveInt(errors, 'intervalMs', raw.intervalMs, HTTP_DEFAULTS.intervalMs, MIN_INTERVAL_MS);
  const timeoutMs = positiveInt(errors, 'timeoutMs', raw.timeoutMs, HTTP_DEFAULTS.timeoutMs, 1, 600_000);
  const maxBytes = positiveInt(errors, 'maxBytes', raw.maxBytes, HTTP_DEFAULTS.maxBytes, 1, 256 * 1024 * 1024);

  const backoff: BackoffConfig = { ...HTTP_DEFAULTS.backoff };
  if (raw.backoff !== undefined) {
    if (!isObj(raw.backoff)) errors.push('backoff: must be an object');
    else {
      for (const key of Object.keys(raw.backoff)) {
        if (!['initialMs', 'maxMs', 'factor', 'jitter'].includes(key)) errors.push(`backoff.${key}: unknown setting`);
      }
      backoff.initialMs = positiveInt(errors, 'backoff.initialMs', raw.backoff.initialMs, backoff.initialMs);
      backoff.maxMs = positiveInt(errors, 'backoff.maxMs', raw.backoff.maxMs, backoff.maxMs);
      const { factor, jitter } = raw.backoff;
      if (factor !== undefined) {
        if (typeof factor === 'number' && factor >= 1 && factor <= 10) backoff.factor = factor;
        else errors.push('backoff.factor: must be a number between 1 and 10');
      }
      if (jitter !== undefined) {
        if (typeof jitter === 'number' && jitter >= 0 && jitter <= 1) backoff.jitter = jitter;
        else errors.push('backoff.jitter: must be a number between 0 and 1');
      }
      if (backoff.maxMs < backoff.initialMs) errors.push('backoff.maxMs: must be ≥ backoff.initialMs');
    }
  }

  const headers: Record<string, string> = {};
  if (raw.headers !== undefined) {
    if (!isObj(raw.headers)) errors.push('headers: must be an object of strings');
    else {
      for (const [name, value] of Object.entries(raw.headers)) {
        if (!HEADER_NAME.test(name)) errors.push(`headers.${name}: not a valid header name`);
        else if (SECRET_HEADERS.has(name.toLowerCase())) {
          errors.push(`headers.${name}: credentials must not be stored in a document; use auth + secrets`);
        } else if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
          errors.push(`headers.${name}: must be a single-line string`);
        } else headers[name] = value;
      }
    }
  }

  let auth: HttpAuth | undefined;
  if (raw.auth !== undefined) {
    const a = raw.auth;
    if (!isObj(a)) errors.push('auth: must be an object');
    else if (a.scheme === 'bearer') {
      auth = { scheme: 'bearer' };
      for (const k of Object.keys(a)) if (k !== 'scheme') errors.push(`auth.${k}: unknown setting`);
    } else if (a.scheme === 'header') {
      if (typeof a.name !== 'string' || !HEADER_NAME.test(a.name)) errors.push('auth.name: must be a header name');
      else auth = { scheme: 'header', name: a.name };
      for (const k of Object.keys(a)) if (k !== 'scheme' && k !== 'name') errors.push(`auth.${k}: unknown setting`);
    } else if (a.scheme === 'query') {
      if (typeof a.name !== 'string' || !QUERY_NAME.test(a.name)) errors.push('auth.name: must be a query parameter name');
      else auth = { scheme: 'query', name: a.name };
      for (const k of Object.keys(a)) if (k !== 'scheme' && k !== 'name') errors.push(`auth.${k}: unknown setting`);
    } else if (a.scheme === 'basic') {
      if (typeof a.username !== 'string' || a.username.includes(':') || /[\r\n\0]/.test(a.username)) {
        errors.push('auth.username: must be a string without ":"');
      } else auth = { scheme: 'basic', username: a.username };
      for (const k of Object.keys(a)) if (k !== 'scheme' && k !== 'username') errors.push(`auth.${k}: unknown setting`);
    } else errors.push('auth.scheme: must be bearer, header, query or basic');
    if (auth && mode === 'websocket' && auth.scheme !== 'query') {
      // Browsers' WebSocket constructor cannot set request headers, so only the
      // query scheme works everywhere. (Node's undici WebSocket can; a host that
      // needs header auth on Node can pass its own `WebSocket` factory.)
      errors.push('auth.scheme: websocket connections support only the query scheme');
    }
  }

  let method: 'GET' | 'POST' = HTTP_DEFAULTS.method;
  if (raw.method !== undefined) {
    if (raw.method === 'GET' || raw.method === 'POST') method = raw.method;
    else errors.push('method: must be GET or POST');
  }
  if (raw.body !== undefined) {
    if (method !== 'POST') errors.push('body: only allowed with method POST');
    if (!isJsonValue(raw.body)) errors.push('body: must be a JSON value');
  }
  if (mode !== 'poll' && (raw.method !== undefined || raw.body !== undefined)) {
    errors.push('method/body: only apply to mode poll');
  }
  if (mode !== 'poll' && raw.intervalMs !== undefined) errors.push('intervalMs: only applies to mode poll');

  let timestamp: string | undefined;
  if (raw.timestamp !== undefined) {
    if (typeof raw.timestamp !== 'string') errors.push('timestamp: must be a selector string');
    else {
      try {
        parseSelector(raw.timestamp);
        timestamp = raw.timestamp;
      } catch (err) {
        errors.push(`timestamp: ${(err as Error).message}`);
      }
    }
  }

  let events: string[] | undefined;
  if (raw.events !== undefined) {
    if (mode !== 'sse') errors.push('events: only applies to mode sse');
    if (!Array.isArray(raw.events) || !raw.events.every((e) => typeof e === 'string' && e !== '' && !/[\r\n]/.test(e))) {
      errors.push('events: must be a list of event names');
    } else events = [...raw.events];
  }
  if (raw.subscribe !== undefined) {
    if (mode !== 'websocket') errors.push('subscribe: only applies to mode websocket');
    if (!isJsonValue(raw.subscribe)) errors.push('subscribe: must be a JSON value');
  }
  let protocols: string[] | undefined;
  if (raw.protocols !== undefined) {
    if (mode !== 'websocket') errors.push('protocols: only applies to mode websocket');
    if (!Array.isArray(raw.protocols) || !raw.protocols.every((p) => typeof p === 'string' && HEADER_NAME.test(p))) {
      errors.push('protocols: must be a list of subprotocol tokens');
    } else protocols = [...raw.protocols];
  }

  let write: WriteConfig | undefined;
  if (raw.write !== undefined) {
    const w = raw.write;
    if (!isObj(w)) errors.push('write: must be an object');
    else {
      for (const k of Object.keys(w)) if (!['method', 'url', 'body'].includes(k)) errors.push(`write.${k}: unknown setting`);
      write = { method: 'POST', body: 'envelope' };
      if (w.method !== undefined) {
        if (w.method === 'POST' || w.method === 'PUT' || w.method === 'PATCH') write.method = w.method;
        else errors.push('write.method: must be POST, PUT or PATCH');
      }
      if (w.body !== undefined) {
        if (w.body === 'envelope' || w.body === 'value') write.body = w.body;
        else errors.push('write.body: must be envelope or value');
      }
      if (w.url !== undefined) {
        if (typeof w.url !== 'string' || w.url === '' || /[\s\\]/.test(w.url)) errors.push('write.url: must be a path or URL');
        else write.url = w.url;
      }
    }
  }

  let followRedirects = HTTP_DEFAULTS.followRedirects;
  if (raw.followRedirects !== undefined) {
    if (typeof raw.followRedirects === 'boolean') followRedirects = raw.followRedirects;
    else errors.push('followRedirects: must be a boolean');
  }

  if (errors.length || !url) throw new HttpConfigError(errors.length ? errors : ['url: is required']);
  return {
    url: url.href,
    mode,
    intervalMs,
    timeoutMs,
    backoff,
    headers,
    auth,
    method,
    body: raw.body,
    timestamp,
    events,
    subscribe: raw.subscribe,
    protocols,
    write,
    maxBytes,
    followRedirects,
  };
}

/** A JSON scalar: what a Holodeck signal can carry. */
export function isSignalValue(value: unknown): value is SignalValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/** Convert a parsed timestamp value to epoch ms, or undefined when unusable. */
export function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

/** Tokens of `config.timestamp`, parsed once. */
export function timestampTokens(config: HttpConnectionConfig): SelectorToken[] | undefined {
  return config.timestamp === undefined ? undefined : parseSelector(config.timestamp);
}

/** JSON Schema of the connection config, for host config forms (`HolodeckProvider.configSchema`). No secrets. */
export const HTTP_CONFIG_SCHEMA: Record<string, unknown> = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', description: 'Default endpoint: http(s):// for poll/sse, ws(s):// for websocket.' },
    mode: { enum: [...HTTP_MODES], default: HTTP_DEFAULTS.mode },
    intervalMs: { type: 'integer', minimum: MIN_INTERVAL_MS, default: HTTP_DEFAULTS.intervalMs, description: 'Poll period (poll only).' },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 600_000, default: HTTP_DEFAULTS.timeoutMs },
    backoff: {
      type: 'object',
      additionalProperties: false,
      properties: {
        initialMs: { type: 'integer', minimum: 1, default: HTTP_DEFAULTS.backoff.initialMs },
        maxMs: { type: 'integer', minimum: 1, default: HTTP_DEFAULTS.backoff.maxMs },
        factor: { type: 'number', minimum: 1, maximum: 10, default: HTTP_DEFAULTS.backoff.factor },
        jitter: { type: 'number', minimum: 0, maximum: 1, default: HTTP_DEFAULTS.backoff.jitter },
      },
    },
    headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Non-secret headers only.' },
    auth: {
      oneOf: [
        { type: 'object', additionalProperties: false, required: ['scheme'], properties: { scheme: { const: 'bearer' } } },
        {
          type: 'object',
          additionalProperties: false,
          required: ['scheme', 'name'],
          properties: { scheme: { const: 'header' }, name: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['scheme', 'name'],
          properties: { scheme: { const: 'query' }, name: { type: 'string' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['scheme', 'username'],
          properties: { scheme: { const: 'basic' }, username: { type: 'string' } },
        },
      ],
    },
    method: { enum: ['GET', 'POST'], default: 'GET' },
    body: { description: 'JSON body for POST polls.' },
    timestamp: { type: 'string', description: 'Selector of the message timestamp (epoch ms or ISO 8601).' },
    events: { type: 'array', items: { type: 'string' }, description: 'SSE event names to accept.' },
    subscribe: { description: 'WebSocket: JSON sent after each (re)connect.' },
    protocols: { type: 'array', items: { type: 'string' } },
    write: {
      type: 'object',
      additionalProperties: false,
      properties: {
        method: { enum: ['POST', 'PUT', 'PATCH'], default: 'POST' },
        url: { type: 'string', description: 'Path or same-origin URL; {source} and {selector} are substituted.' },
        body: { enum: ['envelope', 'value'], default: 'envelope' },
      },
    },
    maxBytes: { type: 'integer', minimum: 1, default: HTTP_DEFAULTS.maxBytes },
    followRedirects: { type: 'boolean', default: false },
  },
});
