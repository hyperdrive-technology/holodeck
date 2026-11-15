/**
 * The MCP playground bridge server (Node; runs inside `vite` / `vite preview`
 * through `mcpBridgePlugin`). Protocol: src/playground/bridge-protocol.ts.
 * Design + threat model: docs/MCP.md, "Playground bridge".
 *
 * Security, in the order an upgrade request is checked:
 *  1. Listens on 127.0.0.1 only (never 0.0.0.0, whatever `vite --host` says).
 *  2. `Host` must be `127.0.0.1:<port>` or `localhost:<port>`: a DNS
 *     rebinding page (evil.example resolving to 127.0.0.1) sends its own name.
 *  3. Two random 256-bit tokens, compared in constant time:
 *       - session token: what the playground page gets from the dev server
 *         (`BRIDGE_CONFIG_PATH`, loopback clients only). Session sockets must
 *         carry an `Origin` that is the studio's own (loopback, the dev
 *         server's port), which browsers set and pages cannot forge.
 *       - agent token: printed, and written to `.holodeck-mcp.json` (mode
 *         0600) for the MCP server. Agent sockets must carry NO `Origin`:
 *         browsers always send one, so no web page can be an agent even if it
 *         learned the token.
 *  4. Messages over `MAX_BRIDGE_MESSAGE_BYTES` close the socket (ws `maxPayload`).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_REQUEST_TIMEOUT_MS,
  BRIDGE_STATUS_METHOD,
  boundedSessionInfo,
  MAX_BRIDGE_MESSAGE_BYTES,
  parseBridgeMessage,
  type BridgeClientConfig,
  type BridgeErrorBody,
  type BridgeFile,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeRole,
  type BridgeStatus,
  type SessionInfo,
} from '../src/playground/bridge-protocol.ts';

export interface McpBridgeOptions {
  /** Loopback port; 0 (default) = a free one. */
  port?: number;
  /** May a session socket with this `Origin` connect? (the studio's own origins). */
  allowOrigin: (origin: string) => boolean;
  /** Where to write the agent file; null = don't. */
  file?: string | null;
  /** Studio page URL, recorded in the file for humans. */
  studio?: () => string | null;
  /** Tab response deadline. */
  requestTimeoutMs?: number;
  /** Fixed tokens (tests). */
  tokens?: { session: string; agent: string };
}

export interface McpBridge {
  url: string;
  port: number;
  sessionToken: string;
  agentToken: string;
  /** What the page fetches (`BRIDGE_CONFIG_PATH`). */
  clientConfig: () => BridgeClientConfig;
  status: () => BridgeStatus;
  /** Stop listening, drop every socket, remove the agent file if it is still ours. */
  close: () => Promise<void>;
}

interface Session {
  ws: WebSocket;
  id: string;
  info: SessionInfo | null;
}

interface Pending {
  agent: WebSocket;
  agentId: string;
  session: Session;
  timer: ReturnType<typeof setTimeout>;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Is `origin` one of `http://{localhost,127.0.0.1,[::1]}:<port>`? (the studio's own, for a server on `port`). */
export function isLoopbackOrigin(origin: string, port: number | null): boolean {
  if (port === null) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname) && url.port === String(port) && url.origin === origin;
}

/** Remote address of a loopback client (`::ffff:127.0.0.1` included). */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// Hash first so both sides are 32 bytes: timingSafeEqual throws on a length
// mismatch, which would itself leak the length.
const digest = (s: string) => createHash('sha256').update(s).digest();
export const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

const newToken = () => randomBytes(32).toString('base64url');

function refuse(socket: Duplex, status: 400 | 401 | 403 | 404, reason: string) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Write `data` to `path` atomically (temp file + rename), readable by this user only. */
async function writePrivate(path: string, data: string) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}

export async function startMcpBridge(options: McpBridgeOptions): Promise<McpBridge> {
  const sessionToken = options.tokens?.session ?? newToken();
  const agentToken = options.tokens?.agent ?? newToken();
  const timeoutMs = options.requestTimeoutMs ?? BRIDGE_REQUEST_TIMEOUT_MS;
  const http: Server = createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' }).end('Holodeck MCP bridge: WebSocket only\n');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BRIDGE_MESSAGE_BYTES });
  /** Newest last. Requests go to the newest one that said hello. */
  const sessions: Session[] = [];
  const pending = new Map<string, Pending>();
  let seq = 0;
  let port = 0;

  const send = (ws: WebSocket, message: BridgeResponse | BridgeRequest) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const fail = (ws: WebSocket, id: string, error: BridgeErrorBody) => send(ws, { type: 'response', id, ok: false, error });
  const active = () => [...sessions].reverse().find((s) => s.info !== null);

  const status = (): BridgeStatus => ({
    protocol: BRIDGE_PROTOCOL_VERSION,
    sessions: [...sessions].reverse().flatMap((s) => (s.info ? [s.info] : [])),
  });

  const onAgentMessage = (agent: WebSocket, text: string) => {
    const msg = parseBridgeMessage(text);
    if (!msg || msg.type !== 'request') return;
    if (msg.method === BRIDGE_STATUS_METHOD) {
      send(agent, { type: 'response', id: msg.id, ok: true, result: status() });
      return;
    }
    const session = active();
    if (!session) {
      fail(agent, msg.id, { message: 'no playground tab is connected', code: 'no_session' });
      return;
    }
    seq += 1;
    const id = `r${seq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      fail(agent, msg.id, { message: `the playground tab did not answer "${msg.method}" within ${Math.round(timeoutMs / 1000)} s`, code: 'timeout' });
    }, timeoutMs);
    pending.set(id, { agent, agentId: msg.id, session, timer });
    send(session.ws, { type: 'request', id, method: msg.method, params: msg.params });
  };

  const onSessionMessage = (session: Session, text: string) => {
    const msg = parseBridgeMessage(text);
    if (!msg) return;
    if (msg.type === 'hello') {
      const fresh = session.info === null;
      session.info = { ...boundedSessionInfo(msg.session), sessionId: session.id, connectedAt: session.info?.connectedAt ?? new Date().toISOString() };
      // A tab that registers becomes the newest (a re-opened or reloaded tab wins).
      if (fresh) {
        sessions.splice(sessions.indexOf(session), 1);
        sessions.push(session);
      }
      return;
    }
    if (msg.type !== 'response') return;
    const entry = pending.get(msg.id);
    // Only the tab that was asked may answer.
    if (!entry || entry.session !== session) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    send(entry.agent, { ...msg, id: entry.agentId });
  };

  const dropSession = (session: Session) => {
    const i = sessions.indexOf(session);
    if (i >= 0) sessions.splice(i, 1);
    for (const [id, entry] of pending) {
      if (entry.session !== session) continue;
      pending.delete(id);
      clearTimeout(entry.timer);
      fail(entry.agent, entry.agentId, { message: 'the playground tab closed before it answered', code: 'session_gone' });
    }
  };

  const dropAgent = (agent: WebSocket) => {
    for (const [id, entry] of pending) {
      if (entry.agent !== agent) continue;
      pending.delete(id);
      clearTimeout(entry.timer);
    }
  };

  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'ws://bridge.invalid');
    } catch {
      // `//[` and the like: new URL() throws, and an exception here would end the dev server.
      return refuse(socket, 400, 'Bad Request');
    }
    if (url.pathname !== '/') return refuse(socket, 404, 'Not Found');
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return refuse(socket, 403, 'Forbidden');
    const role = url.searchParams.get('role') as BridgeRole | null;
    const token = url.searchParams.get('token') ?? '';
    const origin = req.headers.origin;
    if (role === 'session') {
      if (!sameToken(token, sessionToken)) return refuse(socket, 401, 'Unauthorized');
      if (!origin || !options.allowOrigin(origin)) return refuse(socket, 403, 'Forbidden');
    } else if (role === 'agent') {
      if (!sameToken(token, agentToken)) return refuse(socket, 401, 'Unauthorized');
      if (origin !== undefined) return refuse(socket, 403, 'Forbidden');
    } else {
      return refuse(socket, 400, 'Bad Request');
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (role === 'session') {
        seq += 1;
        const session: Session = { ws, id: `s${seq}`, info: null };
        sessions.push(session);
        ws.on('message', (data) => onSessionMessage(session, data.toString()));
        ws.on('close', () => dropSession(session));
      } else {
        ws.on('message', (data) => onAgentMessage(ws, data.toString()));
        ws.on('close', () => dropAgent(ws));
      }
      ws.on('error', () => ws.terminate());
    });
  });

  await new Promise<void>((done, failed) => {
    http.once('error', failed);
    http.listen(options.port ?? 0, '127.0.0.1', () => {
      http.off('error', failed);
      done();
    });
  });
  port = (http.address() as { port: number }).port;
  const url = `ws://127.0.0.1:${port}/`;

  const file = options.file ? resolve(options.file) : null;
  if (file) {
    const content: BridgeFile = {
      protocol: BRIDGE_PROTOCOL_VERSION,
      url,
      token: agentToken,
      pid: process.pid,
      studio: options.studio?.() ?? null,
      startedAt: new Date().toISOString(),
    };
    await writePrivate(file, `${JSON.stringify(content, null, 2)}\n`);
  }

  let closed: Promise<void> | null = null;
  const close = () =>
    (closed ??= (async () => {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((done) => http.close(() => done()));
      wss.close();
      if (file) {
        // Another bridge may have replaced the file since (a second dev server): leave it.
        const current = await readFile(file, 'utf8').catch(() => null);
        if (current?.includes(JSON.stringify(agentToken))) await rm(file, { force: true });
      }
    })());

  return {
    url,
    port,
    sessionToken,
    agentToken,
    clientConfig: () => ({ protocol: BRIDGE_PROTOCOL_VERSION, url, token: sessionToken }),
    status,
    close,
  };
}
