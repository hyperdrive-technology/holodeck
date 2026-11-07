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
import type { HolodeckHost, SignalBinding } from '@holodeck/sdk';
import { isoComponentsCsv, type IsoPlacement } from '@holodeck/editor-2.5d-react';
import { DocumentStore, type IsoDoc, type LoadedDocument } from './documents';
import { ToolError } from './errors';
import { createMcpHost } from './host';
import {
  MAX_COORD,
  MAX_IDS_PER_CALL,
  MAX_NAME_LENGTH,
  MAX_PARAMS_PER_CALL,
  MAX_PARTS_PAGE,
  MAX_PATH_LENGTH,
  MAX_TEXT_LENGTH,
} from './limits';
import { listParts, partDetail } from './parts';
import { errorResult, okResult } from './result';
import { SceneEditor } from './scene-editor';
import { createIsoDocument, createPlaygroundDocument, serializeDocument, withDocumentId, withDocumentName } from './studio';
import { DEFAULT_TIER, TIERS, tierAllows, type Tier } from './tiers';
import { Workspace } from './workspace';

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
}

/** What the tools share. `current` is the document `scene_open` selected. */
export interface ServerContext {
  tier: Tier;
  host: HolodeckHost;
  workspace: Workspace;
  store: DocumentStore;
  current: string | null;
}

export interface HolodeckMcp {
  server: McpServer;
  context: ServerContext;
}

// ---------------------------------------------------------------------------
// Schemas (every string and collection is bounded)
// ---------------------------------------------------------------------------

const name = z.string().min(1).max(MAX_NAME_LENGTH);
const coord = z.number().finite().min(-MAX_COORD).max(MAX_COORD);
const point = z.object({ x: coord, y: coord }).strict();
const docPath = z.string().min(1).max(MAX_PATH_LENGTH).describe('Document path relative to the workspace root, ending in .holodeck.json');
const optionalPath = docPath.optional().describe('Document path (default: the document scene_open selected)');
const etag = z.string().max(64).optional().describe('The etag from scene_get / the last edit: refuse if the file changed since (optional)');
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
      ].join(' '),
    },
  );

  /** Register one tool: tier check, then the handler; a ToolError becomes an agent-readable error result. */
  const tool = <Shape extends ZodRawShape>(
    toolName: string,
    spec: { title: string; description: string; tier: Tier; input: Shape; annotations: ToolAnnotations },
    handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<Record<string, unknown>>,
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
          return okResult(await handler(args));
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

  /** Load, run `fn` on a SceneEditor, validate and save. One tool call = one write. */
  const edit = async <R,>(
    path: string | undefined,
    expected: string | undefined,
    fn: (editor: SceneEditor, doc: IsoDoc) => R,
  ): Promise<{ result: R; saved: LoadedDocument; editor: SceneEditor; before: LoadedDocument }> => {
    const loaded = await context.store.load(pathOf(path));
    if (expected !== undefined && expected !== loaded.etag) {
      throw new ToolError(`${loaded.path} changed since you read it (etag ${expected}, now ${loaded.etag})`, ['read it again (scene_get) and redo the edit'], 'conflict');
    }
    const editor = new SceneEditor(loaded.document.body, host.registry);
    const result = fn(editor, loaded.document);
    if (!editor.changed) throw new ToolError('nothing changed', editor.notices, 'no_change');
    const saved = await context.store.save(loaded.path, { ...loaded.document, body: editor.scene }, loaded.etag);
    return { result, saved, editor, before: loaded };
  };

  const editResult = (saved: LoadedDocument, editor: SceneEditor, ids: readonly string[], extra: Record<string, unknown> = {}) => {
    const byId = new Map(saved.document.body.objects.map((o) => [o.id, o]));
    return {
      path: saved.path,
      etag: saved.etag,
      objectCount: saved.document.body.objects.length,
      ...extra,
      objects: ids.flatMap((id) => (byId.has(id) ? [objectSummary(byId.get(id)!)] : [])),
      notices: editor.notices,
    };
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
      const loaded = await context.store.load(args.path);
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
      const loaded = await context.store.load(pathOf(args.path));
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
        const loaded = await context.store.load(pathOf(args.path));
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
      const id = randomUUID();
      let doc: IsoDoc = args.template === 'starter' ? withDocumentId(createPlaygroundDocument(), id) : createIsoDocument(args.name, id);
      if (args.name !== undefined) doc = withDocumentName(doc, args.name.trim() || doc.name);
      // `undefined` = replace whatever is there; `null` = the file must not exist.
      const saved = await context.store.save(args.path, doc, args.overwrite ? undefined : null);
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
      const loaded = await context.store.load(pathOf(args.path));
      const text = args.format === 'document' ? serializeDocument(loaded.document) : isoComponentsCsv(loaded.document.body, host.registry);
      if (args.out === undefined) return { path: loaded.path, format: args.format, text };
      if (!tierAllows(context.tier, 'author')) throw new ToolError(`writing an export needs tier "author"; this server runs at "${context.tier}"`, [], 'tier');
      const suffix = args.format === 'document' ? '.holodeck.json' : '.components.csv';
      const written = await workspace.write(args.out, text, args.overwrite ? undefined : null, suffix);
      return { path: loaded.path, format: args.format, out: written.path, bytes: Buffer.byteLength(text, 'utf8') };
    },
  );

  return { server, context };
}
