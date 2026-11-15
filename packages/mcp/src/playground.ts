/**
 * The MCP server's end of the playground bridge (protocol:
 * apps/studio/src/playground/bridge-protocol.ts; design: docs/MCP.md,
 * "Playground bridge").
 *
 * `pnpm playground` writes `.holodeck-mcp.json` (url + agent token) when its
 * bridge starts. Each call reads that file again, so a restarted dev server
 * (new port, new token) is picked up without restarting this server; one
 * socket is kept open while the file names the same bridge.
 *
 * The socket is Node's built-in WebSocket, which sends no `Origin` header:
 * the bridge refuses agent sockets that carry one (only a browser would).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ToolError } from './errors';
import { BRIDGE_FILE_NAME, BRIDGE_PROTOCOL_VERSION, BRIDGE_REQUEST_TIMEOUT_MS, BRIDGE_STATUS_METHOD, MAX_BRIDGE_MESSAGE_BYTES, parseBridgeMessage } from './studio';
import type { BridgeFile, BridgeStatus } from './studio';

/** `scene_*` / `provider_*` path that means "the open playground tab" instead of a file. */
export const PLAYGROUND_PATH = '@playground';

/**
 * Default bridge file: the holodeck repo root, where the studio's vite plugin
 * writes it (this module is packages/mcp/src or packages/mcp/dist).
 */
export const DEFAULT_BRIDGE_FILE = fileURLToPath(new URL(`../../../${BRIDGE_FILE_NAME}`, import.meta.url));

/** Slack over the bridge's own tab deadline, so the bridge's `timeout` answer arrives first. */
const CLIENT_TIMEOUT_MS = BRIDGE_REQUEST_TIMEOUT_MS + 5_000;
const CONNECT_TIMEOUT_MS = 5_000;
/** Largest bridge file read (it is a few hundred bytes). */
const MAX_FILE_BYTES = 16 * 1024;

const START_HINT = 'start the playground: cd holodeck/apps/studio && pnpm playground (it prints "MCP bridge: ...")';

export interface PlaygroundBridgeOptions {
  /** Path of `.holodeck-mcp.json` (default: `HOLODECK_MCP_BRIDGE_FILE`, else the holodeck repo root). */
  file?: string;
  /** Per-request deadline (tests). */
  timeoutMs?: number;
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (error: ToolError) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Link {
  key: string;
  ws: WebSocket;
  open: Promise<void>;
  waiters: Map<string, Waiter>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The bridge file's content, or a ToolError saying why there is no usable bridge. */
export function parseBridgeFile(text: string, file: string): BridgeFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ToolError(`${file} is not JSON`, [START_HINT], 'no_bridge');
  }
  if (!isObj(value) || typeof value.url !== 'string' || typeof value.token !== 'string' || !value.token) {
    throw new ToolError(`${file} is not a playground bridge file`, [START_HINT], 'no_bridge');
  }
  if (value.protocol !== BRIDGE_PROTOCOL_VERSION) {
    throw new ToolError(`${file} is for bridge protocol ${String(value.protocol)}; this server speaks ${BRIDGE_PROTOCOL_VERSION}`, ['update holodeck (studio and MCP server) to the same version'], 'no_bridge');
  }
  // Loopback only, whatever the file says: never send the token anywhere else.
  if (!/^ws:\/\/127\.0\.0\.1:\d{1,5}\/$/.test(value.url)) throw new ToolError(`${file} names a non-loopback bridge (${value.url.slice(0, 100)})`, [], 'no_bridge');
  return value as unknown as BridgeFile;
}

export class PlaygroundBridge {
  readonly file: string;
  private readonly timeoutMs: number;
  private link: Link | null = null;
  private seq = 0;
  private closed = false;

  constructor(options: PlaygroundBridgeOptions = {}) {
    this.file = options.file ?? (process.env.HOLODECK_MCP_BRIDGE_FILE?.trim() || DEFAULT_BRIDGE_FILE);
    this.timeoutMs = options.timeoutMs ?? CLIENT_TIMEOUT_MS;
  }

  /** The bridge's status, or `null` when there is no bridge file (the playground is not running). */
  async status(): Promise<{ file: string; bridge: BridgeFile; status: BridgeStatus } | null> {
    const bridge = await this.readFile(true);
    if (!bridge) return null;
    const status = (await this.send(bridge, BRIDGE_STATUS_METHOD, undefined)) as BridgeStatus;
    return { file: this.file, bridge, status };
  }

  /** Ask the newest playground tab (`method`: see `SESSION_METHODS`). Errors are ToolErrors with the tab's code. */
  async call(method: string, params?: unknown): Promise<unknown> {
    const bridge = (await this.readFile(false))!;
    return this.send(bridge, method, params);
  }

  close(): void {
    this.closed = true;
    this.drop(new ToolError('the MCP server is closing', [], 'closed'));
  }

  private async readFile(optional: boolean): Promise<BridgeFile | null> {
    let text: string;
    try {
      const buf = await readFile(this.file);
      if (buf.byteLength > MAX_FILE_BYTES) throw new ToolError(`${this.file} is too large to be a bridge file`, [], 'no_bridge');
      text = buf.toString('utf8');
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (optional) return null;
        throw new ToolError('no playground is running (no bridge file)', [START_HINT, `looked for ${this.file} (set HOLODECK_MCP_BRIDGE_FILE to change)`, 'or work on a document file: pass path'], 'no_bridge');
      }
      throw new ToolError(`cannot read ${this.file}: ${(error as Error).message}`, [], 'no_bridge');
    }
    return parseBridgeFile(text, this.file);
  }

  private async send(bridge: BridgeFile, method: string, params: unknown): Promise<unknown> {
    if (this.closed) throw new ToolError('the MCP server is closing', [], 'closed');
    const link = this.connect(bridge);
    await link.open;
    this.seq += 1;
    const id = `a${this.seq}`;
    const text = JSON.stringify({ type: 'request', id, method, ...(params === undefined ? {} : { params }) });
    if (Buffer.byteLength(text, 'utf8') > MAX_BRIDGE_MESSAGE_BYTES) {
      throw new ToolError(`the request is over the bridge's ${MAX_BRIDGE_MESSAGE_BYTES}-byte message limit`, [], 'too_large');
    }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        link.waiters.delete(id);
        reject(new ToolError(`the playground bridge did not answer "${method}" in time`, ['is the playground tab frozen? reload it'], 'timeout'));
      }, this.timeoutMs);
      link.waiters.set(id, { resolve, reject, timer });
      link.ws.send(text);
    });
  }

  /** The open link for `bridge`, or a new one (an old link to another bridge is dropped). */
  private connect(bridge: BridgeFile): Link {
    const key = `${bridge.url}\n${bridge.token}`;
    if (this.link && this.link.key === key && this.link.ws.readyState <= WebSocket.OPEN) return this.link;
    this.drop(new ToolError('the playground bridge restarted', ['retry'], 'bridge_gone'));
    const ws = new WebSocket(`${bridge.url}?role=agent&token=${encodeURIComponent(bridge.token)}`);
    const waiters = new Map<string, Waiter>();
    const open = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new ToolError('the playground bridge did not accept the connection in time', [START_HINT], 'no_bridge'));
      }, CONNECT_TIMEOUT_MS);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        // Refused (a stale file of a stopped dev server) or a wrong token (an
        // older file): both mean "start the playground again".
        reject(new ToolError(`the playground bridge at ${bridge.url} is not reachable (stale ${this.file}?)`, [START_HINT], 'no_bridge'));
      };
    });
    // Callers await `open`; nothing else may leave its rejection unhandled.
    open.catch(() => undefined);
    const link: Link = { key, ws, open, waiters };
    ws.onmessage = (event: MessageEvent) => {
      const msg = typeof event.data === 'string' ? parseBridgeMessage(event.data) : null;
      if (!msg || msg.type !== 'response') return;
      const waiter = waiters.get(msg.id);
      if (!waiter) return;
      waiters.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.ok) waiter.resolve(msg.result);
      else waiter.reject(new ToolError(msg.error.message.slice(0, 2000), (msg.error.problems ?? []).slice(0, 50).map((p) => String(p).slice(0, 1000)), msg.error.code ?? 'playground'));
    };
    ws.onclose = () => {
      if (this.link === link) this.link = null;
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new ToolError('the playground bridge closed the connection', ['retry; if it keeps failing, restart pnpm playground'], 'bridge_gone'));
      }
      waiters.clear();
    };
    this.link = link;
    return link;
  }

  private drop(reason: ToolError) {
    const link = this.link;
    if (!link) return;
    this.link = null;
    for (const waiter of link.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
    link.waiters.clear();
    link.ws.onclose = null;
    link.ws.close();
  }
}
