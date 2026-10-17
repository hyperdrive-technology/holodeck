/**
 * Local test server for the provider tests: plain `node:http` on 127.0.0.1
 * with programmable JSON routes, Server-Sent Event feeds and WebSocket feeds
 * (`ws`, dev dependency). Nothing in the test suite touches an external network.
 *
 * Every request is logged (`requests`), every TCP socket is tracked
 * (`openSockets`), and feeds count their live clients, so tests can prove
 * that unsubscribe / close really stop polling and close streams.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export interface LoggedRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
  at: number;
}

export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => unknown;

export interface SseClient {
  headers: IncomingMessage['headers'];
  send(data: string, options?: { event?: string; id?: string }): void;
  raw(text: string): void;
  end(): void;
}

export interface SseFeed {
  readonly clients: SseClient[];
  /** Total connections ever accepted. */
  readonly connections: number;
  /** Headers of each accepted connection, in order. */
  readonly connectHeaders: IncomingMessage['headers'][];
  /** Written to each new client before anything else (e.g. `retry: 10\n\n`). */
  preamble: string;
  /** Called for every new client (send initial data from here). */
  onConnect?: (client: SseClient) => void;
  broadcast(data: string, options?: { event?: string; id?: string }): void;
  /** End every client's response (the provider must reconnect). */
  dropAll(): void;
  /** Wait until `n` clients are connected. */
  waitForClients(n: number, timeoutMs?: number): Promise<void>;
}

export interface WsFeed {
  readonly clients: WebSocket[];
  readonly connections: number;
  /** Text messages received from clients, in order. */
  readonly received: string[];
  /** Upgrade request URLs (path + query), in order. */
  readonly upgradeUrls: string[];
  onConnect?: (socket: WebSocket) => void;
  broadcast(data: string | Buffer): void;
  dropAll(code?: number): void;
  waitForClients(n: number, timeoutMs?: number): Promise<void>;
}

export interface TestServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** `ws://127.0.0.1:<port>` */
  readonly wsUrl: string;
  readonly requests: LoggedRequest[];
  readonly openSockets: number;
  route(method: string, path: string, handler: Handler): void;
  /** JSON route; `value` may be a function evaluated per request. */
  json(path: string, value: unknown | (() => unknown), options?: { status?: number; method?: string }): void;
  sse(path: string): SseFeed;
  ws(path: string): WsFeed;
  /** Upgrade requests to this path are accepted at TCP level and then ignored (open timeout tests). */
  blackholeUpgrade(path: string): void;
  /** How many upgrade requests a blackholed path has received. */
  blackholeAttempts(path: string): number;
  requestsTo(path: string): LoggedRequest[];
  close(): Promise<void>;
}

export async function waitFor(check: () => boolean, timeoutMs = 3000, what = 'condition'): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function startTestServer(): Promise<TestServer> {
  const routes = new Map<string, Handler>();
  const requests: LoggedRequest[] = [];
  const sockets = new Set<Socket>();
  const wsFeeds = new Map<string, { wss: WebSocketServer; feed: WsFeed }>();
  const blackholes = new Map<string, number>();
  const sseResponses = new Set<ServerResponse>();

  /** Routes registered as `/prefix/*` match any deeper path. */
  const prefixRoute = (method: string, path: string): Handler | undefined => {
    for (const [key, handler] of routes) {
      const [m, p] = key.split(' ') as [string, string];
      if ((m === method || m === '*') && p.endsWith('/*') && path.startsWith(p.slice(0, -1))) return handler;
    }
    return undefined;
  };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const path = (req.url ?? '/').split('?')[0] as string;
    requests.push({ method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body, at: Date.now() });
    const handler = routes.get(`${req.method} ${path}`) ?? routes.get(`* ${path}`) ?? prefixRoute(req.method ?? 'GET', path);
    if (!handler) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
      return;
    }
    try {
      await handler(req, res, body);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error));
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '/').split('?')[0] as string;
    if (blackholes.has(path)) {
      blackholes.set(path, (blackholes.get(path) ?? 0) + 1);
      return; // never answer
    }
    const entry = wsFeeds.get(path);
    if (!entry) {
      socket.destroy();
      return;
    }
    (entry.feed.upgradeUrls as string[]).push(req.url ?? '/');
    entry.wss.handleUpgrade(req, socket, head, (ws) => entry.wss.emit('connection', ws, req));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const api: TestServer = {
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    requests,
    get openSockets() {
      return sockets.size;
    },
    route(method, path, handler) {
      routes.set(`${method} ${path}`, handler);
    },
    json(path, value, options = {}) {
      routes.set(`${options.method ?? 'GET'} ${path}`, (_req, res) => {
        const v = typeof value === 'function' ? (value as () => unknown)() : value;
        res.writeHead(options.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
      });
    },
    sse(path) {
      const clients: SseClient[] = [];
      const connectHeaders: IncomingMessage['headers'][] = [];
      let connections = 0;
      const feed: SseFeed = {
        clients,
        connectHeaders,
        get connections() {
          return connections;
        },
        preamble: '',
        broadcast(data, options) {
          for (const c of [...clients]) c.send(data, options);
        },
        dropAll() {
          for (const c of [...clients]) c.end();
        },
        waitForClients(n, timeoutMs = 3000) {
          return waitFor(() => clients.length === n, timeoutMs, `${n} SSE clients on ${path}`);
        },
      };
      routes.set(`GET ${path}`, (req, res) => {
        connections++;
        connectHeaders.push(req.headers);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        sseResponses.add(res);
        const client: SseClient = {
          headers: req.headers,
          raw: (text) => void res.write(text),
          send(data, options = {}) {
            let out = '';
            if (options.event) out += `event: ${options.event}\n`;
            if (options.id) out += `id: ${options.id}\n`;
            for (const line of data.split('\n')) out += `data: ${line}\n`;
            res.write(out + '\n');
          },
          end: () => res.end(),
        };
        clients.push(client);
        const remove = () => {
          const i = clients.indexOf(client);
          if (i >= 0) clients.splice(i, 1);
          sseResponses.delete(res);
        };
        res.on('close', remove);
        if (feed.preamble) res.write(feed.preamble);
        else res.write(': connected\n\n');
        feed.onConnect?.(client);
      });
      return feed;
    },
    ws(path) {
      const wss = new WebSocketServer({ noServer: true });
      const clients: WebSocket[] = [];
      const received: string[] = [];
      const upgradeUrls: string[] = [];
      let connections = 0;
      const feed: WsFeed = {
        clients,
        received,
        upgradeUrls,
        get connections() {
          return connections;
        },
        broadcast(data) {
          for (const c of [...clients]) c.send(data);
        },
        dropAll(code = 1011) {
          for (const c of [...clients]) c.close(code, 'test drop');
        },
        waitForClients(n, timeoutMs = 3000) {
          return waitFor(() => clients.length === n, timeoutMs, `${n} WebSocket clients on ${path}`);
        },
      };
      wss.on('connection', (socket) => {
        connections++;
        clients.push(socket);
        socket.on('message', (data, isBinary) => {
          if (!isBinary) received.push(data.toString());
        });
        socket.on('close', () => {
          const i = clients.indexOf(socket);
          if (i >= 0) clients.splice(i, 1);
        });
        feed.onConnect?.(socket);
      });
      wsFeeds.set(path, { wss, feed });
      return feed;
    },
    blackholeUpgrade(path) {
      blackholes.set(path, 0);
    },
    blackholeAttempts(path) {
      return blackholes.get(path) ?? 0;
    },
    requestsTo(path) {
      return requests.filter((r) => r.path.split('?')[0] === path);
    },
    async close() {
      for (const res of sseResponses) res.end();
      for (const { wss } of wsFeeds.values()) {
        for (const c of wss.clients) c.terminate();
        wss.close();
      }
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return api;
}
