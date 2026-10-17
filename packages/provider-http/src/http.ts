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
  const target = withAuthQuery(url, auth);
  try {
    const response = await deps.fetch(target, {
      method: options.method ?? 'GET',
      headers: { accept: 'application/json', ...config.headers, ...options.headers, ...auth.headers },
      body: options.body,
      signal: controller.signal,
      redirect: config.followRedirects ? 'follow' : 'error',
      // Credentials come from `auth` only; never send ambient browser cookies.
      credentials: 'omit',
    });
    if (options.headersOnlyTimeout) clear();
    return { response, signal: controller.signal, done };
  } catch (error) {
    done();
    if (timedOut) throw new HttpProviderError(`${safeUrl(url)}: timed out after ${config.timeoutMs} ms`, 'timeout');
    if (deps.signal.aborted) throw new HttpProviderError('request cancelled', 'closed');
    throw new HttpProviderError(redact(`${safeUrl(url)}: ${errorMessage(error)}`), 'network');
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
