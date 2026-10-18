/**
 * Channels: one live feed per endpoint URL. A channel exists while at least
 * one subscription needs its endpoint and is torn down (timer cleared, fetch
 * aborted, socket closed) when the last one unsubscribes, so nothing keeps
 * running for a source nobody watches.
 *
 *   PollChannel       GET/POST every `intervalMs`, next request after the previous finishes
 *   SseChannel        fetch + text/event-stream (eventsource-parser), Last-Event-ID on reconnect
 *   WebSocketChannel  JSON text/binary messages, optional `subscribe` message after open
 *
 * All three retry with exponential backoff (`backoff.ts`). State reported to
 * the session: `connecting` (first attempt), `live` (data flowing), `stale`
 * (was live, now failing and retrying; old values kept), `error` (never got
 * data; retrying).
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { backoffDelay } from './backoff';
import type { HttpConnectionConfig } from './config';
import {
  assertOk,
  fetchJson,
  HttpProviderError,
  parseJson,
  request,
  withAuthQuery,
  type AuthMaterial,
  type RequestDeps,
} from './http';
import { errorMessage, safeUrl } from './redact';
import { SseIdTracker } from './sse-id';

export type ChannelState = 'connecting' | 'live' | 'stale' | 'error';

export interface ChannelSink {
  /** A parsed JSON message (poll response, SSE event data, WebSocket message). */
  payload(json: unknown, receivedAt: number, seq?: number): void;
  /**
   * Take a sequence number for a request that is about to start (holodeck#97):
   * pass it back to `payload` so "newest" follows request order, not the
   * order responses happen to arrive in.
   */
  begin(): number;
  state(state: ChannelState, message?: string): void;
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void;
}

/** Minimal WebSocket surface (browser `WebSocket`, Node 22+ global `WebSocket`, or a test fake). */
export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: (event: unknown) => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export type WebSocketFactory = (url: string, protocols?: string[]) => WebSocketLike;

export interface ChannelDeps extends Omit<RequestDeps, 'signal'> {
  sink: ChannelSink;
  now(): number;
  random(): number;
  webSocket?: WebSocketFactory;
  /** The session's signal; the channel derives its own on top. */
  sessionSignal: AbortSignal;
}

export interface Channel {
  readonly url: URL;
  start(): void;
  stop(): void;
}

abstract class RetryingChannel implements Channel {
  protected stopped = false;
  protected failures = 0;
  protected everLive = false;
  private timer: unknown;
  protected controller = new AbortController();
  private readonly onSessionAbort = () => this.stop();

  constructor(
    readonly url: URL,
    protected readonly deps: ChannelDeps,
  ) {}

  protected get requestDeps(): RequestDeps {
    return { ...this.deps, signal: this.controller.signal };
  }

  start(): void {
    if (this.deps.sessionSignal.aborted) {
      this.stopped = true;
      return;
    }
    this.deps.sessionSignal.addEventListener('abort', this.onSessionAbort, { once: true });
    this.deps.sink.state('connecting');
    void this.attempt();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    this.controller.abort();
    this.deps.sessionSignal.removeEventListener('abort', this.onSessionAbort);
    this.teardown();
  }

  /** One connection attempt / poll. Must not throw. */
  protected abstract attempt(): Promise<void>;
  /** Release transport resources (socket, stream). */
  protected teardown(): void {}

  protected schedule(delayMs: number): void {
    if (this.stopped) return;
    this.clearTimer();
    this.timer = this.deps.setTimeout(() => {
      this.timer = undefined;
      if (!this.stopped) void this.attempt();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) this.deps.clearTimeout(this.timer);
    this.timer = undefined;
  }

  protected markLive(): void {
    this.everLive = true;
    this.deps.sink.state('live');
  }

  /** Data arrived: the feed is healthy again. */
  protected succeeded(): void {
    this.failures = 0;
    this.markLive();
  }

  /** Report a failure and return the backoff delay before the next attempt. */
  protected failed(error: unknown, minDelayMs = 0, firstDelayMs?: number): number {
    this.failures++;
    const delay =
      this.failures === 1 && firstDelayMs !== undefined
        ? Math.min(firstDelayMs, this.deps.config.backoff.maxMs)
        : backoffDelay(this.failures, this.deps.config.backoff, this.deps.random);
    const wait = Math.max(minDelayMs, delay);
    const reason = this.deps.redact(errorMessage(error));
    this.deps.sink.state(this.everLive ? 'stale' : 'error', `${reason}; retrying in ${wait} ms`);
    this.deps.sink.log('warn', `holodeck.http ${safeUrl(this.url)}: ${reason} (attempt ${this.failures}, retry in ${wait} ms)`);
    return wait;
  }

  /** Deliver a raw text message: size check, JSON parse, malformed messages logged and skipped. */
  protected handleText(text: string): boolean {
    const { maxBytes } = this.deps.config;
    // UTF-16 length ≤ UTF-8 bytes ≤ 3 × length: only encode when it could matter.
    if (text.length > maxBytes || (text.length * 3 > maxBytes && new TextEncoder().encode(text).byteLength > maxBytes)) {
      this.deps.sink.log('warn', `holodeck.http ${safeUrl(this.url)}: message larger than ${maxBytes} bytes ignored`);
      return false;
    }
    let json: unknown;
    try {
      json = parseJson(text);
    } catch (error) {
      this.deps.sink.log('warn', `holodeck.http ${safeUrl(this.url)}: ${errorMessage(error)}; message ignored`);
      return false;
    }
    if (this.failures > 0 || !this.everLive) this.succeeded();
    this.deps.sink.payload(json, this.deps.now());
    return true;
  }
}

export class PollChannel extends RetryingChannel {
  protected async attempt(): Promise<void> {
    let json: unknown;
    const seq = this.deps.sink.begin();
    try {
      json = await fetchJson(this.requestDeps, this.url);
    } catch (error) {
      if (this.stopped) return;
      this.schedule(this.failed(error, this.deps.config.intervalMs));
      return;
    }
    if (this.stopped) return;
    this.succeeded();
    this.deps.sink.payload(json, this.deps.now(), seq);
    this.schedule(this.deps.config.intervalMs);
  }
}

export class SseChannel extends RetryingChannel {
  // Same line limit as the parser's buffer, so the two scanners agree on what is too long (#103).
  private readonly ids = new SseIdTracker(this.deps.config.maxBytes);
  private serverRetryMs: number | undefined;

  protected async attempt(): Promise<void> {
    if (this.controller.signal.aborted) return;
    const deps = this.requestDeps;
    let error: unknown = new HttpProviderError('event stream ended', 'closed');
    try {
      const headers: Record<string, string> = { accept: 'text/event-stream', 'cache-control': 'no-cache' };
      if (this.ids.lastEventId !== '') headers['last-event-id'] = this.ids.lastEventId;
      const { response, signal, done } = await request(deps, this.url, { headers, headersOnlyTimeout: true });
      try {
        assertOk(response, this.url);
        const type = response.headers.get('content-type') ?? '';
        if (!/^text\/event-stream\b/i.test(type)) {
          throw new HttpProviderError(`${safeUrl(this.url)}: expected text/event-stream, got "${type.slice(0, 64)}"`, 'content-type');
        }
        if (!response.body) throw new HttpProviderError('event stream has no body', 'closed');
        this.markLive();
        await this.consume(response.body, signal);
      } finally {
        await response.body?.cancel().catch(() => {});
        done();
      }
    } catch (caught) {
      error = caught;
    }
    if (this.stopped) return;
    this.schedule(this.failed(error, 0, this.serverRetryMs));
  }

  private async consume(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const { events } = this.deps.config;
    const parser = createParser({
      maxBufferSize: this.deps.config.maxBytes,
      onEvent: (event: EventSourceMessage) => {
        // Event ids are tracked by SseIdTracker (it also sees id-only frames).
        if (this.stopped) return;
        const name = event.event ?? 'message';
        if (events && !events.includes(name)) return;
        this.handleText(event.data);
      },
      onRetry: (ms) => {
        if (Number.isFinite(ms) && ms >= 0) this.serverRetryMs = ms;
      },
      onError: (err) => {
        if (err.type === 'max-buffer-size-exceeded') {
          throw new HttpProviderError(`event larger than ${this.deps.config.maxBytes} bytes`, 'too-large');
        }
        // Unknown fields and bad retry values are ignored, as EventSource does.
      },
    });
    const reader = body.getReader();
    const decoder = new TextDecoder();
    this.ids.resetStream();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || this.stopped || signal.aborted) return;
        // `stream: true` keeps a multi-byte character split across chunks intact.
        const text = decoder.decode(value, { stream: true });
        // Parser first: if it throws (oversized event), events later in this
        // chunk were never delivered, so the id tracker must not advance past
        // them. Resuming from the previous chunk's id replays a few events,
        // which beats silently skipping them (#103).
        parser.feed(text);
        this.ids.feed(text);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
}

/** `WebSocket.OPEN` without relying on a global. */
const WS_OPEN = 1;

export class WebSocketChannel extends RetryingChannel {
  private socket: WebSocketLike | undefined;
  private openTimer: unknown;

  constructor(
    url: URL,
    deps: ChannelDeps,
    private readonly auth: AuthMaterial,
  ) {
    super(url, deps);
  }

  protected async attempt(): Promise<void> {
    const factory = this.deps.webSocket;
    if (!factory) {
      this.schedule(this.failed(new HttpProviderError('no WebSocket implementation available', 'network')));
      return;
    }
    let socket: WebSocketLike;
    try {
      socket = factory(withAuthQuery(this.url, this.auth).href, this.deps.config.protocols);
      socket.binaryType = 'arraybuffer';
    } catch (error) {
      this.schedule(this.failed(new HttpProviderError(this.deps.redact(errorMessage(error)), 'network')));
      return;
    }
    this.socket = socket;
    let opened = false;
    let finished = false;
    const current = () => this.socket === socket && !this.stopped;
    const finish = (error: unknown) => {
      if (finished) return;
      finished = true;
      this.clearOpenTimer();
      if (!current()) return;
      this.socket = undefined;
      this.schedule(this.failed(error));
    };
    this.openTimer = this.deps.setTimeout(() => {
      this.openTimer = undefined;
      if (opened || !current()) return;
      finish(new HttpProviderError(`${safeUrl(this.url)}: timed out after ${this.deps.config.timeoutMs} ms`, 'timeout'));
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    }, this.deps.config.timeoutMs);

    socket.addEventListener('open', () => {
      if (!current()) return;
      opened = true;
      this.clearOpenTimer();
      this.markLive();
      if (this.deps.config.subscribe !== undefined) {
        try {
          socket.send(JSON.stringify(this.deps.config.subscribe));
        } catch (error) {
          this.deps.sink.log('warn', `holodeck.http ${safeUrl(this.url)}: sending subscribe failed: ${this.deps.redact(errorMessage(error))}`);
        }
      }
    });
    socket.addEventListener('message', (event) => {
      if (!current()) return;
      const data = event.data;
      if (typeof data === 'string') this.handleText(data);
      else if (data instanceof ArrayBuffer) {
        if (data.byteLength > this.deps.config.maxBytes) {
          this.deps.sink.log('warn', `holodeck.http ${safeUrl(this.url)}: message larger than ${this.deps.config.maxBytes} bytes ignored`);
        } else this.handleText(new TextDecoder().decode(data));
      } else this.deps.sink.log('warn', `holodeck.http ${safeUrl(this.url)}: unsupported message type ignored`);
    });
    socket.addEventListener('close', (event) => {
      const code = (event as { code?: number }).code;
      finish(new HttpProviderError(`socket closed${code !== undefined ? ` (code ${code})` : ''}`, 'closed'));
    });
    socket.addEventListener('error', () => {
      // A close event follows an error; only report here if it never opened and close never comes.
      if (!opened && socket.readyState !== WS_OPEN) finish(new HttpProviderError(`${safeUrl(this.url)}: connection failed`, 'network'));
    });
  }

  private clearOpenTimer(): void {
    if (this.openTimer !== undefined) this.deps.clearTimeout(this.openTimer);
    this.openTimer = undefined;
  }

  protected teardown(): void {
    // Known limitation (Node 26 / undici, checked 2026-10-17): close() on a
    // socket still in CONNECTING fires `close` (1006) on the client but leaves
    // the TCP connection open until the server answers the upgrade. Browsers
    // abort the handshake. Nothing more can be done through the standard
    // WebSocket API; the channel ignores the socket from here on, so no events
    // or retries leak, only that half-open TCP socket on a server that never
    // answers. Probe: provider.ws.test.ts "closing while the socket is still connecting".
    this.clearOpenTimer();
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close(1000, 'unsubscribed');
    } catch {
      /* already closed */
    }
  }
}

export function createChannel(url: URL, deps: ChannelDeps, auth: AuthMaterial, config: HttpConnectionConfig): Channel {
  if (config.mode === 'sse') return new SseChannel(url, deps);
  if (config.mode === 'websocket') return new WebSocketChannel(url, deps, auth);
  return new PollChannel(url, deps);
}
