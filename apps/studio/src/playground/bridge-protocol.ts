/**
 * The MCP playground bridge's wire protocol, shared by its three parties:
 *
 *   playground tab  (session)  <-- ws -->  bridge (vite plugin, 127.0.0.1)  <-- ws -->  @holodeck/mcp  (agent)
 *
 * `pnpm playground` starts the bridge (apps/studio/bridge/mcp-bridge.ts) on a
 * random loopback port, with two random tokens: the session token, which the
 * page fetches from the dev server (`BRIDGE_CONFIG_PATH`), and the agent
 * token, printed and written to `.holodeck-mcp.json` for the MCP server. The
 * bridge relays agent requests to the most recently registered tab and its
 * responses back. Design and security notes: docs/MCP.md, "Playground bridge".
 *
 * Pure TypeScript (no React, no DOM, no Node): the MCP server bundles this
 * module (packages/mcp/src/studio.ts).
 */

export const BRIDGE_PROTOCOL_VERSION = 1;
/** Dev / preview server endpoint that hands the page its session token (loopback clients only). */
export const BRIDGE_CONFIG_PATH = '/__holodeck/mcp-bridge';
/** File (repo root by default) the bridge writes for the MCP server: url + agent token. */
export const BRIDGE_FILE_NAME = '.holodeck-mcp.json';
/** Largest message either side accepts: a 20 MB document plus JSON overhead, or a screenshot. */
export const MAX_BRIDGE_MESSAGE_BYTES = 32 * 1024 * 1024;
/** How long the bridge waits for a tab to answer before failing the agent's request. */
export const BRIDGE_REQUEST_TIMEOUT_MS = 30_000;

export type BridgeRole = 'session' | 'agent';

/** `.holodeck-mcp.json`. */
export interface BridgeFile {
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
  /** `ws://127.0.0.1:<port>/`. */
  url: string;
  /** The agent token. */
  token: string;
  /** Process that owns the bridge (a stale file names a dead one). */
  pid: number;
  /** The studio page the bridge belongs to, when known (`http://localhost:5173/playground`). */
  studio: string | null;
  startedAt: string;
}

/** What `BRIDGE_CONFIG_PATH` returns to the page. */
export interface BridgeClientConfig {
  protocol: typeof BRIDGE_PROTOCOL_VERSION;
  url: string;
  /** The session token (not the agent token: a page can never act as an agent). */
  token: string;
}

/** A registered tab, as `bridge.status` lists it. */
export interface SessionInfo {
  documentId: string;
  documentName: string;
  /** Playground tab: `edit` or `viewer`. */
  tab: string;
  /** Assigned by the bridge. */
  sessionId?: string;
  connectedAt?: string;
}

/** Methods a tab serves (see `mcp-bridge-session.ts`). */
export const SESSION_METHODS = ['state', 'apply', 'connect', 'browse', 'screenshot'] as const;
export type SessionMethod = (typeof SESSION_METHODS)[number];
/** Answered by the bridge itself. */
export const BRIDGE_STATUS_METHOD = 'bridge.status';

export interface BridgeErrorBody {
  message: string;
  /** Machine-readable: `conflict`, `busy`, `viewer`, `no_session`, `invalid`, `not_found`, `unsupported`, `timeout`... */
  code?: string;
  problems?: string[];
}

export interface BridgeRequest {
  type: 'request';
  id: string;
  method: string;
  params?: unknown;
}

export type BridgeResponse = { type: 'response'; id: string; ok: true; result: unknown } | { type: 'response'; id: string; ok: false; error: BridgeErrorBody };

/** Tab -> bridge: register (or update) this tab. */
export interface BridgeHello {
  type: 'hello';
  protocol: number;
  session: SessionInfo;
}

export type BridgeMessage = BridgeRequest | BridgeResponse | BridgeHello;

export interface BridgeStatus {
  protocol: number;
  /** Newest first; the first is the one requests go to. */
  sessions: SessionInfo[];
}

// --- Method payloads ---------------------------------------------------------

export interface StateParams {
  /** Include the live values (bounded); default true. */
  metrics?: boolean;
}

export interface SessionState {
  /** Changes whenever the working copy does; `apply` / `connect` refuse a stale one. */
  etag: string;
  /** The working copy (what the canvas shows, saved or not). */
  document: unknown;
  tab: string;
  save: { status: string; revision: number; dirty: boolean };
  selectedId: string | null;
  /** Why edits are refused right now (a dialog is open, a gesture is in progress), or null. */
  busy: string | null;
  connections: Record<string, { provider: string; state: string; message?: string }>;
  /** objectId -> param -> value, or omitted (too large / not asked for). */
  metrics?: Record<string, Record<string, unknown>>;
  metricsOmitted?: string;
}

export interface ApplyParams {
  /** The `etag` the scene was computed from. */
  etag: string;
  /** The new `body` (same scene id). Committed as one undo step. */
  scene: unknown;
}

export interface ConnectParams {
  etag?: string;
  /** A secret-free ProviderConnection; added, or replacing the one with its id. */
  connection: { id: string; provider: string; label?: string; config?: Record<string, unknown> };
}

export interface EditResult {
  etag: string;
  document: unknown;
}

export interface BrowseParams {
  connection: string;
  path?: string;
}

export interface ScreenshotParams {
  /** Image scale over the canvas size (1–4). */
  scale?: number;
}

export interface ScreenshotResult {
  mimeType: 'image/png';
  /** Base64 PNG. */
  data: string;
  width: number;
  height: number;
}

// --- Parsing -------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** One received message, or null when it is not a well-formed bridge message (dropped). */
export function parseBridgeMessage(text: string): BridgeMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(value)) return null;
  switch (value.type) {
    case 'request':
      return isStr(value.id) && value.id.length <= 64 && isStr(value.method) && value.method.length <= 64 ? (value as unknown as BridgeRequest) : null;
    case 'response': {
      if (!isStr(value.id) || typeof value.ok !== 'boolean') return null;
      if (value.ok) return value as unknown as BridgeResponse;
      const error = value.error;
      return isObj(error) && isStr(error.message) ? (value as unknown as BridgeResponse) : null;
    }
    case 'hello': {
      const s = value.session;
      return typeof value.protocol === 'number' && isObj(s) && isStr(s.documentId) && isStr(s.documentName) && isStr(s.tab) ? (value as unknown as BridgeHello) : null;
    }
    default:
      return null;
  }
}

/** A tab's info with every field bounded (the bridge stores and lists it). */
export function boundedSessionInfo(info: SessionInfo): SessionInfo {
  return { documentId: info.documentId.slice(0, 128), documentName: info.documentName.slice(0, 200), tab: info.tab.slice(0, 16) };
}

/** Errors a tab handler throws on purpose: their code and problems reach the agent. */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export function errorBody(error: unknown): BridgeErrorBody {
  if (error instanceof BridgeError) return { message: error.message, code: error.code, ...(error.problems.length ? { problems: error.problems.slice(0, 50) } : {}) };
  return { message: error instanceof Error ? error.message : String(error), code: 'internal' };
}
