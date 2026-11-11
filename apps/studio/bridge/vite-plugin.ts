/**
 * `mcpBridgePlugin`: starts the MCP playground bridge (mcp-bridge.ts) next to
 * `vite` / `vite preview`, and serves the page its session config at
 * `BRIDGE_CONFIG_PATH`.
 *
 * On when the mode is `playground` (`pnpm playground` runs `vite --mode
 * playground`), or when `HOLODECK_MCP_BRIDGE=1`; `HOLODECK_MCP_BRIDGE=0` turns
 * it off. Never part of a production build (only the dev / preview servers
 * run plugins' server hooks). Other variables:
 *   HOLODECK_MCP_BRIDGE_FILE  where to write the agent file (default: the
 *                             holodeck repo root, `.holodeck-mcp.json`)
 *   HOLODECK_MCP_BRIDGE_PORT  fixed bridge port (default: a free one)
 */

import { readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Connect, Logger, Plugin } from 'vite';
import { BRIDGE_CONFIG_PATH, BRIDGE_FILE_NAME } from '../src/playground/bridge-protocol.ts';
import { isLoopbackAddress, isLoopbackOrigin, startMcpBridge, type McpBridge } from './mcp-bridge.ts';

/** Default agent file: the holodeck repo root (this file is apps/studio/bridge/). */
export const DEFAULT_BRIDGE_FILE = fileURLToPath(new URL(`../../../${BRIDGE_FILE_NAME}`, import.meta.url));

export function bridgeEnabled(mode: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.HOLODECK_MCP_BRIDGE === '0') return false;
  return env.HOLODECK_MCP_BRIDGE === '1' || mode === 'playground';
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const hostName = (host: string | undefined) => {
  try {
    return new URL(`http://${host ?? ''}`).hostname;
  } catch {
    return '';
  }
};

interface ServerLike {
  httpServer: { address(): AddressInfo | string | null; once(event: 'close', fn: () => void): unknown } | null;
  middlewares: Connect.Server;
  config: { logger: Logger };
  resolvedUrls: { local: string[] } | null;
}

/** CORS response headers Vite's own `server.cors` middleware may already have set. */
const CORS_HEADERS = ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers', 'Access-Control-Expose-Headers'];

/**
 * The page's config endpoint. Loopback clients only, named by a loopback
 * `Host` (no DNS rebinding), GET only, never cached, and only for the
 * studio's own pages: a request carrying a foreign `Origin` or a cross-site /
 * same-site `Sec-Fetch-Site` gets 403 (the playground's same-origin fetch
 * sends neither, or `same-origin`). A LAN client (`vite --host`) gets 403.
 *
 * Vite installs its CORS middleware BEFORE plugin `configureServer` hooks run
 * (Vite 8; default `server.cors` allows every localhost origin), so CORS
 * headers can already be on `res` here: they are removed, and the real-Vite
 * test in mcp-bridge.test.ts pins that no other localhost page can read the
 * answer (holodeck#277).
 */
export function bridgeConfigMiddleware(bridge: () => Promise<McpBridge | null>, allowOrigin: (origin: string) => boolean): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path !== BRIDGE_CONFIG_PATH) return next();
    for (const header of CORS_HEADERS) res.removeHeader(header);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return void res.writeHead(405).end();
    if (!isLoopbackAddress(req.socket.remoteAddress) || !LOOPBACK_NAMES.has(hostName(req.headers.host))) return void res.writeHead(403).end();
    const origin = req.headers.origin;
    if (origin !== undefined && !allowOrigin(origin)) return void res.writeHead(403).end();
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return void res.writeHead(403).end();
    void bridge().then(
      (b) => {
        if (!b) return void res.writeHead(503).end();
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(b.clientConfig()));
      },
      () => void res.writeHead(503).end(),
    );
  };
}

export function mcpBridgePlugin(): Plugin {
  let mode = 'development';
  let bridge: Promise<McpBridge | null> = Promise.resolve(null);
  const file = process.env.HOLODECK_MCP_BRIDGE_FILE || DEFAULT_BRIDGE_FILE;

  const attach = (server: ServerLike) => {
    if (!bridgeEnabled(mode)) return;
    const studioPort = () => {
      const address = server.httpServer?.address();
      return address && typeof address === 'object' ? address.port : null;
    };
    const logger = server.config.logger;
    bridge = startMcpBridge({
      port: Number(process.env.HOLODECK_MCP_BRIDGE_PORT) || 0,
      allowOrigin: (origin) => isLoopbackOrigin(origin, studioPort()),
      file,
      studio: () => {
        const base = server.resolvedUrls?.local[0];
        return base ? new URL('playground', base).href : null;
      },
    }).then(
      (b) => {
        logger.info(`  MCP bridge: ${b.url} (agent token in ${file})`, { timestamp: true });
        logger.info(`  MCP bridge token: ${b.agentToken}`);
        // Vite closes its HTTP server on shutdown (and on restart): the bridge goes with it.
        server.httpServer?.once('close', () => void b.close());
        // Ctrl-C may end the process without closing servers: drop the agent file if still ours.
        process.once('exit', () => {
          try {
            if (readFileSync(file, 'utf8').includes(JSON.stringify(b.agentToken))) rmSync(file, { force: true });
          } catch {
            // Already gone.
          }
        });
        return b;
      },
      (error: unknown) => {
        logger.error(`  MCP bridge did not start: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      },
    );
    server.middlewares.use(bridgeConfigMiddleware(() => bridge, (origin) => isLoopbackOrigin(origin, studioPort())));
  };

  return {
    name: 'holodeck-mcp-bridge',
    configResolved: (config) => {
      mode = config.mode;
    },
    configureServer: (server) => attach(server),
    configurePreviewServer: (server) => attach(server),
  };
}
