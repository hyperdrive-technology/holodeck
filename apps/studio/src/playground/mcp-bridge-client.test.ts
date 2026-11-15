/**
 * The playground tab's bridge client (mcp-bridge-client.ts) with a fake
 * `fetch` (the dev server's config endpoint) and a fake WebSocket class the
 * test drives: open, receive, drop. Fake timers for the reconnect backoff.
 *
 * What matters: a server without the bridge costs exactly one request and
 * never a socket; a bridge that restarts is found again; requests are
 * answered on the socket they came in on, and only while it is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_CONFIG_PATH, BridgeError, type BridgeClientConfig, type SessionInfo } from './bridge-protocol';
import { startBridgeClient, type BridgeClient, type BridgeClientOptions, type BridgeClientState } from './mcp-bridge-client';

const BACKOFF = [100, 200, 400] as const;
const CONFIG: BridgeClientConfig = { protocol: 1, url: 'ws://127.0.0.1:4321/', token: 'session-token' };
const INFO: SessionInfo = { documentId: 'playground', documentName: 'Playground', tab: 'edit' };

/** A WebSocket the test drives. Records what the client sends; `send` on a closed socket throws, like a browser's. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** Every socket constructed, oldest first (reset per test). */
  static all: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  readonly sent: string[] = [];
  closeCalls = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string) {
    if (this.readyState !== FakeSocket.OPEN) throw new Error(`send on a socket in state ${this.readyState}`);
    this.sent.push(data);
  }

  /** The client's own close: like a browser, the close event follows later (`drop`). */
  close() {
    this.closeCalls += 1;
    this.readyState = FakeSocket.CLOSING;
  }

  // --- test drivers ---
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.(new Event('open'));
  }
  receive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  /** The connection ends (bridge gone, or after `close()`): the close event. */
  drop() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const last = () => FakeSocket.all.at(-1)!;

// --- fake config endpoint ----------------------------------------------------

type Reply = Response | Error;
/** The few Response members the client reads (ok, status, headers, json). */
const fakeResponse = (ok: boolean, status: number, contentType: string, json: () => Promise<unknown>): Response =>
  ({ ok, status, headers: new Headers({ 'content-type': contentType }), json }) as unknown as Response;
const jsonReply = (body: unknown, status = 200): Response => fakeResponse(status >= 200 && status < 300, status, 'application/json; charset=utf-8', async () => body);
/** What a server without the bridge answers: the SPA fallback (index.html) with 200. */
const htmlReply = (): Response => fakeResponse(true, 200, 'text/html', () => Promise.reject(new SyntaxError('Unexpected token <')));
const statusReply = (status: number): Response => fakeResponse(false, status, 'text/plain', () => Promise.reject(new SyntaxError('no json')));

/** A fetch that answers from a queue; the last reply repeats once the queue is down to one. */
function fakeFetch(...replies: Reply[]) {
  const queue = [...replies];
  const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return Object.assign(fn, { push: (...more: Reply[]) => void queue.splice(0, queue.length, ...more) });
}

/** Let the client's promise chains (fetch, res.json, handler) run. */
async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

let clients: BridgeClient[] = [];
function start(options: Partial<BridgeClientOptions> & { fetch: BridgeClientOptions['fetch'] }) {
  const states: BridgeClientState[] = [];
  const handle = vi.fn<BridgeClientOptions['handle']>(async () => ({ ok: 1 }));
  let info = INFO;
  const client = startBridgeClient({
    info: () => info,
    handle,
    onState: (s) => states.push(s),
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    backoff: BACKOFF,
    ...options,
  });
  clients.push(client);
  return { client, states, handle, setInfo: (next: SessionInfo) => void (info = next) };
}

/** Start against a working bridge and open the socket. */
async function connected(options: Partial<BridgeClientOptions> = {}) {
  const fetch = fakeFetch(jsonReply(CONFIG));
  const c = start({ fetch, ...options });
  await flush();
  const socket = last();
  socket.open();
  return { ...c, fetch, socket };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  clients = [];
});
afterEach(() => {
  for (const c of clients) c.close();
  vi.useRealTimers();
});

describe('no bridge on this server', () => {
  it.each<[string, Reply]>([
    ['404', statusReply(404)],
    ['500', statusReply(500)],
    ['the SPA index.html (200, text/html)', htmlReply()],
    ['JSON with an error status', jsonReply({ error: 'x' }, 403)],
    ['a network error', new TypeError('Failed to fetch')],
  ])('%s on the first try: off after one request, never a socket, never a retry', async (_name, reply) => {
    const fetch = fakeFetch(reply);
    const { states } = start({ fetch });
    await flush();
    expect(states).toEqual(['connecting', 'off']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toEqual([]);
  });

  it('asks the config endpoint uncached, same-origin', async () => {
    const fetch = fakeFetch(statusReply(404));
    start({ fetch });
    await flush();
    expect(fetch).toHaveBeenCalledWith(BRIDGE_CONFIG_PATH, { cache: 'no-store', credentials: 'same-origin' });
  });
});

describe('config', () => {
  it.each<[string, unknown]>([
    ['another protocol version', { ...CONFIG, protocol: 2 }],
    ['localhost instead of 127.0.0.1', { ...CONFIG, url: 'ws://localhost:4321/' }],
    ['wss', { ...CONFIG, url: 'wss://127.0.0.1:4321/' }],
    ['a remote host', { ...CONFIG, url: 'ws://192.168.1.4:4321/' }],
    ['no trailing slash', { ...CONFIG, url: 'ws://127.0.0.1:4321' }],
    ['a path', { ...CONFIG, url: 'ws://127.0.0.1:4321/evil' }],
    ['a query', { ...CONFIG, url: 'ws://127.0.0.1:4321/?role=agent' }],
    ['no port', { ...CONFIG, url: 'ws://127.0.0.1/' }],
    ['a numeric token', { ...CONFIG, token: 42 }],
    ['no token', { protocol: 1, url: CONFIG.url }],
    ['null', null],
    ['an array', [CONFIG]],
  ])('%s: off, no socket, no retry', async (_name, body) => {
    const fetch = fakeFetch(jsonReply(body));
    const { states } = start({ fetch });
    await flush();
    expect(states).toEqual(['connecting', 'off']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toEqual([]);
  });

  it('connects as the session role with the URL-encoded token', async () => {
    const token = 'a+b/c=&role=agent';
    const fetch = fakeFetch(jsonReply({ ...CONFIG, token }));
    start({ fetch });
    await flush();
    expect(FakeSocket.all).toHaveLength(1);
    expect(last().url).toBe(`ws://127.0.0.1:4321/?role=session&token=${encodeURIComponent(token)}`);
    expect(new URL(last().url).searchParams.get('token')).toBe(token);
    expect(new URL(last().url).searchParams.getAll('role')).toEqual(['session']);
  });

  it('503 (bridge still starting): retrying, then connects on the next try', async () => {
    const fetch = fakeFetch(statusReply(503), jsonReply(CONFIG));
    const { states } = start({ fetch });
    await flush();
    expect(states).toEqual(['connecting', 'retrying']);
    expect(FakeSocket.all).toEqual([]);
    await vi.advanceTimersByTimeAsync(BACKOFF[0] - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    last().open();
    expect(states).toEqual(['connecting', 'retrying', 'connected']);
  });
});

describe('session', () => {
  it('connecting -> connected; hello with the tab info on open', async () => {
    const fetch = fakeFetch(jsonReply(CONFIG));
    const { states } = start({ fetch });
    await flush();
    expect(states).toEqual(['connecting']);
    // Nothing is sent before the socket opens.
    expect(last().sent).toEqual([]);
    last().open();
    expect(states).toEqual(['connecting', 'connected']);
    expect(last().messages()).toEqual([{ type: 'hello', protocol: 1, session: INFO }]);
  });

  it('update() sends hello again with the current info; a no-op before the socket opens', async () => {
    const fetch = fakeFetch(jsonReply(CONFIG));
    const { client, setInfo } = start({ fetch });
    client.update();
    await flush();
    client.update();
    expect(last().sent).toEqual([]);
    last().open();
    setInfo({ ...INFO, tab: 'viewer', documentName: 'Renamed' });
    client.update();
    expect(last().messages()).toEqual([
      { type: 'hello', protocol: 1, session: INFO },
      { type: 'hello', protocol: 1, session: { ...INFO, tab: 'viewer', documentName: 'Renamed' } },
    ]);
  });

  it('answers a request with the handler result under the same id', async () => {
    const { socket, handle } = await connected();
    handle.mockResolvedValueOnce({ etag: 'e1', document: { id: 'playground' } });
    socket.receive(JSON.stringify({ type: 'request', id: 'r1', method: 'state', params: { metrics: false } }));
    await flush();
    expect(handle).toHaveBeenCalledWith('state', { metrics: false });
    expect(socket.messages().at(-1)).toEqual({ type: 'response', id: 'r1', ok: true, result: { etag: 'e1', document: { id: 'playground' } } });
  });

  it('a request without params passes undefined', async () => {
    const { socket, handle } = await connected();
    socket.receive(JSON.stringify({ type: 'request', id: 'r2', method: 'screenshot' }));
    await flush();
    expect(handle).toHaveBeenCalledWith('screenshot', undefined);
  });

  it('a BridgeError from the handler becomes an error body with code and problems', async () => {
    const { socket, handle } = await connected();
    handle.mockRejectedValueOnce(new BridgeError('the playground scene changed since it was read', 'conflict', ['read it again']));
    socket.receive(JSON.stringify({ type: 'request', id: 'r3', method: 'apply', params: {} }));
    await flush();
    expect(socket.messages().at(-1)).toEqual({
      type: 'response',
      id: 'r3',
      ok: false,
      error: { message: 'the playground scene changed since it was read', code: 'conflict', problems: ['read it again'] },
    });
  });

  it('any other error is internal (and problems are left out when empty)', async () => {
    const { socket, handle } = await connected();
    handle.mockRejectedValueOnce(new TypeError('boom'));
    socket.receive(JSON.stringify({ type: 'request', id: 'r4', method: 'state' }));
    handle.mockRejectedValueOnce(new BridgeError('busy', 'busy'));
    socket.receive(JSON.stringify({ type: 'request', id: 'r5', method: 'state' }));
    await flush();
    const [r4, r5] = socket.messages().slice(-2);
    expect(r4).toEqual({ type: 'response', id: 'r4', ok: false, error: { message: 'boom', code: 'internal' } });
    expect(r5).toEqual({ type: 'response', id: 'r5', ok: false, error: { message: 'busy', code: 'busy' } });
  });

  it('answers concurrent requests in completion order, each under its own id', async () => {
    const { socket, handle } = await connected();
    let finishSlow!: (v: unknown) => void;
    handle.mockImplementationOnce(() => new Promise((done) => (finishSlow = done)));
    handle.mockResolvedValueOnce('fast');
    socket.receive(JSON.stringify({ type: 'request', id: 'slow', method: 'screenshot' }));
    socket.receive(JSON.stringify({ type: 'request', id: 'fast', method: 'state' }));
    await flush();
    finishSlow('slow');
    await flush();
    expect(socket.messages().slice(1).map((m) => [m.id, m.result])).toEqual([
      ['fast', 'fast'],
      ['slow', 'slow'],
    ]);
  });

  it.each<[string, unknown]>([
    ['not JSON', 'not json'],
    ['a response', JSON.stringify({ type: 'response', id: 'x', ok: true, result: 1 })],
    ['a hello', JSON.stringify({ type: 'hello', protocol: 1, session: INFO })],
    ['an unknown type', JSON.stringify({ type: 'event', id: 'x' })],
    ['a request without method', JSON.stringify({ type: 'request', id: 'x' })],
    ['a request without id', JSON.stringify({ type: 'request', method: 'state' })],
    ['a request with a numeric id', JSON.stringify({ type: 'request', id: 7, method: 'state' })],
    ['a request with an id over 64 characters', JSON.stringify({ type: 'request', id: 'i'.repeat(65), method: 'state' })],
    ['a request with a method over 64 characters', JSON.stringify({ type: 'request', id: 'x', method: 'm'.repeat(65) })],
    ['a JSON array', JSON.stringify([{ type: 'request', id: 'x', method: 'state' }])],
    ['binary data', new ArrayBuffer(8)],
    ['a Blob', new Blob(['{"type":"request","id":"x","method":"state"}'])],
  ])('ignores %s', async (_name, data) => {
    const { socket, handle } = await connected();
    socket.receive(data);
    await flush();
    expect(handle).not.toHaveBeenCalled();
    expect(socket.sent).toHaveLength(1); // the hello only
  });

  it('does not answer on a socket that closed while the handler ran', async () => {
    const { socket, handle } = await connected();
    let finish!: (v: unknown) => void;
    handle.mockImplementationOnce(() => new Promise((done) => (finish = done)));
    socket.receive(JSON.stringify({ type: 'request', id: 'late', method: 'state' }));
    await flush();
    socket.drop();
    finish({ etag: 'e' });
    await flush();
    expect(socket.sent).toHaveLength(1); // the hello only; no send on the closed socket (the fake would throw)
  });

  it('a late answer goes nowhere even after a reconnect (not onto the new socket)', async () => {
    const { socket, handle } = await connected();
    let finish!: (v: unknown) => void;
    handle.mockImplementationOnce(() => new Promise((done) => (finish = done)));
    socket.receive(JSON.stringify({ type: 'request', id: 'late', method: 'state' }));
    await flush();
    socket.drop();
    await vi.advanceTimersByTimeAsync(BACKOFF[0]);
    await flush();
    const next = last();
    expect(next).not.toBe(socket);
    next.open();
    finish('result');
    await flush();
    expect(next.messages().map((m) => m.type)).toEqual(['hello']);
  });
});

describe('reconnect', () => {
  it('a drop: retrying, re-fetches the config after the first backoff, reconnects with the new one', async () => {
    const { socket, states, fetch } = await connected();
    fetch.push(jsonReply({ ...CONFIG, url: 'ws://127.0.0.1:5555/', token: 'new-token' }));
    socket.drop();
    expect(states.at(-1)).toBe('retrying');
    await vi.advanceTimersByTimeAsync(BACKOFF[0] - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(FakeSocket.all).toHaveLength(2);
    expect(last().url).toBe('ws://127.0.0.1:5555/?role=session&token=new-token');
    last().open();
    expect(states).toEqual(['connecting', 'connected', 'retrying', 'connected']);
    expect(last().messages()).toEqual([{ type: 'hello', protocol: 1, session: INFO }]);
  });

  it('backs off along the schedule, the last delay repeating; while retrying, failures of any kind keep retrying', async () => {
    const { socket, fetch, states } = await connected();
    // The dev server is restarting: network error, then the SPA fallback, then a 404.
    fetch.push(new TypeError('Failed to fetch'), htmlReply(), statusReply(404), new TypeError('Failed to fetch'), jsonReply(CONFIG));
    socket.drop();
    const fetchedAfter = async (ms: number) => {
      const before = fetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(fetch.mock.calls.length, `not before ${ms} ms`).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(fetch.mock.calls.length, `at ${ms} ms`).toBe(before + 1);
    };
    await fetchedAfter(BACKOFF[0]); // network error
    await fetchedAfter(BACKOFF[1]); // index.html
    await fetchedAfter(BACKOFF[2]); // 404
    await fetchedAfter(BACKOFF[2]); // network error: the last delay repeats
    await fetchedAfter(BACKOFF[2]); // the bridge is back
    expect(FakeSocket.all).toHaveLength(2);
    // State changes are reported once, not per attempt.
    expect(states).toEqual(['connecting', 'connected', 'retrying']);
  });

  it('a socket that closes before opening retries too, with growing delays', async () => {
    const fetch = fakeFetch(jsonReply(CONFIG));
    start({ fetch });
    await flush();
    last().drop();
    await vi.advanceTimersByTimeAsync(BACKOFF[0]);
    await flush();
    expect(FakeSocket.all).toHaveLength(2);
    last().drop();
    await vi.advanceTimersByTimeAsync(BACKOFF[0]);
    await flush();
    expect(FakeSocket.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(BACKOFF[1] - BACKOFF[0]);
    await flush();
    expect(FakeSocket.all).toHaveLength(3);
  });

  it('a successful open resets the backoff', async () => {
    const fetch = fakeFetch(jsonReply(CONFIG));
    start({ fetch });
    await flush();
    // Two failed sockets: the next delay would be BACKOFF[2].
    last().drop();
    await vi.advanceTimersByTimeAsync(BACKOFF[0]);
    await flush();
    last().drop();
    await vi.advanceTimersByTimeAsync(BACKOFF[1]);
    await flush();
    expect(FakeSocket.all).toHaveLength(3);
    last().open();
    last().drop();
    await vi.advanceTimersByTimeAsync(BACKOFF[0]);
    await flush();
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('an invalid config while retrying turns the client off', async () => {
    const { socket, fetch, states } = await connected();
    fetch.push(jsonReply({ ...CONFIG, url: 'ws://evil.example:1/' }));
    socket.drop();
    await vi.advanceTimersByTimeAsync(BACKOFF[0]);
    await flush();
    expect(states.at(-1)).toBe('off');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('uses the default backoff when none is given (first retry after 500 ms)', async () => {
    const { socket, fetch } = await connected({ backoff: undefined });
    socket.drop();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('close', () => {
  it('closes the socket; its close event does not schedule a retry', async () => {
    const { client, socket, fetch } = await connected();
    client.close();
    expect(socket.closeCalls).toBe(1);
    socket.drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('cancels a pending retry', async () => {
    const { client, socket, fetch } = await connected();
    socket.drop();
    client.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('while the config request is in flight: no socket is ever opened', async () => {
    let answer!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => (answer = done)));
    const { client } = start({ fetch: fetch as unknown as typeof globalThis.fetch });
    await flush();
    client.close();
    answer(jsonReply(CONFIG));
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toEqual([]);
  });

  it('update() after close sends nothing; close is idempotent', async () => {
    const { client, socket } = await connected();
    client.close();
    client.close();
    client.update();
    expect(socket.sent).toHaveLength(1);
    expect(socket.closeCalls).toBe(1);
  });
});
