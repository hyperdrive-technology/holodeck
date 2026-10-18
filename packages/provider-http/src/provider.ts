/**
 * `holodeck.http`: a generic JSON provider (README.md; contract: @holodeck/sdk
 * docs/PACKAGING.md §6). External systems publish object state as JSON over
 * plain HTTP polling, Server-Sent Events or WebSocket; documents bind to
 * values inside those messages with JSON pointers or JSONPath-lite sources
 * (`selector.ts`). This is Holodeck's equivalent of Arcentry's "API" feature.
 *
 *   const provider = createHttpProvider();                       // any origin the user configures
 *   const locked = createHttpProvider({ origins: ['https://*.example.com'] });
 */

import {
  isOriginPattern,
  originMatches,
  type HolodeckProvider,
  type ProviderContext,
  type ProviderSession,
  type ProviderStatus,
  type Sample,
  type SignalNode,
  type SignalValue,
} from '@holodeck/sdk';
import { createChannel, type Channel, type ChannelState, type WebSocketFactory, type WebSocketLike } from './channels';
import {
  HTTP_CONFIG_SCHEMA,
  HTTP_PROVIDER_SECRETS,
  isSignalValue,
  parseHttpConfig,
  timestampTokens,
  toEpochMs,
  type HttpConnectionConfig,
} from './config';
import {
  assertOk,
  fetchJson,
  httpEquivalent,
  HttpProviderError,
  request,
  resolveEndpoint,
  redactError,
  resolveWriteUrl,
  type AuthMaterial,
  type RequestDeps,
} from './http';
import { createRedactor, errorMessage, safeUrl, type Redactor } from './redact';
import { formatSource, lookup, parseSource, type ParsedSource } from './selector';

export const HTTP_PROVIDER_ID = 'holodeck.http';

export const HTTP_SOURCE_SYNTAX =
  '[/endpoint/path#]<JSON pointer> or $.json.path[0]["key"] — e.g. /pumps/0/rpm, $.pumps[0].rpm, /api/line2#/speed';

/** Most children `browse` lists for one node. */
export const MAX_BROWSE_CHILDREN = 500;
/** Most per-source values kept for `read` in streaming modes. */
const MAX_CACHED_SAMPLES = 10_000;
/** Most endpoint payloads kept after their channel stops (for `read`/`browse`). */
const MAX_CACHED_PAYLOADS = 64;

export interface HttpProviderOptions {
  /**
   * Allowed origins (`permissions.network` patterns such as
   * `https://*.example.com`, `wss://feed.example.com:8443`). When set,
   * `connect` refuses any URL outside them, and every redirect hop is checked against them.
   * Unset: the provider contacts whatever origin a connection names.
   */
  origins?: string[];
  /** WebSocket constructor wrapper. Default: the global `WebSocket` (browsers, Node ≥ 22). */
  webSocket?: WebSocketFactory;
  /** Timer functions (default: the globals, looked up at call time so fake timers work). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Random source for backoff jitter (default `Math.random`). */
  random?: () => number;
  /**
   * Most distinct endpoint channels (poll/SSE/WebSocket feeds) one session
   * keeps open; sources past the cap become `bad` samples with a logged
   * reason (default 32). A document can name any path on the connection
   * origin, and each distinct path opens its own authenticated channel.
   */
  maxChannels?: number;
  /**
   * Restrict the paths a document may address to this prefix (e.g. `/api/v1`),
   * matched on a path-segment boundary after `.`/`..` are resolved. The
   * connection URL itself must be inside it. Unset: any path on the origin.
   * Host-level on purpose: a prefix a document sets for itself is no boundary.
   */
  pathPrefix?: string;
  /**
   * Override browser detection (default: auto). `followRedirects` is refused
   * in browsers, where `redirect: 'manual'` yields an opaque response (#98).
   */
  browser?: boolean;
}

export const DEFAULT_MAX_CHANNELS = 32;

/** Browser main thread or worker: no Node, and a DOM or worker global scope. */
function detectBrowser(): boolean {
  const g = globalThis as { process?: { versions?: { node?: string } }; document?: unknown; WorkerGlobalScope?: unknown };
  if (g.process?.versions?.node) return false;
  return g.document !== undefined || g.WorkerGlobalScope !== undefined;
}

/** Is `path` equal to `prefix` or below it, on a segment boundary? `prefix` has no trailing slash (except "/"). */
function pathInPrefix(path: string, prefix: string): boolean {
  return prefix === '/' || path === prefix || path.startsWith(prefix + '/');
}

interface Subscription {
  /** Endpoint URL href → the sources this subscription reads from it. */
  byEndpoint: Map<string, ParsedSource[]>;
  deliver(samples: Sample[]): void;
}

interface ChannelEntry {
  channel: Channel;
  state: ChannelState;
  message?: string;
  subs: Set<Subscription>;
}

const defaultWebSocket = (): WebSocketFactory | undefined => {
  const Ctor = (globalThis as { WebSocket?: new (url: string, protocols?: string[]) => WebSocketLike }).WebSocket;
  return Ctor ? (url, protocols) => new Ctor(url, protocols) : undefined;
};

function signalType(value: unknown): SignalNode['type'] {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return undefined;
}

/** Bounded insertion-ordered map: the oldest key goes first. */
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}

export function createHttpProvider(options: HttpProviderOptions = {}): HolodeckProvider {
  const origins = options.origins ? [...options.origins] : undefined;
  if (origins) {
    const bad = origins.filter((o) => !isOriginPattern(o));
    if (bad.length) throw new TypeError(`createHttpProvider: invalid origin pattern(s): ${bad.join(', ')}`);
  }
  if (options.maxChannels !== undefined && !(Number.isInteger(options.maxChannels) && options.maxChannels >= 1)) {
    throw new TypeError('createHttpProvider: maxChannels must be a positive integer');
  }
  if (options.pathPrefix !== undefined && !/^\/[^?#\s]*$/.test(options.pathPrefix)) {
    throw new TypeError('createHttpProvider: pathPrefix must be an absolute path such as "/api/v1"');
  }
  const provider: HolodeckProvider = {
    id: HTTP_PROVIDER_ID,
    label: 'HTTP / JSON',
    description: 'JSON from HTTP polling, Server-Sent Events or WebSocket; optional writes over HTTP.',
    capabilities: { read: true, write: true, browse: true },
    sourceSyntax: HTTP_SOURCE_SYNTAX,
    configSchema: HTTP_CONFIG_SCHEMA,
    secrets: HTTP_PROVIDER_SECRETS.map((s) => ({ ...s })),
    connect: (config, ctx) => connectHttp(config, ctx, options, origins),
  };
  if (origins) provider.origins = origins;
  return provider;
}

function checkOrigins(config: HttpConnectionConfig, origins: string[] | undefined): void {
  if (!origins) return;
  const base = new URL(config.url);
  const targets = [base];
  if (config.write) targets.push(httpEquivalent(base));
  for (const url of targets) {
    if (!origins.some((pattern) => originMatches(pattern, url.origin))) {
      throw new HttpProviderError(`origin ${url.origin} is not in this provider's allowed origins`, 'network');
    }
  }
}

async function resolveAuth(config: HttpConnectionConfig, ctx: ProviderContext, redact: Redactor): Promise<AuthMaterial> {
  const auth = config.auth;
  if (!auth) return { headers: {} };
  const key = auth.scheme === 'basic' ? 'password' : 'token';
  const secret = await ctx.secret(key);
  if (secret === undefined || secret === '') {
    throw new HttpProviderError(`auth scheme "${auth.scheme}" needs the secret "${key}"`, 'network');
  }
  if (/[\r\n\0]/.test(secret) && auth.scheme !== 'query') {
    throw new HttpProviderError(`secret "${key}" must be a single line`, 'network');
  }
  redact.add(secret);
  switch (auth.scheme) {
    case 'bearer':
      return { headers: { authorization: `Bearer ${secret}` } };
    case 'header':
      return { headers: { [auth.name]: secret } };
    case 'query':
      return { headers: {}, query: { name: auth.name, value: secret } };
    case 'basic': {
      const bytes = new TextEncoder().encode(`${auth.username}:${secret}`);
      const token = btoa(String.fromCharCode(...bytes));
      redact.add(token);
      return { headers: { authorization: `Basic ${token}` } };
    }
  }
}

/**
 * Single exit point for errors (holodeck#89 review): every error `connect`
 * or a session method throws to a caller is rebuilt by `redactError`, so a
 * secret that reached a message by any path (a server-controlled redirect
 * path, a fetch error quoting a header, a caller's own source string) never
 * leaves the provider. Logs and status messages are redacted where they are
 * emitted (`log`, `recomputeStatus`, `RetryingChannel.failed`).
 */
async function connectHttp(
  rawConfig: Record<string, unknown>,
  ctx: ProviderContext,
  options: HttpProviderOptions,
  origins: string[] | undefined,
): Promise<ProviderSession> {
  const redact = createRedactor();
  try {
    return guardSession(await openSession(rawConfig, ctx, options, origins, redact), redact);
  } catch (error) {
    throw redactError(error, redact);
  }
}

/** Wrap every promise-returning session method so its rejections are redacted. */
function guardSession(session: ProviderSession, redact: Redactor): ProviderSession {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        throw redactError(error, redact);
      }
    };
  const guarded: ProviderSession = { ...session };
  if (session.read) guarded.read = guard(session.read);
  if (session.write) guarded.write = guard(session.write);
  if (session.browse) guarded.browse = guard(session.browse);
  guarded.close = guard(session.close);
  return guarded;
}

async function openSession(
  rawConfig: Record<string, unknown>,
  ctx: ProviderContext,
  options: HttpProviderOptions,
  origins: string[] | undefined,
  redact: Redactor,
): Promise<ProviderSession> {
  const config = parseHttpConfig(rawConfig);
  checkOrigins(config, origins);
  if (config.followRedirects && (options.browser ?? detectBrowser())) {
    throw new HttpProviderError(
      'followRedirects is not supported in browsers (a manual redirect is opaque there, so no redirect can be followed); ' +
        'use it only on Node/hosts, or point the connection at the final URL',
      'unsupported',
    );
  }
  const maxChannels = options.maxChannels ?? DEFAULT_MAX_CHANNELS;
  // Normalised: no trailing slash, so "/api/" and "/api" mean the same.
  const pathPrefix = options.pathPrefix === undefined ? undefined : options.pathPrefix.replace(/\/+$/, '') || '/';
  if (pathPrefix !== undefined && !pathInPrefix(new URL(config.url).pathname, pathPrefix)) {
    throw new HttpProviderError(`connection URL path is outside this provider's pathPrefix ${pathPrefix}`, 'network');
  }
  const auth = await resolveAuth(config, ctx, redact);
  const tsTokens = timestampTokens(config);
  const streaming = config.mode !== 'poll';

  const setTimer = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const controller = new AbortController();
  const log = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => {
    try {
      ctx.log(level, redact(message));
    } catch {
      /* a host logger must not break the provider */
    }
  };
  const requestDeps = (): RequestDeps => ({
    fetch: ctx.fetch,
    config,
    auth,
    redact,
    signal: controller.signal,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    allowOrigin: origins ? (origin) => origins.some((pattern) => originMatches(pattern, origin)) : undefined,
  });

  const statusListeners = new Set<(s: ProviderStatus) => void>();
  const channels = new Map<string, ChannelEntry>();
  // Both caches carry the receipt sequence number of the payload they came
  // from, so "current value" is always the newest one seen, whichever path
  // (subscription, read, browse) brought it in (holodeck#89 review).
  const payloads = new Map<string, { json: unknown; ts: number; seq: number }>();
  const sampleCache = new Map<string, { sample: Sample; seq: number }>();
  let seq = 0;
  const subscriptions = new Set<() => void>();
  let status: ProviderStatus = { state: 'live', message: 'idle', since: ctx.now() };
  let closed = false;

  const setStatus = (state: ProviderStatus['state'], message?: string) => {
    if (status.state === state && status.message === message) return;
    status = message === undefined ? { state, since: ctx.now() } : { state, message, since: ctx.now() };
    for (const listener of [...statusListeners]) {
      try {
        listener(status);
      } catch (error) {
        log('error', `holodeck.http status listener threw: ${errorMessage(error)}`);
      }
    }
  };

  /** Session status = the worst channel state (error > stale > connecting > live). */
  const recomputeStatus = () => {
    if (closed) return;
    if (channels.size === 0) {
      setStatus('live', 'idle');
      return;
    }
    const rank: Record<ChannelState, number> = { live: 0, connecting: 1, stale: 2, error: 3 };
    let worst: [string, ChannelEntry] | undefined;
    for (const pair of channels) if (!worst || rank[pair[1].state] > rank[worst[1].state]) worst = pair;
    const [href, entry] = worst as [string, ChannelEntry];
    const prefix = channels.size > 1 ? `${safeUrl(href)}: ` : '';
    setStatus(entry.state, entry.message === undefined ? undefined : redact(prefix + entry.message));
  };

  const sampleFor = (parsed: ParsedSource, json: unknown, ts: number, partial: boolean): Sample | undefined => {
    const hit = lookup(json, parsed.tokens);
    if (!hit.found) return partial ? undefined : { source: parsed.source, value: null, ts, quality: 'bad' };
    if (isSignalValue(hit.value)) return { source: parsed.source, value: hit.value, ts };
    // Objects and arrays are not signal values: bind a deeper selector instead.
    return { source: parsed.source, value: null, ts, quality: 'bad' };
  };

  const remember = (samples: readonly Sample[], from: number) => {
    for (const sample of samples) {
      const prev = sampleCache.get(sample.source);
      if (!prev || prev.seq <= from) setBounded(sampleCache, sample.source, { sample, seq: from }, MAX_CACHED_SAMPLES);
    }
  };

  /** Record a payload for an endpoint: timestamp from the `timestamp` selector, next sequence number. */
  const storePayload = (href: string, json: unknown, receivedAt: number, requestSeq?: number) => {
    let ts = receivedAt;
    if (tsTokens) {
      const hit = lookup(json, tsTokens);
      const parsed = hit.found ? toEpochMs(hit.value) : undefined;
      if (parsed !== undefined) ts = parsed;
    }
    // Request order, not arrival order: a response to an older request that
    // lands late must not displace a newer payload (#97).
    const record = { json, ts, seq: requestSeq ?? ++seq };
    const existing = payloads.get(href);
    if (!existing || existing.seq <= record.seq) setBounded(payloads, href, record, MAX_CACHED_PAYLOADS);
    return { ...record, stale: existing !== undefined && existing.seq > record.seq };
  };

  /**
   * The newest known sample for a source: from the endpoint's latest payload
   * when that is at least as new as the cached sample and contains the source
   * (or, `partial` false, says it is missing); otherwise the cached sample.
   */
  const currentSample = (parsed: ParsedSource, href: string, partial: boolean): Sample | undefined => {
    const cached = sampleCache.get(parsed.source);
    const payload = payloads.get(href);
    const fromPayload = payload && sampleFor(parsed, payload.json, payload.ts, partial);
    if (fromPayload && (!cached || payload.seq >= cached.seq)) {
      // Cache what we answer with, so a later payload that lacks this source
      // (a partial update) cannot make the next read fall back to older data (#105).
      remember([fromPayload], payload.seq);
      return fromPayload;
    }
    return cached?.sample ?? fromPayload;
  };

  const onPayload = (href: string, json: unknown, receivedAt: number, requestSeq?: number) => {
    if (closed) return;
    const { ts, seq: from, stale } = storePayload(href, json, receivedAt, requestSeq);
    if (stale) return; // a newer request already answered; do not deliver older data after it
    const entry = channels.get(href);
    if (!entry) return;
    for (const sub of [...entry.subs]) {
      if (!entry.subs.has(sub)) continue; // unsubscribed by an earlier callback
      const samples: Sample[] = [];
      for (const parsed of sub.byEndpoint.get(href) ?? []) {
        const sample = sampleFor(parsed, json, ts, streaming);
        if (sample) samples.push(sample);
      }
      if (samples.length) {
        remember(samples, from);
        sub.deliver(samples);
      }
    }
  };

  const openChannel = (href: string): ChannelEntry => {
    const url = new URL(href);
    const entry: ChannelEntry = { state: 'connecting', subs: new Set(), channel: undefined as unknown as Channel };
    entry.channel = createChannel(
      url,
      {
        ...requestDeps(),
        sessionSignal: controller.signal,
        now: () => ctx.now(),
        random: options.random ?? Math.random,
        webSocket: options.webSocket ?? defaultWebSocket(),
        sink: {
          payload: (json, receivedAt, requestSeq) => onPayload(href, json, receivedAt, requestSeq),
          begin: () => ++seq,
          state: (state, message) => {
            if (channels.get(href) !== entry) return;
            entry.state = state;
            entry.message = message;
            recomputeStatus();
          },
          log,
        },
      },
      auth,
      config,
    );
    channels.set(href, entry);
    return entry;
  };

  const ensureOpen = (method: string) => {
    if (closed) throw new HttpProviderError(`holodeck.http: ${method}() on a closed session`, 'closed');
  };

  /** Group sources by endpoint URL; unparsable ones become `bad` samples. */
  const group = (sources: readonly string[]) => {
    const byEndpoint = new Map<string, ParsedSource[]>();
    const invalid: Sample[] = [];
    const ts = ctx.now();
    let newEndpoints = 0; // endpoints this call would open beyond the live channels
    for (const source of sources) {
      try {
        const parsed = parseSource(source);
        const url = resolveEndpoint(config, parsed.endpoint);
        const href = url.href;
        if (pathPrefix !== undefined && !pathInPrefix(url.pathname, pathPrefix)) {
          throw new HttpProviderError(`endpoint path is outside this provider's pathPrefix ${pathPrefix}`, 'network');
        }
        if (!byEndpoint.has(href) && !channels.has(href) && channels.size + newEndpoints >= maxChannels) {
          throw new HttpProviderError(`channel limit reached (${maxChannels} endpoints per session)`, 'unsupported');
        }
        if (!byEndpoint.has(href) && !channels.has(href)) newEndpoints++;
        const list = byEndpoint.get(href) ?? [];
        list.push(parsed);
        byEndpoint.set(href, list);
      } catch (error) {
        log('warn', `holodeck.http: source "${String(source).slice(0, 200)}" ignored: ${errorMessage(error)}`);
        invalid.push({ source, value: null, ts, quality: 'bad' });
      }
    }
    return { byEndpoint, invalid };
  };

  const session: ProviderSession = {
    status: () => status,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    subscribe(sources, onSamples) {
      if (closed) return () => {};
      const { byEndpoint, invalid } = group([...sources]);
      let active = true;
      const sub: Subscription = {
        byEndpoint,
        deliver(samples) {
          if (!active || closed) return;
          try {
            onSamples(samples);
          } catch (error) {
            log('error', `holodeck.http subscriber threw: ${errorMessage(error)}`);
          }
        },
      };
      const initial: Sample[] = [...invalid];
      for (const [href, list] of byEndpoint) {
        const entry = channels.get(href) ?? openChannel(href);
        const fresh = entry.subs.size === 0;
        entry.subs.add(sub);
        if (fresh) entry.channel.start();
        // First delivery includes current values when we have them.
        for (const parsed of list) {
          const sample = currentSample(parsed, href, streaming);
          if (sample) initial.push(sample);
        }
      }
      recomputeStatus();
      if (initial.length) queueMicrotask(() => sub.deliver(initial));

      const stop = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(stop);
        for (const href of byEndpoint.keys()) {
          const entry = channels.get(href);
          if (!entry) continue;
          entry.subs.delete(sub);
          if (entry.subs.size === 0) {
            channels.delete(href);
            entry.channel.stop();
          }
        }
        recomputeStatus();
      };
      subscriptions.add(stop);
      return stop;
    },

    async read(sources) {
      ensureOpen('read');
      const { byEndpoint, invalid } = group([...sources]);
      const out: Sample[] = [...invalid];
      await Promise.all(
        [...byEndpoint].map(async ([href, list]) => {
          if (streaming) {
            for (const parsed of list) {
              out.push(currentSample(parsed, href, true) ?? { source: parsed.source, value: null, ts: ctx.now(), quality: 'uncertain' });
            }
            return;
          }
          const requestSeq = ++seq; // taken before the request starts (#97)
          try {
            const json = await fetchJson(requestDeps(), new URL(href));
            // Same sample builder as subscriptions: `timestamp` selector, sequence number.
            const record = storePayload(href, json, ctx.now(), requestSeq);
            const samples = list.map((parsed) => sampleFor(parsed, record.json, record.ts, false) as Sample);
            remember(samples, record.seq);
            out.push(...samples);
          } catch (error) {
            log('warn', `holodeck.http read ${safeUrl(href)} failed: ${errorMessage(error)}`);
            const ts = ctx.now();
            for (const parsed of list) out.push({ source: parsed.source, value: null, ts, quality: 'bad' });
          }
        }),
      );
      // Same order as requested.
      const order = new Map(sources.map((s, i) => [s, i]));
      return out.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));
    },

    async write(source, value: SignalValue) {
      ensureOpen('write');
      if (!config.write) throw new HttpProviderError('holodeck.http: this connection has no write settings', 'unsupported');
      if (!isSignalValue(value)) throw new TypeError('holodeck.http: value must be a number, string, boolean or null');
      const parsed = parseSource(source);
      const selector = source.startsWith('$') || !source.includes('#') ? source : source.slice(source.indexOf('#') + 1);
      const url = resolveWriteUrl(config, source, selector);
      const body = config.write.body === 'value' ? JSON.stringify(value) : JSON.stringify({ source: parsed.source, value });
      const { response, done } = await request(requestDeps(), url, {
        method: config.write.method,
        body,
        headers: { 'content-type': 'application/json' },
      });
      try {
        assertOk(response, url);
      } finally {
        // The response body is not used (and never logged: it may echo the request).
        await response.body?.cancel().catch(() => {});
        done();
      }
    },

    async browse(path) {
      ensureOpen('browse');
      const parsed = parseSource(path ?? '');
      const url = resolveEndpoint(config, parsed.endpoint);
      let json: unknown;
      if (streaming) {
        json = payloads.get(url.href)?.json;
        if (json === undefined) return [];
      } else {
        json = await fetchJson(requestDeps(), url);
        storePayload(url.href, json, ctx.now());
      }
      const hit = lookup(json, parsed.tokens);
      if (!hit.found || hit.value === null || typeof hit.value !== 'object') return [];
      const entries: Array<[string | number, unknown]> = Array.isArray(hit.value)
        ? hit.value.map((v, i) => [i, v])
        : Object.entries(hit.value as Record<string, unknown>);
      return entries.slice(0, MAX_BROWSE_CHILDREN).map(([key, value]): SignalNode => {
        const child = formatSource(parsed.endpoint, [...parsed.tokens, key]);
        const label = String(key);
        if (value !== null && typeof value === 'object') return { path: child, label, hasChildren: true };
        const node: SignalNode = { path: child, label, source: child, writable: Boolean(config.write) };
        const type = signalType(value);
        if (type) node.type = type;
        return node;
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const stop of [...subscriptions]) stop();
      for (const entry of channels.values()) entry.channel.stop();
      channels.clear();
      controller.abort();
      // `closed` already set, so call the setter directly.
      status = { state: 'disconnected', since: ctx.now() };
      for (const listener of [...statusListeners]) {
        try {
          listener(status);
        } catch (error) {
          log('error', `holodeck.http status listener threw: ${errorMessage(error)}`);
        }
      }
    },
  };

  if (ctx.signal.aborted) await session.close();
  else ctx.signal.addEventListener('abort', () => void session.close(), { once: true });
  return session;
}
