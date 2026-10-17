/**
 * Request plumbing shared by polling, SSE, reads, browse and writes: URL
 * resolution with the same-origin rule, auth, timeouts, size-limited bodies.
 */

import type { HttpConnectionConfig } from './config';
import { errorMessage, safeUrl, type Redactor } from './redact';

/** Why a request or message failed; `kind` drives status messages and tests. */
export type FailureKind = 'network' | 'timeout' | 'http-status' | 'too-large' | 'malformed' | 'content-type' | 'closed' | 'unsupported';

export class HttpProviderError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpProviderError';
  }
}

/** Resolved auth material for one session (secrets already fetched). */
export interface AuthMaterial {
  headers: Record<string, string>;
  query?: { name: string; value: string };
}

/** `ws:` → `http:`, `wss:` → `https:`; other schemes unchanged. */
export function httpEquivalent(url: URL): URL {
  const out = new URL(url.href);
  if (out.protocol === 'ws:') out.protocol = 'http:';
  else if (out.protocol === 'wss:') out.protocol = 'https:';
  return out;
}

/**
 * URL of an endpoint path on the connection's origin. `''` is the connection
 * URL itself. The result must stay on the same origin: documents choose
 * endpoints, and they must not be able to send this connection's credentials
 * anywhere else.
 */
export function resolveEndpoint(config: HttpConnectionConfig, endpoint: string): URL {
  const base = new URL(config.url);
  if (endpoint === '') return base;
  const url = new URL(endpoint, base);
  if (url.origin !== base.origin) throw new HttpProviderError(`endpoint "${endpoint}" leaves the connection origin`, 'network');
  return url;
}

/** Write target for a source (template `{source}` / `{selector}`), on the connection's (HTTP) origin. */
export function resolveWriteUrl(config: HttpConnectionConfig, source: string, selector: string): URL {
  const base = httpEquivalent(new URL(config.url));
  const template = config.write?.url;
  if (template === undefined) return base;
  const filled = template
    .replace(/\{source\}/g, encodeURIComponent(source))
    .replace(/\{selector\}/g, encodeURIComponent(selector));
  const url = new URL(filled, base);
  if (url.origin !== base.origin) throw new HttpProviderError('write.url leaves the connection origin', 'network');
  return url;
}

export function withAuthQuery(url: URL, auth: AuthMaterial): URL {
  if (!auth.query) return url;
  const out = new URL(url.href);
  out.searchParams.set(auth.query.name, auth.query.value);
  return out;
}

export interface RequestDeps {
  fetch: typeof fetch;
  config: HttpConnectionConfig;
  auth: AuthMaterial;
  redact: Redactor;
  /** Aborted when the session closes or the caller gives up (channel stopped). */
  signal: AbortSignal;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** Origin allowlist check applied to every redirect hop (provider `origins`). */
  allowOrigin?: (origin: string) => boolean;
}

export interface RequestOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  /**
   * `true`: the timeout covers only receiving the response headers (streams).
   * Default: it covers the whole body too.
   */
  headersOnlyTimeout?: boolean;
}

/**
 * fetch() with auth, timeout, redirect policy and redacted errors. Returns
 * the response plus a `done()` that clears the timeout and detaches abort
 * listeners (call it when the body has been consumed or abandoned).
 */
export async function request(
  deps: RequestDeps,
  url: URL,
  options: RequestOptions = {},
): Promise<{ response: Response; signal: AbortSignal; done: () => void }> {
  const { config, auth, redact } = deps;
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (deps.signal.aborted) controller.abort();
  else deps.signal.addEventListener('abort', onAbort, { once: true });
  let timer: unknown = deps.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);
  const clear = () => {
    if (timer !== undefined) deps.clearTimeout(timer);
    timer = undefined;
  };
  const done = () => {
    clear();
    deps.signal.removeEventListener('abort', onAbort);
  };
  try {
    const response = await fetchFollowingRedirects(deps, url, options, controller.signal);
    if (options.headersOnlyTimeout) clear();
    return { response, signal: controller.signal, done };
  } catch (error) {
    done();
    if (error instanceof HttpProviderError) throw error;
    if (timedOut) throw new HttpProviderError(`${safeUrl(url)}: timed out after ${config.timeoutMs} ms`, 'timeout');
    if (deps.signal.aborted) throw new HttpProviderError('request cancelled', 'closed');
    throw new HttpProviderError(redact(`${safeUrl(url)}: ${errorMessage(error)}`), 'network');
  }
}

/** Most redirects followed for one request (fetch's own limit is 20; JSON APIs need far fewer). */
export const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * fetch with `redirect: 'manual'`, following redirects ourselves (holodeck#89
 * review, P1). The built-in `redirect: 'follow'` strips only `Authorization`
 * on a cross-origin hop: custom auth headers (`X-API-Key`) and a query token
 * would reach the other origin. Here:
 *
 * - credentials (auth headers, the auth query parameter) are sent only while
 *   every hop so far has stayed on the connection's origin; once a hop leaves
 *   it, no later hop gets them, even one that comes back;
 * - the auth query parameter is removed from cross-origin `Location`s, in case
 *   the server echoed it;
 * - each hop must be http(s) and, with an origin allowlist, inside it;
 * - at most `MAX_REDIRECTS` hops; 303 (and 301/302 after POST) become a GET
 *   without a body, 307/308 keep method and body, as fetch does.
 *
 * Browsers return an opaque response for manual redirects (no status, no
 * Location), so a redirect cannot be followed there: it is reported as an error.
 */
async function fetchFollowingRedirects(
  deps: RequestDeps,
  url: URL,
  options: RequestOptions,
  signal: AbortSignal,
): Promise<Response> {
  const { config, auth } = deps;
  const home = httpEquivalent(new URL(config.url)).origin;
  let current = url;
  let method = options.method ?? 'GET';
  let body = options.body;
  let trusted = current.origin === home;
  for (let hop = 0; ; hop++) {
    const headers: Record<string, string> = { accept: 'application/json', ...config.headers, ...options.headers };
    if (body === undefined) delete headers['content-type'];
    if (trusted) Object.assign(headers, auth.headers);
    const response = await deps.fetch(trusted ? withAuthQuery(current, auth) : current, {
      method,
      headers,
      body,
      signal,
      redirect: 'manual',
      // Credentials come from `auth` only; never send ambient browser cookies.
      credentials: 'omit',
    });
    const isRedirect = response.type === 'opaqueredirect' || REDIRECT_STATUSES.has(response.status);
    if (!isRedirect) return response;
    await response.body?.cancel().catch(() => {});
    const where = safeUrl(current);
    if (!config.followRedirects) {
      throw new HttpProviderError(`${where}: redirected (HTTP ${response.status}); set followRedirects to follow`, 'http-status', response.status);
    }
    if (response.type === 'opaqueredirect') {
      throw new HttpProviderError(`${where}: redirect cannot be inspected in this environment`, 'http-status');
    }
    if (hop >= MAX_REDIRECTS) throw new HttpProviderError(`${where}: too many redirects (more than ${MAX_REDIRECTS})`, 'http-status');
    const location = response.headers.get('location');
    if (!location) throw new HttpProviderError(`${where}: redirect without a Location header`, 'http-status', response.status);
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new HttpProviderError(`${where}: redirect to an invalid URL`, 'http-status', response.status);
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new HttpProviderError(`${where}: redirect to a URL that is not http(s)`, 'http-status', response.status);
    }
    if (deps.allowOrigin && !deps.allowOrigin(next.origin)) {
      throw new HttpProviderError(`${where}: redirect to ${next.origin}, which is not in this provider's allowed origins`, 'network');
    }
    if (next.origin !== home) {
      trusted = false;
      if (auth.query) next.searchParams.delete(auth.query.name);
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      if (method !== 'HEAD') method = 'GET';
      body = undefined;
    }
    current = next;
  }
}

/** Throw for non-2xx with a redacted, bounded message (no response body: it may echo secrets). */
export function assertOk(response: Response, url: URL): void {
  if (!response.ok) {
    throw new HttpProviderError(`${safeUrl(url)}: HTTP ${response.status}`, 'http-status', response.status);
  }
}

/**
 * Read a body as UTF-8 text, refusing more than `maxBytes` (checked against
 * Content-Length first, then while streaming, so a huge body is never buffered).
 */
export async function readLimitedText(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new HttpProviderError(`response is larger than ${maxBytes} bytes`, 'too-large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new HttpProviderError(`response is larger than ${maxBytes} bytes`, 'too-large');
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof HttpProviderError) throw error;
    if (signal?.aborted) throw new HttpProviderError('response body aborted (timeout or close)', 'timeout');
    throw new HttpProviderError(`reading response failed: ${errorMessage(error)}`, 'network');
  }
  return text + decoder.decode();
}

/** JSON.parse with a provider error that never quotes the payload (it may contain secrets or PII). */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpProviderError(`payload is not valid JSON (${text.length} characters)`, 'malformed');
  }
}

/** GET/POST the endpoint and parse JSON. Shared by polling, `read` and `browse`. */
export async function fetchJson(deps: RequestDeps, url: URL): Promise<unknown> {
  const { config } = deps;
  const isPost = config.mode === 'poll' && config.method === 'POST';
  const { response, signal, done } = await request(deps, url, {
    method: isPost ? 'POST' : 'GET',
    body: isPost && config.body !== undefined ? JSON.stringify(config.body) : undefined,
    headers: isPost && config.body !== undefined ? { 'content-type': 'application/json' } : undefined,
  });
  try {
    assertOk(response, url);
    const text = await readLimitedText(response, config.maxBytes, signal);
    return parseJson(text);
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    throw error;
  } finally {
    done();
  }
}
