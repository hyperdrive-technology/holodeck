/**
 * Holodeck MCP server: the part library and scene documents as tools.
 *
 * SDK notes (checked against @modelcontextprotocol/sdk 1.32 and the core
 * server, core/src/typescript/packages/hyperdrive-mcp): `McpServer.registerTool`
 * takes a raw Zod shape (or object schema) as `inputSchema` and validates
 * arguments before the handler runs, so a malformed call never reaches it.
 * Tests pair `InMemoryTransport.createLinkedPair()` with the SDK `Client`.
 *
 * Every scene edit loads the file, runs the editor's reducer (scene-editor.ts),
 * validates the result exactly as the studio does on save (documents.ts) and
 * writes it only if it passes, guarded by the etag it was loaded with.
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z, type ZodRawShape } from 'zod';
import { SIM_PROVIDER_ID, type HolodeckHost, type HolodeckProvider, type ProviderConnection, type ProviderContext, type SignalBinding, type SignalNode } from '@holodeck/sdk';
import { isoComponentsCsv, type IsoPlacement } from '@holodeck/editor-2.5d-react';
import { DocumentStore, type IsoDoc, type LoadedDocument } from './documents';
import { ToolError } from './errors';
import { createMcpHost } from './host';
import {
  MAX_COORD,
  MAX_IDS_PER_CALL,
  MAX_IMAGE_BYTES,
  MAX_NAME_LENGTH,
  MAX_PARAMS_PER_CALL,
  MAX_PARTS_PAGE,
  MAX_PATH_LENGTH,
  MAX_TEXT_LENGTH,
} from './limits';
import { listParts, partDetail } from './parts';
import { PlaygroundBridge, PLAYGROUND_PATH } from './playground';
import { errorResult, imageResult, imageTooLarge, okResult } from './result';
import { MAX_SIDE, MIN_SIDE, SceneRenderer } from './render';
import { SceneEditor } from './scene-editor';
import {
  connectionConfigProblems,
  createIsoDocument,
  createPlaygroundDocument,
  serializeDocument,
  withDocumentId,
  withDocumentName,
  type EditResult,
  type ScreenshotResult,
  type SessionState,
} from './studio';
import { DEFAULT_TIER, TIERS, tierAllows, type Tier } from './tiers';
import { serialised, Workspace } from './workspace';

/** Room left for an edit acknowledgement: well under MAX_RESULT_CHARS, so it can never be refused after a save. */
const MAX_ACK_CHARS = 64 * 1024;

export const HOLODECK_MCP_NAME = 'holodeck';
export const HOLODECK_MCP_VERSION = '0.1.0';

export interface HolodeckMcpOptions {
  /** Folder documents are read from and written to (nothing outside it is touched). */
  root: string;
  tier?: Tier;
  /** A prepared host (tests); default: the studio's engine and packages. */
  host?: HolodeckHost;
  /** Clock for `metadata.updated`. */
  now?: () => Date;
  /** Headless renderer for `scene_render` (default: the built studio in Chromium, started on first use). */
  renderer?: SceneRenderer;
  /** Link to `pnpm playground` (default: reads `.holodeck-mcp.json`, see playground.ts). */
  bridge?: PlaygroundBridge;
}

/** What the tools share. `current` is the document `scene_open` selected. */
export interface ServerContext {
  tier: Tier;
  host: HolodeckHost;
  workspace: Workspace;
  store: DocumentStore;
  renderer: SceneRenderer;
  bridge: PlaygroundBridge;
  /** A document path, `@playground`, or null. */
  current: string | null;
}

export interface HolodeckMcp {
  server: McpServer;
  context: ServerContext;
  /** Close the server and everything it started (the render browser). */
  close: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Schemas (every string and collection is bounded)
// ---------------------------------------------------------------------------

const name = z.string().min(1).max(MAX_NAME_LENGTH);
const coord = z.number().finite().min(-MAX_COORD).max(MAX_COORD);
const point = z.object({ x: coord, y: coord }).strict();
const docPath = z
  .string()
  .min(1)
  .max(MAX_PATH_LENGTH)
  .describe(`Document path relative to the workspace root, ending in .holodeck.json; or "${PLAYGROUND_PATH}" for the scene open in the playground tab (pnpm playground)`);
const optionalPath = docPath.optional().describe('Document path (default: the document scene_open selected)');
const etag = z.string().max(64).optional().describe('The etag from scene_get / playground_state / the last edit: refuse if the document changed since (optional)');
const boundedRecord = (what: string) =>
  z
    .record(z.string().min(1).max(MAX_NAME_LENGTH), z.unknown())
    .refine((r) => Object.keys(r).length <= MAX_PARAMS_PER_CALL, `at most ${MAX_PARAMS_PER_CALL} ${what} per call`);
const portEnd = z.object({ id: name, port: name }).strict();
const connectEnd = z.union([portEnd, point]);
const binding = z
  .object({
    connection: name.describe('ProviderConnection id in the document'),
    source: z.string().min(1).max(MAX_TEXT_LENGTH).describe('Provider-defined signal address (e.g. a sim waveform "sine:20:15:90")'),
    transform: z.record(z.string(), z.unknown()).optional().describe('Optional ValueTransform: scale / threshold / map / format'),
  })
  .strict();

const READ: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const DEG = 180 / Math.PI;

/** One object as `scene_get` (summary view) and edit results show it. */
function objectSummary(o: IsoPlacement): Record<string, unknown> {
  const out: Record<string, unknown> = { id: o.id, object: o.object, x: o.x, y: o.y };
  if (o.rotation) out.rotationDegrees = Math.round(o.rotation * DEG);
  if (o.toX !== undefined || o.toY !== undefined) Object.assign(out, { toX: o.toX, toY: o.toY });
  if (o.onPipe !== undefined) Object.assign(out, { onPipe: o.onPipe, at: o.at });
  if (o.params && Object.keys(o.params).length) out.params = o.params;
  if (o.bindings && Object.keys(o.bindings).length) out.bindings = o.bindings;
  const extra = o as unknown as Record<string, unknown>;
  for (const key of ['attach', 'layer', 'group', 'label']) if (extra[key] !== undefined) out[key] = extra[key];
  return out;
}

function documentSummary(loaded: Pick<LoadedDocument, 'path' | 'etag' | 'document'>): Record<string, unknown> {
  const doc = loaded.document;
  const counts: Record<string, number> = {};
  for (const o of doc.body.objects) counts[o.object] = (counts[o.object] ?? 0) + 1;
  return {
    path: loaded.path,
    etag: loaded.etag,
    id: doc.id,
    name: doc.name,
    engine: doc.engine,
    theme: doc.theme ?? null,
    objectCount: doc.body.objects.length,
    objectsByPart: counts,
    connections: (doc.connections ?? []).map((c) => ({ id: c.id, provider: c.provider, label: c.label ?? null })),
    requires: doc.requires ?? {},
    metadata: doc.metadata ?? {},
  };
}

/** Most signal nodes one `provider_browse` returns (the tab caps at the same number). */
const MAX_BROWSE_NODES = 500;
const OFFLINE_BROWSE_TIMEOUT_MS = 10_000;
/** Providers `provider_browse` may connect in this process for a document file: no network, no secrets. */
const OFFLINE_PROVIDERS = new Set([SIM_PROVIDER_ID]);

/**
 * Browse a provider that needs no network and no secrets (the simulator) in
 * this process: connect, list, close. Its context refuses network use.
 */
async function browseOffline(host: HolodeckHost, provider: HolodeckProvider, connection: ProviderConnection, path: string | undefined): Promise<SignalNode[]> {
  const abort = new AbortController();
  const ctx: ProviderContext = {
    connectionId: connection.id,
    secret: async () => undefined,
    fetch: (async () => {
      throw new Error('network use is not allowed here');
    }) as typeof fetch,
    now: () => Date.now(),
    registry: host.registry,
    log: () => undefined,
    signal: abort.signal,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError(`provider "${provider.id}" did not answer in time`, [], 'timeout')), OFFLINE_BROWSE_TIMEOUT_MS);
  });
  let session: Awaited<ReturnType<HolodeckProvider['connect']>> | undefined;
  try {
    session = await Promise.race([provider.connect(connection.config ?? {}, ctx), deadline]);
    if (!session.browse) throw new ToolError(`provider "${provider.id}" cannot list its signals`, [], 'unsupported');
    return await Promise.race([session.browse(path), deadline]);
  } finally {
    clearTimeout(timer);
    abort.abort();
    await session?.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function createHolodeckMcpServer(options: HolodeckMcpOptions): Promise<HolodeckMcp> {
  const host = options.host ?? (await createMcpHost());
  const workspace = await Workspace.open(options.root);
  const context: ServerContext = {
    tier: options.tier ?? DEFAULT_TIER,
    host,
    workspace,
    store: new DocumentStore(workspace, host, options.now),
    renderer: options.renderer ?? new SceneRenderer(),
    bridge: options.bridge ?? new PlaygroundBridge(),
    current: null,
  };
  const server = new McpServer(
    { name: HOLODECK_MCP_NAME, version: HOLODECK_MCP_VERSION },
    {
      instructions: [
        'Holodeck scenes are holodeck.document.v1 files (.holodeck.json) under the workspace root.',
        'Typical loop: parts_list / parts_get to learn parts (params, ports), scene_new or scene_open,',
        'scene_add_object, scene_connect (pipes between ports), scene_update_params, scene_bind, then scene_validate / scene_get.',
        'Every edit is validated like a studio save; an invalid edit is refused with every problem listed and nothing is written.',
        `When the user runs pnpm playground, path "${PLAYGROUND_PATH}" edits the scene open in their browser tab live (one undo step per call);`,
        'playground_status says whether one is connected, playground_state / playground_screenshot read it back. Providers: provider_list, provider_connect, provider_browse.',
      ].join(' '),
    },
  );

  /**
   * Register one tool: tier check, then the handler; a ToolError becomes an
   * agent-readable error result. A handler returns a JSON payload, or a
   * finished CallToolResult (`raw`, e.g. an image).
   */
  const tool = <Shape extends ZodRawShape>(
    toolName: string,
    spec: { title: string; description: string; tier: Tier; input: Shape; annotations: ToolAnnotations },
    handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<Record<string, unknown> | { raw: CallToolResult }>,
  ) => {
    server.registerTool(
      toolName,
      { title: spec.title, description: `${spec.description} [tier: ${spec.tier}]`, inputSchema: spec.input, annotations: spec.annotations },
      (async (args: z.infer<z.ZodObject<Shape>>): Promise<CallToolResult> => {
        if (!tierAllows(context.tier, spec.tier)) {
          return errorResult(
            new ToolError(`${toolName} needs tier "${spec.tier}"; this server runs at "${context.tier}"`, [`restart the server with HOLODECK_MCP_TIER=${spec.tier}`], 'tier'),
          );
        }
        try {
          const out = await handler(args);
          return 'raw' in out && typeof out.raw === 'object' && out.raw !== null && 'content' in out.raw ? (out.raw as CallToolResult) : okResult(out as Record<string, unknown>);
        } catch (error) {
          return errorResult(error);
        }
      }) as never,
    );
  };

  const pathOf = (path: string | undefined): string => {
    const chosen = path ?? context.current;
    if (!chosen) throw new ToolError('no document given', ['pass path, or call scene_open first'], 'no_document');
    return chosen;
  };

  /**
   * The playground tab's working copy, validated like a file (the bridge
   * returns it with an etag that changes whenever the user edits).
   */
  const loadPlayground = async (): Promise<LoadedDocument & { state: SessionState }> => {
    const state = (await context.bridge.call('state', { metrics: false })) as SessionState;
    const parsed = context.store.parse(JSON.stringify(state.document), 'the playground document');
    return { path: PLAYGROUND_PATH, etag: String(state.etag), document: parsed.document, wrapped: false, state };
  };
  const load = (path: string): Promise<LoadedDocument> => (path === PLAYGROUND_PATH ? loadPlayground() : context.store.load(path));

  /** Validate `doc` as a save would, then have the tab commit its body as ONE undo step (`apply`). */
  const applyPlayground = async (basedOn: string, doc: IsoDoc): Promise<LoadedDocument> => {
    const checked = context.store.check(doc);
    const applied = (await context.bridge.call('apply', { etag: basedOn, scene: checked.body })) as EditResult;
    return { path: PLAYGROUND_PATH, etag: String(applied.etag), document: context.store.parse(JSON.stringify(applied.document), 'the playground document').document, wrapped: false };
  };
  /** Playground edits from this server run one at a time, like file edits. */
  const playgroundLocks = new Map<string, Promise<unknown>>();
  const exclusive = <T,>(target: string, fn: () => Promise<T>): Promise<T> =>
    target === PLAYGROUND_PATH ? serialised(playgroundLocks, PLAYGROUND_PATH, fn) : workspace.exclusive(target, fn);

  /**
   * Load, run `fn` on a SceneEditor, validate and save. One tool call = one
   * write (for `@playground`: one undo step in the tab). Edits of one document run one at a time (`Workspace.exclusive`), so
   * two concurrent calls both apply instead of one overwriting the other.
   */
  const edit = async <R,>(
    path: string | undefined,
    expected: string | undefined,
    fn: (editor: SceneEditor, doc: IsoDoc) => R,
  ): Promise<{ result: R; saved: LoadedDocument; editor: SceneEditor; before: LoadedDocument }> => {
    const target = pathOf(path);
    return exclusive(target, async () => {
      const loaded = await load(target);
      if (expected !== undefined && expected !== loaded.etag) {
        throw new ToolError(`${loaded.path} changed since you read it (etag ${expected}, now ${loaded.etag})`, ['read it again (scene_get) and redo the edit'], 'conflict');
      }
      const editor = new SceneEditor(loaded.document.body, host.registry);
      const result = fn(editor, loaded.document);
      if (!editor.changed) throw new ToolError('nothing changed', editor.notices, 'no_change');
      const next: IsoDoc = { ...loaded.document, body: editor.scene };
      const saved = target === PLAYGROUND_PATH ? await applyPlayground(loaded.etag, next) : await context.store.save(loaded.path, next, loaded.etag);
      return { result, saved, editor, before: loaded };
    });
  };

  /**
   * The acknowledgement of a saved edit. It must never fail after the write
   * (holodeck#263 review: a too_large error for a committed edit invites a
   * duplicate retry), so when the objects' details would not fit, only their
   * ids are returned.
   */
  const editResult = (saved: LoadedDocument, editor: SceneEditor, ids: readonly string[], extra: Record<string, unknown> = {}) => {
    const byId = new Map(saved.document.body.objects.map((o) => [o.id, o]));
    const base = { path: saved.path, etag: saved.etag, objectCount: saved.document.body.objects.length, ...extra, notices: editor.notices.map((n) => n.slice(0, 500)) };
    const full = { ...base, objects: ids.flatMap((id) => (byId.has(id) ? [objectSummary(byId.get(id)!)] : [])) };
    if (JSON.stringify(full, null, 2).length <= MAX_ACK_CHARS) return full;
    return { ...base, objectIds: ids.slice(0, MAX_IDS_PER_CALL), objectsOmitted: 'saved; the details are too large to return here: scene_get with objectIds reads them' };
  };

  // --- Info -----------------------------------------------------------------

  tool(
    'holodeck_info',
    {
      title: 'Server info',
      description: 'Workspace root, permission tier, and the installed engines, packages and providers.',
      tier: 'read',
      input: {},
      annotations: READ,
    },
    async () => ({
      name: HOLODECK_MCP_NAME,
      version: HOLODECK_MCP_VERSION,
      root: workspace.root,
      tier: context.tier,
      tiers: TIERS,
      current: context.current,
      engines: host.engines().map((e) => ({ id: e.id, label: e.label, apiVersion: e.apiVersion, documentFormat: e.documentFormat })),
      packages: host.packages().map((p) => ({ id: p.manifest.id, name: p.manifest.name, version: p.manifest.version })),
      providers: host.registry.list<{ id: string; label?: string }>('holodeck.provider').map((p) => ({ id: p.id, label: p.label ?? p.id })),
    }),
  );

  // --- Library --------------------------------------------------------------

  tool(
    'parts_list',
    {
      title: 'List parts',
      description:
        'Placeable parts of every installed package (the studio library sidebar). Search terms must all appear in the label, id, category, hint or package name.',
      tier: 'read',
      input: {
        query: z.string().max(MAX_TEXT_LENGTH).optional(),
        category: z.string().max(MAX_NAME_LENGTH).optional(),
        package: z.string().max(MAX_NAME_LENGTH).optional().describe('Package id, e.g. holodeck.iso or holodeck.cloud'),
        limit: z.number().int().min(1).max(MAX_PARTS_PAGE).default(100),
        offset: z.number().int().min(0).default(0),
      },
      annotations: READ,
    },
    async (args) => ({ ...listParts(host, { query: args.query, category: args.category, package: args.package, limit: args.limit, offset: args.offset }) }),
  );

  tool(
    'parts_get',
    {
      title: 'Describe a part',
      description: 'Full contract of one part: params (type, default, min/max, options), ports (for scene_connect), anim nodes, footprint.',
      tier: 'read',
      input: { id: name.describe('Part id, e.g. tank, valve, pipe, label') },
      annotations: READ,
    },
    async (args) => ({ part: partDetail(host, args.id) }),
  );

  // --- Scenes: read ---------------------------------------------------------

  tool(
    'scene_list',
    {
      title: 'List documents',
      description: 'Every .holodeck.json document under the workspace root (hidden folders and node_modules skipped).',
      tier: 'read',
      input: { limit: z.number().int().min(1).max(MAX_IDS_PER_CALL).default(200) },
      annotations: READ,
    },
    async (args) => ({ root: workspace.root, documents: await workspace.list(args.limit) }),
  );

  tool(
    'scene_open',
    {
      title: 'Open a document',
      description: 'Validate a document and make it the default for the other scene tools (so they can omit path).',
      tier: 'read',
      input: { path: docPath },
      annotations: READ,
    },
    async (args) => {
      const loaded = await load(args.path);
      context.current = loaded.path;
      return { ...documentSummary(loaded), wrapped: loaded.wrapped };
    },
  );

  tool(
    'scene_get',
    {
      title: 'Read a document',
      description:
        'The document: view "summary" (default) lists every object compactly; "full" returns the whole validated document JSON. objectIds narrows either to those objects.',
      tier: 'read',
      input: {
        path: optionalPath,
        view: z.enum(['summary', 'full']).default('summary'),
        objectIds: z.array(name).max(MAX_IDS_PER_CALL).optional(),
      },
      annotations: READ,
    },
    async (args) => {
      const loaded = await load(pathOf(args.path));
      const wanted = args.objectIds ? new Set(args.objectIds) : null;
      const objects = loaded.document.body.objects.filter((o) => !wanted || wanted.has(o.id));
      const missing = args.objectIds?.filter((id: string) => !objects.some((o) => o.id === id)) ?? [];
      if (args.view === 'full') {
        const document = wanted ? { ...loaded.document, body: { ...loaded.document.body, objects } } : loaded.document;
        return { path: loaded.path, etag: loaded.etag, document, missing };
      }
      return { ...documentSummary(loaded), objects: objects.map(objectSummary), missing };
    },
  );

  tool(
    'scene_validate',
    {
      title: 'Validate a document',
      description:
        'Check a document as the studio does on import: envelope, engine, requires, body against the installed parts, bindings, credential rules. Pass path (a file) or document (a JSON value).',
      tier: 'read',
      input: {
        path: optionalPath,
        document: z.record(z.string(), z.unknown()).optional().describe('A document value to check instead of a file'),
      },
      annotations: READ,
    },
    async (args) => {
      if (args.document !== undefined && args.path !== undefined) throw new ToolError('pass path or document, not both');
      if (args.document !== undefined) {
        const problems = context.store.validateText(JSON.stringify(args.document));
        return { valid: problems.length === 0, problems };
      }
      try {
        const loaded = await load(pathOf(args.path));
        return { valid: true, problems: [], path: loaded.path, etag: loaded.etag, wrapped: loaded.wrapped };
      } catch (error) {
        if (error instanceof ToolError && error.code === 'invalid_document') return { valid: false, problems: [...error.problems] };
        throw error;
      }
    },
  );

  // --- Scenes: author -------------------------------------------------------

  tool(
    'scene_new',
    {
      title: 'Create a document',
      description:
        'Create a .holodeck.json document: template "empty" (default) or "starter" (the playground starter: tanks, valves, mixer, labels, and a bound secret-free holodeck.sim connection). Refuses to replace an existing file unless overwrite is true. Becomes the open document.',
      tier: 'author',
      input: {
        path: docPath,
        name: z.string().min(1).max(MAX_TEXT_LENGTH).optional(),
        template: z.enum(['empty', 'starter']).default('empty'),
        overwrite: z.boolean().default(false),
      },
      annotations: DESTRUCTIVE,
    },
    async (args) => {
      if (args.path === PLAYGROUND_PATH) {
        throw new ToolError('the playground document always exists', ['edit it with the scene tools (path "@playground"), or ask the user to press Reset in the page'], 'invalid_request');
      }
      const id = randomUUID();
      let doc: IsoDoc = args.template === 'starter' ? withDocumentId(createPlaygroundDocument(), id) : createIsoDocument(args.name, id);
      if (args.name !== undefined) doc = withDocumentName(doc, args.name.trim() || doc.name);
      // `undefined` = replace whatever is there; `null` = the file must not exist.
      const saved = await workspace.exclusive(args.path, () => context.store.save(args.path, doc, args.overwrite ? undefined : null));
      context.current = saved.path;
      return documentSummary(saved);
    },
  );

  tool(
    'scene_add_object',
    {
      title: 'Add an object',
      description:
        'Place a part, as the library "+" / a palette drop does: defaults stamped, inline parts (valves) attach to a pipe they land on. Without x/y it goes right of the scene. Run parts (pipe) are drawn from (x, y) to `to` (default 2 cells +x); prefer scene_connect for pipes between ports. Returns the new object ids.',
      tier: 'author',
      input: {
        path: optionalPath,
        etag,
        part: name.describe('Part id from parts_list'),
        x: coord.optional(),
        y: coord.optional(),
        to: point.optional().describe('Run parts only: the far end'),
        rotationDegrees: z.number().int().multipleOf(90).optional(),
        params: boundedRecord('params').optional().describe('Param values to set on the new object (see parts_get)'),
      },
      annotations: WRITE,
    },
    async (args) => {
      if ((args.x === undefined) !== (args.y === undefined)) throw new ToolError('pass both x and y, or neither');
      const { result, saved, editor } = await edit(args.path, args.etag, (ed) => {
        const at = args.x !== undefined && args.y !== undefined ? { x: args.x, y: args.y } : undefined;
        const added = ed.add(args.part, at, args.to);
        const primary = added[0]!;
        if (args.rotationDegrees !== undefined) ed.rotate(primary, args.rotationDegrees);
        if (args.params && Object.keys(args.params).length) ed.setParams(primary, args.params);
        return added;
      });
      return editResult(saved, editor, result, { added: result });
    },
  );

  tool(
    'scene_update_params',
    {
      title: 'Edit an object',
      description:
        'Set params of one object (null resets a param to the part default), and/or top-level placement fields such as fillColor, color, size, opacity, meta (null removes one). Position: scene_move; bindings: scene_bind.',
      tier: 'author',
      input: {
        path: optionalPath,
        etag,
        id: name,
        params: boundedRecord('params').optional(),
        fields: boundedRecord('fields').optional(),
      },
      annotations: WRITE,
    },
    async (args) => {
      if (!args.params && !args.fields) throw new ToolError('pass params and/or fields');
      const { saved, editor } = await edit(args.path, args.etag, (ed) => {
        if (args.params) ed.setParams(args.id, args.params);
        if (args.fields) ed.setFields(args.id, args.fields);
      });
      return editResult(saved, editor, [args.id]);
    },
  );

  tool(
    'scene_move',
    {
      title: 'Move / rotate an object',
      description:
        'Move an object like a canvas drag: pipes attached to it follow (re-routed), unless detach is true. Grouped objects move with their group. rotationDegrees sets the absolute rotation (multiple of 90).',
      tier: 'author',
      input: {
        path: optionalPath,
        etag,
        id: name,
        x: coord.optional(),
        y: coord.optional(),
        rotationDegrees: z.number().int().multipleOf(90).optional(),
        detach: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async (args) => {
      if ((args.x === undefined) !== (args.y === undefined)) throw new ToolError('pass both x and y, or neither');
      if (args.x === undefined && args.rotationDegrees === undefined) throw new ToolError('pass x and y, and/or rotationDegrees');
      const { saved, editor } = await edit(args.path, args.etag, (ed) => {
        if (args.rotationDegrees !== undefined) ed.rotate(args.id, args.rotationDegrees);
        if (args.x !== undefined && args.y !== undefined) ed.move(args.id, { x: args.x, y: args.y }, args.detach);
      });
      const after = saved.document.body.objects.find((o) => o.id === args.id);
      if (args.x !== undefined && after && (after.x !== args.x || after.y !== args.y)) {
        editor.notices.push(`ended at (${after.x}, ${after.y}): the move snapped to a port or was limited by an attached pipe`);
      }
      return editResult(saved, editor, [args.id]);
    },
  );

  tool(
    'scene_connect',
    {
      title: 'Connect with a pipe',
      description:
        'Draw a pipe between two ends with the pipe tool: each end is {id, port} (a port from parts_get) or a free cell {x, y}. The editor routes around obstacles (elbows added) and records the ports, so the pipe follows when either part moves. "attached" says whether each end snapped to the port asked for.',
      tier: 'author',
      input: { path: optionalPath, etag, from: connectEnd, to: connectEnd },
      annotations: WRITE,
    },
    async (args) => {
      const { result, saved, editor } = await edit(args.path, args.etag, (ed) => ed.connect(args.from, args.to));
      return editResult(saved, editor, result.added, { added: result.added, attached: result.attached });
    },
  );

  tool(
    'scene_remove',
    {
      title: 'Remove objects',
      description: 'Delete objects as the canvas Delete key does (pipe ends on a removed part are freed). A grouped object must be removed with its whole group.',
      tier: 'author',
      input: { path: optionalPath, etag, ids: z.array(name).min(1).max(MAX_IDS_PER_CALL) },
      annotations: DESTRUCTIVE,
    },
    async (args) => {
      const { saved, editor, before } = await edit(args.path, args.etag, (ed) => ed.remove(args.ids));
      const after = new Set(saved.document.body.objects.map((o) => o.id));
      return editResult(saved, editor, [], { removed: before.document.body.objects.map((o) => o.id).filter((id) => !after.has(id)) });
    },
  );

  tool(
    'scene_bind',
    {
      title: 'Bind a param to a signal',
      description:
        'Drive one object param from a provider signal: binding {connection, source, transform?} (connection = a document connection id, see scene_get), or null to unbind. Validated by the SDK (the connection must exist, the transform must fit) and the credential rules (no secrets in sources).',
      tier: 'author',
      input: { path: optionalPath, etag, id: name, param: name, binding: binding.nullable() },
      annotations: WRITE,
    },
    async (args) => {
      const { saved, editor } = await edit(args.path, args.etag, (ed) => ed.bind(args.id, args.param, args.binding as SignalBinding | null));
      return editResult(saved, editor, [args.id]);
    },
  );

  tool(
    'scene_export',
    {
      title: 'Export a document',
      description:
        'Export as "document" (the validated holodeck.document.v1 JSON, what the studio imports) or "components-csv" (one row per object). Returns the text, or writes it to `out` in the workspace (needs tier author; .holodeck.json / .components.csv).',
      tier: 'read',
      input: {
        path: optionalPath,
        format: z.enum(['document', 'components-csv']).default('document'),
        out: z.string().min(1).max(MAX_PATH_LENGTH).optional(),
        overwrite: z.boolean().default(false),
      },
      annotations: WRITE,
    },
    async (args) => {
      const loaded = await load(pathOf(args.path));
      const text = args.format === 'document' ? serializeDocument(loaded.document) : isoComponentsCsv(loaded.document.body, host.registry);
      if (args.out === undefined) return { path: loaded.path, format: args.format, text };
      if (!tierAllows(context.tier, 'author')) throw new ToolError(`writing an export needs tier "author"; this server runs at "${context.tier}"`, [], 'tier');
      const suffix = args.format === 'document' ? '.holodeck.json' : '.components.csv';
      const written = await workspace.write(args.out, text, args.overwrite ? undefined : null, suffix);
      return { path: loaded.path, format: args.format, out: written.path, bytes: Buffer.byteLength(text, 'utf8') };
    },
  );

  tool(
    'scene_render',
    {
      title: 'Render a document',
      description:
        'A PNG of the document as the studio draws it (run mode, scene fitted, params as stored; no live data), captured in headless Chromium with WebGPU. No WebGPU, a refused document, a timeout or a flat image is an explicit error, never a blank picture. Optionally also writes the PNG to `out` (.png, needs tier author). A PNG over ' +
        `${MAX_IMAGE_BYTES / 1024 / 1024} MB` +
        ' is not returned inline: too_large, or with `out` the file is written and only its metadata returned (inline: false). Needs the studio build (apps/studio: pnpm build).',
      tier: 'read',
      input: {
        path: optionalPath,
        width: z.number().int().min(MIN_SIDE).max(MAX_SIDE).default(1280),
        height: z.number().int().min(MIN_SIDE).max(MAX_SIDE).default(800),
        out: z.string().min(1).max(MAX_PATH_LENGTH).optional(),
        overwrite: z.boolean().default(false),
      },
      annotations: READ,
    },
    async (args) => {
      if (args.out !== undefined && !tierAllows(context.tier, 'author')) {
        throw new ToolError(`writing a render needs tier "author"; this server runs at "${context.tier}"`, [], 'tier');
      }
      if (args.out !== undefined) workspace.lexical(args.out, '.png');
      const loaded = await load(pathOf(args.path));
      const png = await context.renderer.render(loaded.document, { width: args.width, height: args.height });
      const meta: Record<string, unknown> = { path: loaded.path, etag: loaded.etag, width: args.width, height: args.height, bytes: png.byteLength };
      if (args.out !== undefined) meta.out = (await workspace.writeData(args.out, png, args.overwrite ? undefined : null, '.png')).path;
      // Too big to return inline (MAX_IMAGE_BYTES): with `out` the file is
      // written anyway and only the metadata comes back; without it, too_large.
      if (meta.out !== undefined && imageTooLarge(png)) {
        return { ...meta, inline: false, note: `the PNG (${png.byteLength} bytes) is over the ${MAX_IMAGE_BYTES}-byte inline limit: it was written to ${String(meta.out)} but is not returned here` };
      }
      return {
        raw: imageResult(png, meta, [
          'pass `out` (a .png path in the workspace) to write the image to a file instead',
          `or ask for a smaller width / height (now ${args.width} x ${args.height})`,
        ]),
      };
    },
  );

  // --- Playground (live tab over the bridge) ---------------------------------

  tool(
    'playground_status',
    {
      title: 'Playground status',
      description: `Is pnpm playground running with its MCP bridge, and which tabs are connected? The newest tab is the one "${PLAYGROUND_PATH}" edits. Never an error when nothing runs.`,
      tier: 'read',
      input: {},
      annotations: READ,
    },
    async () => {
      let found;
      try {
        found = await context.bridge.status();
      } catch (error) {
        if (error instanceof ToolError && error.code === 'no_bridge') return { running: false, file: context.bridge.file, reason: error.message, hints: [...error.problems] };
        throw error;
      }
      if (!found) {
        return { running: false, file: context.bridge.file, hints: ['ask the user to run: cd holodeck/apps/studio && pnpm playground', 'meanwhile, edit document files (scene_new / path)'] };
      }
      return {
        running: true,
        file: found.file,
        url: found.bridge.url,
        studio: found.bridge.studio,
        startedAt: found.bridge.startedAt,
        sessions: found.status.sessions,
        connected: found.status.sessions.length > 0,
        ...(found.status.sessions.length ? {} : { hints: [`open the playground page${found.bridge.studio ? ` (${found.bridge.studio})` : ''} in a browser`] }),
      };
    },
  );

  tool(
    'playground_state',
    {
      title: 'Read the live playground',
      description: `The scene open in the playground tab, as the user sees it (saved or not): etag (pass it to edits), active tab (edit / viewer; edits need edit), save status, selection, why edits would wait (busy), connection states and live values. view "summary" lists objects compactly, "full" returns the document. Scene tools edit it with path "${PLAYGROUND_PATH}".`,
      tier: 'read',
      input: {
        view: z.enum(['summary', 'full']).default('summary'),
        metrics: z.boolean().default(true).describe('Include the live values (bounded)'),
      },
      annotations: READ,
    },
    async (args) => {
      const state = (await context.bridge.call('state', { metrics: args.metrics })) as SessionState;
      const { document } = context.store.parse(JSON.stringify(state.document), 'the playground document');
      const loaded = { path: PLAYGROUND_PATH, etag: String(state.etag), document };
      const live = {
        tab: state.tab,
        save: state.save,
        selectedId: state.selectedId,
        busy: state.busy,
        connectionStates: state.connections,
        ...(state.metrics ? { metrics: state.metrics } : {}),
        ...(state.metricsOmitted ? { metricsOmitted: state.metricsOmitted } : {}),
      };
      if (args.view === 'full') return { path: PLAYGROUND_PATH, etag: loaded.etag, ...live, document };
      return { ...documentSummary(loaded), ...live, objects: document.body.objects.map(objectSummary) };
    },
  );

  tool(
    'playground_screenshot',
    {
      title: 'Screenshot the playground',
      description:
        'A PNG of the playground canvas as the user sees it now (live values, current camera). scale 1–4 multiplies the canvas size. Optionally also writes it to `out` (.png, needs tier author).',
      tier: 'read',
      input: {
        scale: z.number().min(1).max(4).default(1),
        out: z.string().min(1).max(MAX_PATH_LENGTH).optional(),
        overwrite: z.boolean().default(false),
      },
      annotations: READ,
    },
    async (args) => {
      if (args.out !== undefined && !tierAllows(context.tier, 'author')) {
        throw new ToolError(`writing a screenshot needs tier "author"; this server runs at "${context.tier}"`, [], 'tier');
      }
      if (args.out !== undefined) workspace.lexical(args.out, '.png');
      const shot = (await context.bridge.call('screenshot', { scale: args.scale })) as ScreenshotResult;
      if (typeof shot?.data !== 'string') throw new ToolError('the playground returned no image', [], 'playground');
      const png = new Uint8Array(Buffer.from(shot.data, 'base64'));
      const meta: Record<string, unknown> = { path: PLAYGROUND_PATH, width: shot.width, height: shot.height, bytes: png.byteLength };
      if (args.out !== undefined) meta.out = (await workspace.writeData(args.out, png, args.overwrite ? undefined : null, '.png')).path;
      // Same oversize rule as scene_render: written to `out`, not inlined.
      if (meta.out !== undefined && imageTooLarge(png)) {
        return { ...meta, inline: false, note: `the PNG (${png.byteLength} bytes) is over the ${MAX_IMAGE_BYTES}-byte inline limit: it was written to ${String(meta.out)} but is not returned here` };
      }
      return {
        raw: imageResult(png, meta, [
          'pass `out` (a .png path in the workspace) to write the image to a file instead',
          `or ask for a smaller scale (now ${args.scale})`,
        ]),
      };
    },
  );

  // --- Providers --------------------------------------------------------------

  const providers = () => host.registry.list<HolodeckProvider>('holodeck.provider');
  const providerOf = (id: string): HolodeckProvider => {
    const provider = providers().find((p) => p.id === id);
    if (!provider) throw new ToolError(`no provider "${id}" is installed`, [`installed: ${providers().map((p) => p.id).join(', ')}`], 'not_found');
    return provider;
  };
  /** Secrets the user must enter in the studio (an agent never handles them). */
  const requiredSecrets = (provider: HolodeckProvider) => (provider.secrets ?? []).filter((s) => !s.optional).map((s) => s.key);

  tool(
    'provider_list',
    {
      title: 'List providers',
      description:
        'Installed data providers (the studio Connections tab): id, capabilities, source syntax for bindings, the JSON Schema of the secret-free config provider_connect takes, and the secrets the user enters in the studio (never via tools).',
      tier: 'read',
      input: {},
      annotations: READ,
    },
    async () => ({
      providers: providers().map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description ?? null,
        capabilities: p.capabilities,
        sourceSyntax: p.sourceSyntax ?? null,
        configSchema: p.configSchema ?? null,
        secrets: (p.secrets ?? []).map((sec) => ({ key: sec.key, label: sec.label, optional: sec.optional === true })),
        network: p.origins ?? [],
      })),
    }),
  );

  tool(
    'provider_connect',
    {
      title: 'Add or replace a connection',
      description: `Add a ProviderConnection to a document (or replace the one with the same id): {id, provider, label?, config?}. Config must be secret-free: the studio's credential rules refuse tokens, passwords, Authorization headers, user:pass URLs and the like; secrets are entered by the user in the studio. On "${PLAYGROUND_PATH}" the tab connects it at once.`,
      tier: 'author',
      input: {
        path: optionalPath,
        etag,
        connection: z
          .object({
            id: name,
            provider: name,
            label: z.string().max(MAX_TEXT_LENGTH).optional(),
            config: z.record(z.string(), z.unknown()).optional(),
          })
          .strict(),
      },
      annotations: WRITE,
    },
    async (args) => {
      const target = pathOf(args.path);
      const provider = providerOf(args.connection.provider);
      const connection: ProviderConnection = {
        id: args.connection.id,
        provider: args.connection.provider,
        ...(args.connection.label ? { label: args.connection.label } : {}),
        ...(args.connection.config ? { config: args.connection.config } : {}),
      };
      const problems = connectionConfigProblems(connection, provider);
      if (problems.length) throw new ToolError('the connection config is refused', problems, 'invalid_connection');
      const missing = requiredSecrets(provider);
      const notices = missing.length ? [`the user must enter ${missing.join(', ')} for "${connection.id}" in the studio (Connections tab) before it connects`] : [];
      return exclusive(target, async () => {
        if (target === PLAYGROUND_PATH) {
          const done = (await context.bridge.call('connect', { connection, ...(args.etag ? { etag: args.etag } : {}) })) as EditResult;
          return { path: PLAYGROUND_PATH, etag: String(done.etag), connection, notices };
        }
        const loaded = await context.store.load(target);
        if (args.etag !== undefined && args.etag !== loaded.etag) {
          throw new ToolError(`${loaded.path} changed since you read it (etag ${args.etag}, now ${loaded.etag})`, ['read it again (scene_get) and redo the edit'], 'conflict');
        }
        const existing = loaded.document.connections ?? [];
        const replaced = existing.some((c) => c.id === connection.id);
        const connections = replaced ? existing.map((c) => (c.id === connection.id ? connection : c)) : [...existing, connection];
        const saved = await context.store.save(loaded.path, { ...loaded.document, connections }, loaded.etag);
        return { path: saved.path, etag: saved.etag, connection, replaced, notices };
      });
    },
  );

  tool(
    'provider_browse',
    {
      title: 'Browse a connection\'s signals',
      description: `List the signals of one of a document's connections (a tree: pass a node's path to list its children; leaves carry the "source" to bind with scene_bind). On "${PLAYGROUND_PATH}" the tab's live connection answers; on a file only the simulator (holodeck.sim, no network or secrets) can be browsed here.`,
      tier: 'read',
      input: {
        path: optionalPath,
        connection: name.describe('Connection id in the document'),
        signalPath: z.string().max(MAX_TEXT_LENGTH).optional().describe('A node path from an earlier browse (default: the root)'),
      },
      annotations: READ,
    },
    async (args) => {
      const target = pathOf(args.path);
      if (target === PLAYGROUND_PATH) {
        const out = (await context.bridge.call('browse', { connection: args.connection, ...(args.signalPath !== undefined ? { path: args.signalPath } : {}) })) as {
          nodes: SignalNode[];
          truncated: boolean;
        };
        return { path: PLAYGROUND_PATH, connection: args.connection, nodes: out.nodes, truncated: out.truncated };
      }
      const loaded = await context.store.load(target);
      const connection = (loaded.document.connections ?? []).find((c) => c.id === args.connection);
      if (!connection) throw new ToolError(`${loaded.path} has no connection "${args.connection}"`, [`connections: ${(loaded.document.connections ?? []).map((c) => c.id).join(', ') || 'none'}`], 'not_found');
      const provider = providerOf(connection.provider);
      // Only providers known to work offline run in this process: others may
      // read any URL their config names (holodeck.http declares no fixed
      // origins) or need the user's secrets.
      if (!OFFLINE_PROVIDERS.has(provider.id)) {
        throw new ToolError(
          `browsing "${connection.provider}" needs the network or secrets, which this server does not use`,
          [`open the document in the playground and browse with path "${PLAYGROUND_PATH}"`, 'or read the provider\'s source syntax in provider_list'],
          'needs_playground',
        );
      }
      if (!provider.capabilities.browse) throw new ToolError(`provider "${provider.id}" cannot list its signals`, ['read its source syntax in provider_list'], 'unsupported');
      const nodes = await browseOffline(host, provider, connection, args.signalPath);
      return { path: loaded.path, connection: args.connection, nodes: nodes.slice(0, MAX_BROWSE_NODES), truncated: nodes.length > MAX_BROWSE_NODES };
    },
  );

  // Close the render browser and the bridge link with the server (transport closed, client gone).
  server.server.onclose = () => {
    context.bridge.close();
    void context.renderer.close();
  };
  const close = async () => {
    await server.close();
    context.bridge.close();
    await context.renderer.close();
  };
  return { server, context, close };
}
