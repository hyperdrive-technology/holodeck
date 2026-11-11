/**
 * What the playground tab does for the MCP server (over the bridge, see
 * bridge-protocol.ts). Kept free of React so it is tested with fakes; the
 * hook (use-mcp-bridge.ts) supplies the live session.
 *
 *   state       the working copy, its etag, tab, save status, connections, live values
 *   apply       commit a scene the MCP server computed (it ran the editor's
 *               reducer on a copy) as ONE editor undo step (`apply-scene`)
 *   connect     add / replace a secret-free connection (the studio's credential rules)
 *   browse      list a connection's signals through the tab's live provider session
 *   screenshot  PNG of the canvas (`ProcessEditorHandle.exportImage`)
 *
 * Every edit names the etag it was computed from; if the user changed the
 * scene meanwhile the tab refuses (`conflict`) and the server recomputes.
 */

import { EDIT_REJECTED_PREFIX, editorReducer, type EditorState, type IsoMetrics, type IsoSceneFile, type ProcessEditorHandle } from '@holodeck/editor-2.5d-react';
import { HOLODECK_KINDS, type ConnectionState, type ContributionRegistry, type HolodeckProvider, type ProviderConnection, type SignalNode } from '@holodeck/sdk';
import { connectionConfigProblems } from '../connections/credentials';
import {
  BridgeError,
  type ApplyParams,
  type BrowseParams,
  type ConnectParams,
  type EditResult,
  type ScreenshotParams,
  type ScreenshotResult,
  type SessionState,
  type StateParams,
} from './bridge-protocol';
import type { IsoDoc } from '../features/use-document-session';

/** Live values larger than this (JSON characters) are left out of `state`. */
export const MAX_STATE_METRICS_CHARS = 64 * 1024;
/** Most signal nodes one `browse` returns. */
export const MAX_BROWSE_NODES = 500;
/** How long `apply` waits for the canvas to commit (one React render, normally). */
export const APPLY_TIMEOUT_MS = 5_000;

export interface PlaygroundBridgeDeps {
  /** The working copy now. */
  doc: () => IsoDoc;
  editor: () => ProcessEditorHandle | null;
  tab: () => string;
  /** A dialog that owns the working copy is open (reset, conflict, rebuilding): edits wait. */
  blocked: () => string | null;
  save: () => { status: string; revision: number; dirty: boolean };
  selectedId: () => string | null;
  statuses: () => Readonly<Record<string, ConnectionState>>;
  metrics: () => IsoMetrics;
  providers: () => readonly HolodeckProvider[];
  /** The studio's connection save (envelope edit, autosaved). */
  saveConnection: (connection: ProviderConnection, isNew: boolean) => void;
  browse: (connectionId: string, path: string | undefined) => Promise<SignalNode[]>;
  /** Next animation frame / tick (tests use a microtask). */
  tick?: () => Promise<void>;
  now?: () => number;
}

export type PlaygroundBridgeHandler = (method: string, params: unknown) => Promise<unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a gesture in progress or an armed tool means: an apply now would drop the user's work. */
export function gestureInProgress(state: EditorState): string | null {
  if (state.drag) return 'the user is dragging an object';
  if (state.resize) return 'the user is resizing an object';
  if (state.linkDrag || state.linkStart) return 'the user is drawing a connector';
  if (state.pipeStart) return 'the user is drawing a pipe';
  return null;
}

export function createPlaygroundBridgeHandler(deps: PlaygroundBridgeDeps): PlaygroundBridgeHandler {
  const tick = deps.tick ?? (() => new Promise<void>((done) => setTimeout(done, 16)));
  const now = deps.now ?? (() => Date.now());
  // Working copies are replaced, never mutated, so object identity is the
  // version. The nonce makes etags from an earlier page load never match.
  const nonce = Math.random().toString(36).slice(2, 10);
  const versions = new WeakMap<object, number>();
  let counter = 0;
  const etagOf = (doc: IsoDoc) => {
    let n = versions.get(doc);
    if (n === undefined) {
      counter += 1;
      n = counter;
      versions.set(doc, n);
    }
    return `${nonce}.${n}`;
  };
  const result = (): EditResult => {
    const doc = deps.doc();
    return { etag: etagOf(doc), document: doc };
  };

  /** Why an edit cannot run now, or null. */
  const busy = (): string | null => deps.blocked() ?? (deps.editor() ? gestureInProgress(deps.editor()!.getState()) : 'the canvas is not ready');

  const checkEditable = (etag: unknown) => {
    if (deps.tab() !== 'edit') {
      throw new BridgeError('the playground is on its Viewer tab, where the scene is read-only', 'viewer', ['ask the user to switch to the Edit tab, or edit a document on disk (pass path)']);
    }
    const why = busy();
    if (why) throw new BridgeError(`the playground cannot take an edit right now: ${why}`, 'busy', ['retry in a moment']);
    if (typeof etag === 'string' && etag !== etagOf(deps.doc())) {
      throw new BridgeError('the playground scene changed since it was read', 'conflict', ['read it again (playground_state) and redo the edit']);
    }
  };

  const state = (params: StateParams | undefined): SessionState => {
    const doc = deps.doc();
    const connections: SessionState['connections'] = {};
    for (const [id, c] of Object.entries(deps.statuses())) {
      connections[id] = { provider: c.provider, state: c.status.state, ...(c.status.message ? { message: c.status.message.slice(0, 500) } : {}) };
    }
    const out: SessionState = {
      etag: etagOf(doc),
      document: doc,
      tab: deps.tab(),
      save: deps.save(),
      selectedId: deps.selectedId(),
      busy: busy(),
      connections,
    };
    if (params?.metrics !== false) {
      const metrics = deps.metrics();
      if (JSON.stringify(metrics).length <= MAX_STATE_METRICS_CHARS) out.metrics = metrics;
      else out.metricsOmitted = `more than ${MAX_STATE_METRICS_CHARS} characters of live values`;
    }
    return out;
  };

  const apply = async (params: ApplyParams): Promise<EditResult> => {
    if (!isObj(params) || typeof params.etag !== 'string' || !isObj(params.scene)) throw new BridgeError('apply needs etag and scene', 'invalid');
    checkEditable(params.etag);
    const editor = deps.editor()!;
    const scene = params.scene as unknown as IsoSceneFile;
    if (scene.id !== deps.doc().body.id) throw new BridgeError(`the scene is for document "${String(scene.id)}", not the playground`, 'invalid');
    // Dry run first on the editor's current state (the reducer is pure): a
    // refusal is reported at once and deterministically, even when it repeats
    // the notice already on screen (comparing notices could not tell).
    const trial = editorReducer(editor.getState(), { type: 'apply-scene', scene });
    if (trial.scene !== scene) {
      throw new BridgeError('the canvas refused the edit', 'invalid_edit', trial.notice?.startsWith(EDIT_REJECTED_PREFIX) ? [trial.notice] : []);
    }
    editor.dispatch({ type: 'apply-scene', scene });
    // The editor commits on its next render (keeping this very object as its
    // scene) and reports it through onChange; the session then makes it the
    // working copy and autosaves it. Done when the working copy is our object.
    // The dry run passed, so a miss here means the canvas changed in between.
    const deadline = now() + APPLY_TIMEOUT_MS;
    for (;;) {
      if (deps.doc().body === scene) return result();
      if (now() > deadline) throw new BridgeError('the canvas did not commit the edit in time', 'timeout', ['read the scene again (playground_state) and redo the edit']);
      await tick();
    }
  };

  const connect = (params: ConnectParams): EditResult => {
    if (!isObj(params) || !isObj(params.connection)) throw new BridgeError('connect needs a connection', 'invalid');
    if (params.etag !== undefined && typeof params.etag !== 'string') throw new BridgeError('etag must be a string', 'invalid');
    checkEditable(params.etag);
    const c = params.connection;
    if (typeof c.id !== 'string' || !c.id || typeof c.provider !== 'string') throw new BridgeError('a connection needs id and provider', 'invalid');
    if (c.label !== undefined && typeof c.label !== 'string') throw new BridgeError('a connection label must be a string', 'invalid');
    if (c.config !== undefined && !isObj(c.config)) throw new BridgeError('a connection config must be an object', 'invalid');
    const provider = deps.providers().find((p) => p.id === c.provider);
    if (!provider) throw new BridgeError(`no provider "${c.provider}" is installed`, 'not_found', [`installed: ${deps.providers().map((p) => p.id).join(', ')}`]);
    const connection: ProviderConnection = { id: c.id, provider: c.provider, ...(c.label ? { label: c.label } : {}), ...(c.config ? { config: c.config } : {}) };
    const problems = connectionConfigProblems(connection, provider);
    if (problems.length) throw new BridgeError('the connection config is refused', 'invalid', problems);
    const isNew = !(deps.doc().connections ?? []).some((x) => x.id === c.id);
    deps.saveConnection(connection, isNew);
    return result();
  };

  const browse = async (params: BrowseParams): Promise<{ nodes: SignalNode[]; truncated: boolean }> => {
    if (!isObj(params) || typeof params.connection !== 'string') throw new BridgeError('browse needs connection', 'invalid');
    if (!(deps.doc().connections ?? []).some((c) => c.id === params.connection)) {
      throw new BridgeError(`the playground has no connection "${params.connection}"`, 'not_found');
    }
    const nodes = await deps.browse(params.connection, typeof params.path === 'string' ? params.path : undefined);
    return { nodes: nodes.slice(0, MAX_BROWSE_NODES), truncated: nodes.length > MAX_BROWSE_NODES };
  };

  const screenshot = async (params: ScreenshotParams | undefined): Promise<ScreenshotResult> => {
    const editor = deps.editor();
    if (!editor) throw new BridgeError('the canvas is not ready', 'busy');
    const scale = typeof params?.scale === 'number' && params.scale >= 1 && params.scale <= 4 ? params.scale : 1;
    let image;
    try {
      image = await editor.exportImage({ scale });
    } catch (error) {
      throw new BridgeError(`the playground could not capture its canvas: ${error instanceof Error ? error.message : String(error)}`, 'unsupported');
    }
    return { mimeType: 'image/png', data: await blobToBase64(image.blob), width: image.width, height: image.height };
  };

  return async (method, params) => {
    switch (method) {
      case 'state':
        return state(params as StateParams | undefined);
      case 'apply':
        return apply(params as ApplyParams);
      case 'connect':
        return connect(params as ConnectParams);
      case 'browse':
        return browse(params as BrowseParams);
      case 'screenshot':
        return screenshot(params as ScreenshotParams | undefined);
      default:
        throw new BridgeError(`unknown method "${method}"`, 'invalid');
    }
  };
}

/** Base64 of a Blob, in chunks (spreading a large array into fromCharCode overflows the stack). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Installed providers, from the host registry. */
export function installedProviders(registry: Pick<ContributionRegistry, 'list'>): readonly HolodeckProvider[] {
  return registry.list<HolodeckProvider>(HOLODECK_KINDS.provider);
}
