/**
 * The playground tab's end of the MCP bridge (bridge-protocol.ts): ask the
 * dev server for the session config, open the WebSocket, register (`hello`),
 * answer requests with the handler, reconnect when the bridge restarts.
 *
 * On a server without the bridge (a production deployment, `pnpm dev`, the
 * e2e preview) the config endpoint answers 404 or the SPA's index.html: the
 * client goes `off` after that single request and never retries.
 */

import {
  BRIDGE_CONFIG_PATH,
  BRIDGE_PROTOCOL_VERSION,
  errorBody,
  parseBridgeMessage,
  type BridgeClientConfig,
  type BridgeResponse,
  type SessionInfo,
} from './bridge-protocol';

/** `off`: no bridge on this server. `connecting` / `connected`; `retrying` after a drop. */
export type BridgeClientState = 'off' | 'connecting' | 'connected' | 'retrying';

export interface BridgeClientOptions {
  info: () => SessionInfo;
  handle: (method: string, params: unknown) => Promise<unknown>;
  onState?: (state: BridgeClientState) => void;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  /** Reconnect delays (ms), the last one repeating. */
  backoff?: readonly number[];
}

export interface BridgeClient {
  /** Send the tab's current info again (tab or name changed). */
  update: () => void;
  close: () => void;
}

const DEFAULT_BACKOFF = [500, 1_000, 2_000, 5_000, 10_000] as const;

function isClientConfig(v: unknown): v is BridgeClientConfig {
  const c = v as BridgeClientConfig;
  return !!c && typeof c === 'object' && c.protocol === BRIDGE_PROTOCOL_VERSION && typeof c.url === 'string' && /^ws:\/\/127\.0\.0\.1:\d+\/$/.test(c.url) && typeof c.token === 'string';
}

export function startBridgeClient(options: BridgeClientOptions): BridgeClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const WS = options.WebSocket ?? globalThis.WebSocket;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  let closed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: BridgeClientState | null = null;
  const setState = (next: BridgeClientState) => {
    if (next === state) return;
    state = next;
    options.onState?.(next);
  };

  const hello = () => {
    if (socket?.readyState === WS.OPEN) socket.send(JSON.stringify({ type: 'hello', protocol: BRIDGE_PROTOCOL_VERSION, session: options.info() }));
  };

  const retry = () => {
    if (closed) return;
    setState('retrying');
    const delay = backoff[Math.min(attempt, backoff.length - 1)]!;
    attempt += 1;
    timer = setTimeout(() => void run(), delay);
  };

  /** Fetch the config (it changes when the bridge restarts) and connect. */
  const run = async () => {
    timer = null;
    if (closed) return;
    if (state === null) setState('connecting');
    let config: unknown;
    try {
      const res = await fetchImpl(BRIDGE_CONFIG_PATH, { cache: 'no-store', credentials: 'same-origin' });
      const json = res.ok && (res.headers.get('content-type') ?? '').includes('application/json');
      if (!json) {
        // Never a bridge here, or it went away with the dev server: stop. A
        // 503 (bridge still starting) is worth another try.
        if (res.status === 503) return retry();
        if (state === 'connecting') setState('off');
        else retry();
        return;
      }
      config = await res.json();
    } catch {
      return state === 'connecting' ? setState('off') : retry();
    }
    if (closed) return;
    if (!isClientConfig(config)) return setState('off');
    const ws = new WS(`${config.url}?role=session&token=${encodeURIComponent(config.token)}`);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      setState('connected');
      hello();
    };
    ws.onmessage = (event: MessageEvent) => {
      const msg = typeof event.data === 'string' ? parseBridgeMessage(event.data) : null;
      if (!msg || msg.type !== 'request') return;
      const reply = (response: BridgeResponse) => {
        if (ws.readyState === WS.OPEN) ws.send(JSON.stringify(response));
      };
      options.handle(msg.method, msg.params).then(
        (result) => reply({ type: 'response', id: msg.id, ok: true, result }),
        (error: unknown) => reply({ type: 'response', id: msg.id, ok: false, error: errorBody(error) }),
      );
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      retry();
    };
  };

  void run();
  return {
    update: hello,
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
      socket = null;
    },
  };
}
