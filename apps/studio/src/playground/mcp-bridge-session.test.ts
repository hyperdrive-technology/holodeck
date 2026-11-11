/**
 * The playground tab's MCP request handler (mcp-bridge-session.ts) against a
 * fake session: a working copy the test owns, and a fake ProcessEditorHandle
 * that runs the editor's real reducer. Like the canvas, the fake applies a
 * dispatched action on the next "render" (`tick`) and reports a committed
 * change, which becomes the new working copy (what use-document-session does
 * through `onChange`).
 */
import { createEditorState, editorReducer, emptyScene, type EditorAction, type EditorState, type IsoMetrics, type IsoSceneFile, type ProcessEditorHandle } from '@holodeck/editor-2.5d-react';
import { createHttpProvider } from '@holodeck/provider-http';
import { HOLODECK_DOCUMENT_FORMAT, HOLODECK_KINDS, SIM_PROVIDER_ID, createSimProvider, type ConnectionState, type HolodeckProvider, type SignalNode } from '@holodeck/sdk';
import { describe, expect, it, vi } from 'vitest';
import { BridgeError, type EditResult, type ScreenshotResult, type SessionState } from './bridge-protocol';
import {
  APPLY_TIMEOUT_MS,
  MAX_BROWSE_NODES,
  MAX_STATE_METRICS_CHARS,
  blobToBase64,
  createPlaygroundBridgeHandler,
  gestureInProgress,
  installedProviders,
  type PlaygroundBridgeDeps,
} from './mcp-bridge-session';
import type { IsoDoc } from '../features/use-document-session';

const SCENE_ID = 'playground';
/** One canvas frame, in fake milliseconds (`now` advances by this per tick). */
const FRAME_MS = 16;

function makeDoc(): IsoDoc {
  return {
    format: HOLODECK_DOCUMENT_FORMAT,
    id: 'playground',
    name: 'Playground',
    engine: 'holodeck.iso',
    body: emptyScene(SCENE_ID),
    connections: [{ id: 'sim', provider: SIM_PROVIDER_ID }],
  };
}

/** PNG signature plus a few bytes, including ones above 0x7f (base64 must not mangle them). */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x80, 0x7f]);

/**
 * A fake playground session. `live` is what the deps read (mutate it to
 * change the world); `editorState` is the fake canvas's reducer state.
 */
function harness(overrides: Partial<PlaygroundBridgeDeps> = {}) {
  const live = {
    doc: makeDoc(),
    tab: 'edit',
    blocked: null as string | null,
    hasEditor: true,
    /** The canvas reports committed changes (false: an editor that never commits). */
    commits: true,
    metrics: {} as IsoMetrics,
    statuses: {} as Record<string, ConnectionState>,
    providers: [createSimProvider(), createHttpProvider()] as HolodeckProvider[],
    selectedId: null as string | null,
    clock: 1_000,
  };
  let editorState: EditorState = createEditorState(live.doc.body);
  const queued: EditorAction[] = [];
  const dispatched: EditorAction[] = [];

  /** One React render: run queued actions; a new revision is reported and becomes the working copy. */
  const render = () => {
    const revision = editorState.revision;
    for (const action of queued.splice(0)) editorState = editorReducer(editorState, action);
    if (live.commits && editorState.revision !== revision) live.doc = { ...live.doc, body: editorState.scene };
  };

  const exportImage = vi.fn<ProcessEditorHandle['exportImage']>(async (options) => {
    const scale = options?.scale ?? 1;
    return { width: 100 * scale, height: 50 * scale, tiles: 1, blob: new Blob([PNG_BYTES], { type: 'image/png' }) };
  });
  const editor: ProcessEditorHandle = {
    dispatch: (action) => {
      dispatched.push(action);
      queued.push(action);
    },
    getState: () => editorState,
    getCamera: () => ({ zoom: 1, target: [0, 0, 0] }),
    exportImage,
  };

  const saveConnection = vi.fn<PlaygroundBridgeDeps['saveConnection']>((connection, isNew) => {
    // What the studio does: add, or replace in place, in the envelope (a new working copy).
    const current = live.doc.connections ?? [];
    live.doc = { ...live.doc, connections: isNew ? [...current, connection] : current.map((c) => (c.id === connection.id ? connection : c)) };
  });
  const browse = vi.fn<PlaygroundBridgeDeps['browse']>(async () => []);
  const tick = vi.fn(async () => {
    render();
    live.clock += FRAME_MS;
  });

  const deps: PlaygroundBridgeDeps = {
    doc: () => live.doc,
    editor: () => (live.hasEditor ? editor : null),
    tab: () => live.tab,
    blocked: () => live.blocked,
    save: () => ({ status: 'saved', revision: 3, dirty: false }),
    selectedId: () => live.selectedId,
    statuses: () => live.statuses,
    metrics: () => live.metrics,
    providers: () => live.providers,
    saveConnection,
    browse,
    tick,
    now: () => live.clock,
    ...overrides,
  };
  const handle = createPlaygroundBridgeHandler(deps);
  return {
    live,
    handle,
    editor,
    exportImage,
    saveConnection,
    browse,
    tick,
    dispatched,
    render,
    getEditorState: () => editorState,
    setEditorState: (next: EditorState) => void (editorState = next),
    state: async (params?: unknown) => (await handle('state', params)) as SessionState,
  };
}

/** The BridgeError a call rejects with (fails the test when it resolves or throws something else). */
async function bridgeError(promise: Promise<unknown>): Promise<BridgeError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a BridgeError, the call succeeded');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BridgeError);
  return error as BridgeError;
}

const renamed = (name = 'Renamed'): IsoSceneFile => ({ ...emptyScene(SCENE_ID), name });

describe('state', () => {
  it('returns the working copy, tab, save status, selection and busy', async () => {
    const h = harness();
    h.live.selectedId = 'tank-1';
    const s = await h.state();
    expect(s.document).toBe(h.live.doc);
    expect(s).toMatchObject({ tab: 'edit', save: { status: 'saved', revision: 3, dirty: false }, selectedId: 'tank-1', busy: null, connections: {} });
    expect(s.etag).toMatch(/^[a-z0-9]+\.\d+$/);
  });

  it('etag is stable for the same working copy object and changes when it is replaced', async () => {
    const h = harness();
    const first = (await h.state()).etag;
    expect((await h.state()).etag).toBe(first);
    expect((await h.state({ metrics: false })).etag).toBe(first);
    // An equal but different object is a new version (copies are replaced, never mutated).
    h.live.doc = { ...h.live.doc };
    const second = (await h.state()).etag;
    expect(second).not.toBe(first);
    expect((await h.state()).etag).toBe(second);
  });

  it('etags from another handler (an earlier page load) never match, even for the same document object', async () => {
    // Two handlers over the same working copy object: different nonces.
    const a = harness();
    const b = createPlaygroundBridgeHandler({
      doc: () => a.live.doc,
      editor: () => a.editor,
      tab: () => 'edit',
      blocked: () => null,
      save: () => ({ status: 'saved', revision: 0, dirty: false }),
      selectedId: () => null,
      statuses: () => ({}),
      metrics: () => ({}),
      providers: () => [],
      saveConnection: () => undefined,
      browse: async () => [],
      tick: async () => undefined,
    });
    const etagA = (await a.state()).etag;
    const etagB = ((await b('state', undefined)) as SessionState).etag;
    expect(etagA).not.toBe(etagB);
    expect((await bridgeError(b('apply', { etag: etagA, scene: renamed() }))).code).toBe('conflict');
  });

  it('includes live values by default, leaves them out with metrics: false', async () => {
    const h = harness();
    h.live.metrics = { tank: { level: 42, alarm: true } };
    expect((await h.state()).metrics).toEqual({ tank: { level: 42, alarm: true } });
    expect((await h.state({})).metrics).toEqual({ tank: { level: 42, alarm: true } });
    expect((await h.state({ metrics: true })).metrics).toEqual({ tank: { level: 42, alarm: true } });
    const without = await h.state({ metrics: false });
    expect(without).not.toHaveProperty('metrics');
    expect(without).not.toHaveProperty('metricsOmitted');
  });

  it('omits live values over MAX_STATE_METRICS_CHARS (and keeps them at exactly the limit)', async () => {
    const h = harness();
    // `{"a":{"t":""}}` is 14 characters of JSON around the string.
    const overhead = JSON.stringify({ a: { t: '' } }).length;
    h.live.metrics = { a: { t: 'x'.repeat(MAX_STATE_METRICS_CHARS - overhead) } };
    expect(JSON.stringify(h.live.metrics)).toHaveLength(MAX_STATE_METRICS_CHARS);
    const atLimit = await h.state();
    expect(atLimit.metrics).toBe(h.live.metrics);
    expect(atLimit).not.toHaveProperty('metricsOmitted');

    h.live.metrics = { a: { t: 'x'.repeat(MAX_STATE_METRICS_CHARS - overhead + 1) } };
    const over = await h.state();
    expect(over).not.toHaveProperty('metrics');
    expect(over.metricsOmitted).toBe(`more than ${MAX_STATE_METRICS_CHARS} characters of live values`);
  });

  it('maps connection statuses; messages are cut to 500 characters, empty ones left out', async () => {
    const h = harness();
    h.live.statuses = {
      sim: { provider: SIM_PROVIDER_ID, status: { state: 'live', since: 1 } },
      api: { provider: 'holodeck.http', status: { state: 'error', since: 2, message: 'e'.repeat(800) } },
      idle: { provider: 'holodeck.http', status: { state: 'disconnected', since: 3, message: '' } },
      short: { provider: 'holodeck.http', status: { state: 'stale', since: 4, message: 'no data for 30 s' } },
    };
    const { connections } = await h.state();
    expect(connections).toEqual({
      sim: { provider: SIM_PROVIDER_ID, state: 'live' },
      api: { provider: 'holodeck.http', state: 'error', message: 'e'.repeat(500) },
      idle: { provider: 'holodeck.http', state: 'disconnected' },
      short: { provider: 'holodeck.http', state: 'stale', message: 'no data for 30 s' },
    });
    // `since` is not part of the wire shape.
    expect(connections.sim).not.toHaveProperty('since');
  });

  it('reports why edits are refused: a dialog, a gesture, or no canvas yet', async () => {
    const h = harness();
    h.setEditorState({ ...h.getEditorState(), pipeStart: { x: 1, y: 2 } as EditorState['pipeStart'] });
    expect((await h.state()).busy).toBe('the user is drawing a pipe');
    // A blocking dialog wins over a gesture.
    h.live.blocked = 'the reset dialog is open';
    expect((await h.state()).busy).toBe('the reset dialog is open');
    h.live.blocked = null;
    h.live.hasEditor = false;
    expect((await h.state()).busy).toBe('the canvas is not ready');
  });

  it('is served on the Viewer tab too (read-only)', async () => {
    const h = harness();
    h.live.tab = 'viewer';
    expect(await h.state()).toMatchObject({ tab: 'viewer' });
  });
});

describe('apply', () => {
  it('commits the scene as one editor undo step and returns the new etag and document', async () => {
    const h = harness();
    const { etag } = await h.state();
    const scene = renamed();
    const result = (await h.handle('apply', { etag, scene })) as EditResult;
    expect(h.dispatched).toEqual([{ type: 'apply-scene', scene, expectRevision: expect.any(Number) }]);
    // The working copy is now the editor's commit of this very object.
    expect(h.live.doc.body).toBe(scene);
    expect(result.document).toBe(h.live.doc);
    expect(result.etag).not.toBe(etag);
    expect(result.etag).toBe((await h.state()).etag);
    expect(h.getEditorState().past).toHaveLength(1);
    expect(h.tick).toHaveBeenCalled();
  });

  it('a second apply on the returned etag works; the first etag is then stale', async () => {
    const h = harness();
    const { etag: first } = await h.state();
    const { etag: second } = (await h.handle('apply', { etag: first, scene: renamed('One') })) as EditResult;
    const third = (await h.handle('apply', { etag: second, scene: renamed('Two') })) as EditResult;
    expect((third.document as IsoDoc).body.name).toBe('Two');
    expect(h.getEditorState().past).toHaveLength(2);
    expect((await bridgeError(h.handle('apply', { etag: first, scene: renamed('Three') }))).code).toBe('conflict');
  });

  it('refuses a stale etag (the user edited meanwhile): conflict, nothing dispatched', async () => {
    const h = harness();
    const { etag } = await h.state();
    h.live.doc = { ...h.live.doc, name: 'Edited by the user' };
    const error = await bridgeError(h.handle('apply', { etag, scene: renamed() }));
    expect(error.code).toBe('conflict');
    expect(error.problems).toEqual(['read it again (playground_state) and redo the edit']);
    expect(h.dispatched).toEqual([]);
  });

  it('refuses an etag that was never issued', async () => {
    const h = harness();
    expect((await bridgeError(h.handle('apply', { etag: 'made-up', scene: renamed() }))).code).toBe('conflict');
  });

  it('refuses on the Viewer tab (viewer), before checking the etag', async () => {
    const h = harness();
    h.live.tab = 'viewer';
    const error = await bridgeError(h.handle('apply', { etag: 'stale', scene: renamed() }));
    expect(error.code).toBe('viewer');
    expect(error.problems[0]).toContain('Edit tab');
    expect(h.dispatched).toEqual([]);
  });

  it('refuses while a dialog owns the working copy (busy)', async () => {
    const h = harness();
    const { etag } = await h.state();
    h.live.blocked = 'the conflict dialog is open';
    const error = await bridgeError(h.handle('apply', { etag, scene: renamed() }));
    expect(error.code).toBe('busy');
    expect(error.message).toContain('the conflict dialog is open');
    expect(error.problems).toEqual(['retry in a moment']);
    expect(h.dispatched).toEqual([]);
  });

  it.each<[string, Partial<EditorState>, string]>([
    ['drag', { drag: {} as EditorState['drag'] }, 'dragging'],
    ['resize', { resize: { id: 't', handle: 'radius', param: 'radius', origin: 1 } as EditorState['resize'] }, 'resizing'],
    ['pipeStart', { pipeStart: { x: 0, y: 0 } as EditorState['pipeStart'] }, 'drawing a pipe'],
    ['linkStart', { linkStart: {} as EditorState['linkStart'] }, 'drawing a connector'],
    ['linkDrag', { linkDrag: { id: 'c', end: 'from' } }, 'drawing a connector'],
  ])('refuses during a gesture (%s): busy', async (_name, gesture, why) => {
    const h = harness();
    const { etag } = await h.state();
    h.setEditorState({ ...h.getEditorState(), ...gesture });
    const error = await bridgeError(h.handle('apply', { etag, scene: renamed() }));
    expect(error.code).toBe('busy');
    expect(error.message).toContain(why);
    expect(h.dispatched).toEqual([]);
  });

  it('refuses before the canvas exists (busy)', async () => {
    const h = harness();
    const { etag } = await h.state();
    h.live.hasEditor = false;
    const error = await bridgeError(h.handle('apply', { etag, scene: renamed() }));
    expect(error.code).toBe('busy');
    expect(error.message).toContain('the canvas is not ready');
  });

  it('refuses a scene for another document (invalid), nothing dispatched', async () => {
    const h = harness();
    const { etag } = await h.state();
    const error = await bridgeError(h.handle('apply', { etag, scene: emptyScene('elsewhere') }));
    expect(error.code).toBe('invalid');
    expect(error.message).toContain('"elsewhere"');
    expect(h.dispatched).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['no params', undefined],
    ['null', null],
    ['an array', []],
    ['no etag', { scene: renamed() }],
    ['a numeric etag', { etag: 1, scene: renamed() }],
    ['no scene', { etag: 'x' }],
    ['an array scene', { etag: 'x', scene: [] }],
    ['a string scene', { etag: 'x', scene: 'scene' }],
  ])('refuses %s (invalid)', async (_name, params) => {
    const h = harness();
    const error = await bridgeError(h.handle('apply', params));
    expect(error.code).toBe('invalid');
    expect(error.message).toBe('apply needs etag and scene');
  });

  it('reports a scene the editor refused (Edit rejected notice): invalid_edit with the notice', async () => {
    const h = harness();
    const { etag } = await h.state();
    // The canvas still shows another scene: the reducer rejects `apply-scene` with a notice.
    h.setEditorState(createEditorState(emptyScene('not-yet-loaded')));
    const error = await bridgeError(h.handle('apply', { etag, scene: renamed() }));
    expect(error.code).toBe('invalid_edit');
    expect(error.problems).toHaveLength(1);
    expect(error.problems[0]).toMatch(/^Edit rejected: the scene is for document "playground", not "not-yet-loaded"$/);
  });

  it('an older notice that is not a rejection does not count as one', async () => {
    const h = harness();
    const { etag } = await h.state();
    h.setEditorState({ ...h.getEditorState(), notice: 'No route: drew a straight pipe' });
    const result = (await h.handle('apply', { etag, scene: renamed() })) as EditResult;
    expect((result.document as IsoDoc).body.name).toBe('Renamed');
  });

  // The dry run reports a rejection at once, even the same one twice in a
  // row (an agent retrying the same apply), which watching the notice change
  // could not tell apart.
  it('reports a repeated identical rejection as invalid_edit too', async () => {
    const h = harness();
    const { etag } = await h.state();
    h.setEditorState(createEditorState(emptyScene('not-yet-loaded')));
    expect((await bridgeError(h.handle('apply', { etag, scene: renamed() }))).code).toBe('invalid_edit');
    expect((await bridgeError(h.handle('apply', { etag, scene: renamed() }))).code).toBe('invalid_edit');
  });

  it('two overlapping applies on one etag: the second waits for the first, then gets conflict (holodeck#278)', async () => {
    const h = harness();
    // A real canvas renders on a later frame, so the second request arrives
    // while the first still waits for its commit.
    h.tick.mockImplementation(async () => {
      await new Promise<void>((done) => setTimeout(done, 0));
      h.render();
      h.live.clock += FRAME_MS;
    });
    const { etag } = await h.state();
    const first = h.handle('apply', { etag, scene: renamed('Agent one') });
    const second = h.handle('apply', { etag, scene: renamed('Agent two') });
    expect(((await first) as EditResult).document).toMatchObject({ body: { name: 'Agent one' } });
    const error = await bridgeError(second);
    expect(error.code).toBe('conflict');
    // Only the first scene reached the canvas: nothing was overwritten.
    expect(h.dispatched).toHaveLength(1);
    expect(h.live.doc.body.name).toBe('Agent one');
  });

  it('a failed edit does not block the queue: the next one runs', async () => {
    const h = harness();
    const { etag } = await h.state();
    const bad = h.handle('apply', { etag: 'stale', scene: renamed('Bad') });
    const good = h.handle('apply', { etag, scene: renamed('Good') });
    expect((await bridgeError(bad)).code).toBe('conflict');
    expect(((await good) as EditResult).document).toMatchObject({ body: { name: 'Good' } });
  });

  it('an edit the user changes again in the same render still succeeds, never a misleading timeout (holodeck#279)', async () => {
    const h = harness();
    const { etag } = await h.state();
    const scene = renamed('Agent');
    // The user's action is dispatched right after the agent's, before React renders.
    const dispatch = h.editor.dispatch;
    let once = true;
    h.editor.dispatch = (action) => {
      dispatch(action);
      if (once) {
        once = false;
        dispatch({ type: 'apply-scene', scene: renamed('Agent, then the user') });
      }
    };
    const start = h.live.clock;
    const result = (await h.handle('apply', { etag, scene })) as EditResult;
    expect(result.document).toBe(h.live.doc);
    expect(h.live.doc.body.name).toBe('Agent, then the user');
    expect(result.etag).toBe((await h.state()).etag);
    // One render, not the 5 s timeout.
    expect(h.live.clock - start).toBeLessThan(APPLY_TIMEOUT_MS);
    // Both are undo steps: the agent's edit is in the history.
    expect(h.getEditorState().past.at(-1)?.name).toBe('Agent');
  });

  it('a user commit queued ahead of the edit is not overwritten: conflict (GPT review of holodeck#276)', async () => {
    const h = harness();
    const { etag } = await h.state();
    const scene = renamed('Agent');
    // The user's commit is already queued when the agent's action is dispatched.
    const dispatch = h.editor.dispatch;
    let once = true;
    h.editor.dispatch = (action) => {
      if (once) {
        once = false;
        dispatch({ type: 'apply-scene', scene: renamed('User') });
      }
      dispatch(action);
    };
    const error = await bridgeError(h.handle('apply', { etag, scene }));
    expect(error.code).toBe('conflict');
    expect(h.live.doc.body.name).toBe('User');
  });

  it('refuses while the editor is ahead of the working copy (commit not yet reported): busy', async () => {
    const h = harness();
    const { etag } = await h.state();
    // The editor rendered a user commit; onChange (a passive effect) has not run yet.
    h.setEditorState(editorReducer(h.getEditorState(), { type: 'apply-scene', scene: renamed('User') }));
    const error = await bridgeError(h.handle('apply', { etag, scene: renamed('Agent') }));
    expect(error.code).toBe('busy');
    expect(h.dispatched).toEqual([]);
  });

  it('times out when the canvas never commits (fake clock)', async () => {
    const h = harness();
    h.live.commits = false;
    const { etag } = await h.state();
    const start = h.live.clock;
    const error = await bridgeError(h.handle('apply', { etag, scene: renamed() }));
    expect(error.code).toBe('timeout');
    expect(error.problems[0]).toMatch(/before redoing/);
    // It waited the full timeout (one frame past it), one tick per frame, and no longer.
    expect(h.live.clock - start).toBeGreaterThan(APPLY_TIMEOUT_MS);
    expect(h.live.clock - start).toBeLessThanOrEqual(APPLY_TIMEOUT_MS + 2 * FRAME_MS);
    expect(h.tick.mock.calls.length).toBe(Math.ceil((APPLY_TIMEOUT_MS + 1) / FRAME_MS));
  });

  it('defaults tick / now to real time when not given (commits on the next timer)', async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ tick: undefined, now: undefined });
      // Without the test tick nothing renders: commit on the editor's next timer.
      const dispatch = h.editor.dispatch;
      h.editor.dispatch = (action) => {
        dispatch(action);
        setTimeout(() => void h.tick(), 0);
      };
      const { etag } = await h.state();
      const pending = h.handle('apply', { etag, scene: renamed() });
      await vi.advanceTimersByTimeAsync(50);
      expect(((await pending) as EditResult).document).toBe(h.live.doc);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('connect', () => {
  it('refuses an unknown provider (not_found) and lists the installed ones', async () => {
    const h = harness();
    const error = await bridgeError(h.handle('connect', { connection: { id: 'x', provider: 'acme.plc' } }));
    expect(error.code).toBe('not_found');
    expect(error.message).toContain('"acme.plc"');
    expect(error.problems).toEqual([`installed: ${SIM_PROVIDER_ID}, holodeck.http`]);
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it('refuses an Authorization header in an HTTP connection (invalid, with problems)', async () => {
    const h = harness();
    const error = await bridgeError(
      h.handle('connect', { connection: { id: 'api', provider: 'holodeck.http', config: { url: 'https://example.com/api', headers: { Authorization: 'Bearer abcdefghijklmnop' } } } }),
    );
    expect(error.code).toBe('invalid');
    expect(error.message).toBe('the connection config is refused');
    expect(error.problems.length).toBeGreaterThan(0);
    expect(error.problems.join('\n')).toMatch(/Authorization/i);
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it('refuses a credential-named key for any provider (password)', async () => {
    const h = harness();
    const error = await bridgeError(h.handle('connect', { connection: { id: 'sim2', provider: SIM_PROVIDER_ID, config: { nested: { password: 'hunter2' } } } }));
    expect(error.code).toBe('invalid');
    expect(error.problems.some((p) => p.startsWith('nested.password:'))).toBe(true);
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it('refuses a URL with a user and password', async () => {
    const h = harness();
    const error = await bridgeError(h.handle('connect', { connection: { id: 'api', provider: 'holodeck.http', config: { url: 'https://me:pw@example.com/' } } }));
    expect(error.code).toBe('invalid');
    expect(error.problems.join('\n')).toContain('user name or password');
  });

  it('adds a new connection (isNew true) and returns the new etag and document', async () => {
    const h = harness();
    const { etag } = await h.state();
    const result = (await h.handle('connect', { etag, connection: { id: 'sim2', provider: SIM_PROVIDER_ID, label: 'Second sim', config: { seed: 1 } } })) as EditResult;
    expect(h.saveConnection).toHaveBeenCalledTimes(1);
    expect(h.saveConnection).toHaveBeenCalledWith({ id: 'sim2', provider: SIM_PROVIDER_ID, label: 'Second sim', config: { seed: 1 } }, true);
    expect(result.document).toBe(h.live.doc);
    expect(result.etag).not.toBe(etag);
    expect((result.document as IsoDoc).connections?.map((c) => c.id)).toEqual(['sim', 'sim2']);
  });

  it('replaces an existing connection (isNew false)', async () => {
    const h = harness();
    await h.handle('connect', { connection: { id: 'sim', provider: SIM_PROVIDER_ID, label: 'Renamed sim' } });
    expect(h.saveConnection).toHaveBeenCalledWith({ id: 'sim', provider: SIM_PROVIDER_ID, label: 'Renamed sim' }, false);
  });

  it('etag is optional; label and config are left out when absent or empty', async () => {
    const h = harness();
    await h.handle('connect', { connection: { id: 'bare', provider: SIM_PROVIDER_ID, label: '' } });
    const [saved] = h.saveConnection.mock.calls[0]!;
    expect(saved).toEqual({ id: 'bare', provider: SIM_PROVIDER_ID });
    expect(Object.keys(saved)).toEqual(['id', 'provider']);
  });

  it('refuses a non-string label, a non-object config and a non-string etag', async () => {
    const h = harness();
    expect((await bridgeError(h.handle('connect', { connection: { id: 'n', provider: SIM_PROVIDER_ID, label: 42 } }))).code).toBe('invalid');
    expect((await bridgeError(h.handle('connect', { connection: { id: 'n', provider: SIM_PROVIDER_ID, config: 'x' } }))).code).toBe('invalid');
    expect((await bridgeError(h.handle('connect', { connection: { id: 'n', provider: SIM_PROVIDER_ID, config: [1] } }))).code).toBe('invalid');
    expect((await bridgeError(h.handle('connect', { etag: 123, connection: { id: 'n', provider: SIM_PROVIDER_ID } }))).code).toBe('invalid');
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it('a stale etag is a conflict; the Viewer tab and a busy canvas refuse too', async () => {
    const h = harness();
    const connection = { id: 'sim2', provider: SIM_PROVIDER_ID };
    expect((await bridgeError(h.handle('connect', { etag: 'stale', connection }))).code).toBe('conflict');
    h.live.blocked = 'rebuilding';
    expect((await bridgeError(h.handle('connect', { connection }))).code).toBe('busy');
    h.live.tab = 'viewer';
    expect((await bridgeError(h.handle('connect', { connection }))).code).toBe('viewer');
    expect(h.saveConnection).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    ['no params', undefined],
    ['no connection', {}],
    ['an array connection', { connection: [] }],
    ['a missing id', { connection: { provider: SIM_PROVIDER_ID } }],
    ['an empty id', { connection: { id: '', provider: SIM_PROVIDER_ID } }],
    ['a numeric id', { connection: { id: 1, provider: SIM_PROVIDER_ID } }],
    ['a missing provider', { connection: { id: 'x' } }],
  ])('refuses %s (invalid)', async (_name, params) => {
    const h = harness();
    expect((await bridgeError(h.handle('connect', params))).code).toBe('invalid');
    expect(h.saveConnection).not.toHaveBeenCalled();
  });
});

describe('browse', () => {
  const nodes = (n: number): SignalNode[] => Array.from({ length: n }, (_, i) => ({ path: `p/${i}`, label: `Signal ${i}`, source: `sine:${i + 1}` }));

  it('refuses a connection the document does not have (not_found)', async () => {
    const h = harness();
    const error = await bridgeError(h.handle('browse', { connection: 'nope' }));
    expect(error.code).toBe('not_found');
    expect(error.message).toContain('"nope"');
    expect(h.browse).not.toHaveBeenCalled();
  });

  it('refuses without a connection id (invalid)', async () => {
    const h = harness();
    expect((await bridgeError(h.handle('browse', undefined))).code).toBe('invalid');
    expect((await bridgeError(h.handle('browse', { connection: 3 }))).code).toBe('invalid');
  });

  it('lists through the live session, passing a string path through and dropping others', async () => {
    const h = harness();
    h.browse.mockResolvedValue(nodes(3));
    expect(await h.handle('browse', { connection: 'sim', path: 'plant/a' })).toEqual({ nodes: nodes(3), truncated: false });
    expect(h.browse).toHaveBeenLastCalledWith('sim', 'plant/a');
    await h.handle('browse', { connection: 'sim', path: 7 });
    expect(h.browse).toHaveBeenLastCalledWith('sim', undefined);
    await h.handle('browse', { connection: 'sim' });
    expect(h.browse).toHaveBeenLastCalledWith('sim', undefined);
  });

  it(`returns at most ${MAX_BROWSE_NODES} nodes, truncated: true past that`, async () => {
    const h = harness();
    h.browse.mockResolvedValue(nodes(MAX_BROWSE_NODES));
    const exact = (await h.handle('browse', { connection: 'sim' })) as { nodes: SignalNode[]; truncated: boolean };
    expect(exact.nodes).toHaveLength(MAX_BROWSE_NODES);
    expect(exact.truncated).toBe(false);

    h.browse.mockResolvedValue(nodes(MAX_BROWSE_NODES + 1));
    const over = (await h.handle('browse', { connection: 'sim' })) as { nodes: SignalNode[]; truncated: boolean };
    expect(over.nodes).toHaveLength(MAX_BROWSE_NODES);
    expect(over.nodes.at(-1)!.path).toBe(`p/${MAX_BROWSE_NODES - 1}`);
    expect(over.truncated).toBe(true);
  });

  it('works on the Viewer tab and while busy (read-only)', async () => {
    const h = harness();
    h.live.tab = 'viewer';
    h.live.blocked = 'dialog';
    await expect(h.handle('browse', { connection: 'sim' })).resolves.toEqual({ nodes: [], truncated: false });
  });

  it("passes the session's own errors through (not_connected)", async () => {
    const h = harness();
    h.browse.mockRejectedValue(new BridgeError('connection "sim" is not connected in the playground', 'not_connected'));
    expect((await bridgeError(h.handle('browse', { connection: 'sim' }))).code).toBe('not_connected');
  });
});

describe('screenshot', () => {
  it('returns the canvas PNG as base64 that decodes back to the same bytes', async () => {
    const h = harness();
    const shot = (await h.handle('screenshot', undefined)) as ScreenshotResult;
    expect(shot).toMatchObject({ mimeType: 'image/png', width: 100, height: 50 });
    expect(Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0))).toEqual(PNG_BYTES);
    expect(h.exportImage).toHaveBeenCalledWith({ scale: 1 });
  });

  it.each<[unknown, number]>([
    [undefined, 1],
    [1, 1],
    [2.5, 2.5],
    [4, 4],
    [0, 1],
    [0.5, 1],
    [4.01, 1],
    [100, 1],
    [-2, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    ['2', 1],
  ])('scale %s -> %s', async (scale, expected) => {
    const h = harness();
    const shot = (await h.handle('screenshot', { scale })) as ScreenshotResult;
    expect(h.exportImage).toHaveBeenCalledWith({ scale: expected });
    expect(shot.width).toBe(100 * expected);
  });

  it('a failed capture (no WebGPU) is unsupported, with the reason', async () => {
    const h = harness();
    h.exportImage.mockRejectedValueOnce(new Error('WebGPU is not available'));
    const error = await bridgeError(h.handle('screenshot', {}));
    expect(error.code).toBe('unsupported');
    expect(error.message).toContain('WebGPU is not available');
    h.exportImage.mockRejectedValueOnce('plain string');
    expect((await bridgeError(h.handle('screenshot', {}))).message).toContain('plain string');
  });

  it('refuses before the canvas exists (busy)', async () => {
    const h = harness();
    h.live.hasEditor = false;
    expect((await bridgeError(h.handle('screenshot', {}))).code).toBe('busy');
  });

  it('works on the Viewer tab and while a dialog is open', async () => {
    const h = harness();
    h.live.tab = 'viewer';
    h.live.blocked = 'dialog';
    await expect(h.handle('screenshot', {})).resolves.toMatchObject({ mimeType: 'image/png' });
  });
});

describe('dispatch', () => {
  it.each(['nope', '', 'bridge.status', 'State', 'toString', '__proto__'])('unknown method %j: invalid', async (method) => {
    const h = harness();
    const error = await bridgeError(h.handle(method, {}));
    expect(error.code).toBe('invalid');
    expect(error.message).toBe(`unknown method "${method}"`);
  });
});

describe('gestureInProgress', () => {
  const idle = createEditorState(emptyScene('g'));

  it('null when nothing is in progress', () => {
    expect(gestureInProgress(idle)).toBeNull();
  });

  it('names each gesture; drag wins over the others', () => {
    expect(gestureInProgress({ ...idle, drag: {} as EditorState['drag'] })).toBe('the user is dragging an object');
    expect(gestureInProgress({ ...idle, resize: {} as EditorState['resize'] })).toBe('the user is resizing an object');
    expect(gestureInProgress({ ...idle, linkDrag: { id: 'c', end: 'to' } })).toBe('the user is drawing a connector');
    expect(gestureInProgress({ ...idle, linkStart: {} as EditorState['linkStart'] })).toBe('the user is drawing a connector');
    expect(gestureInProgress({ ...idle, pipeStart: { x: 0, y: 0 } as EditorState['pipeStart'] })).toBe('the user is drawing a pipe');
    expect(gestureInProgress({ ...idle, drag: {} as EditorState['drag'], pipeStart: { x: 0, y: 0 } as EditorState['pipeStart'] })).toBe('the user is dragging an object');
  });

  it('an armed place tool or a selection is not a gesture', () => {
    expect(gestureInProgress({ ...idle, mode: 'place', placing: 'tank', selectedId: 'a', selectedIds: ['a'] })).toBeNull();
  });
});

describe('blobToBase64', () => {
  it('matches Node base64 for empty, small and multi-chunk (> 0x8000 bytes) blobs', async () => {
    for (const size of [0, 1, 2, 3, 0x8000 - 1, 0x8000, 0x8000 + 1, 0x8000 * 3 + 7]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) % 256);
      expect(await blobToBase64(new Blob([bytes])), `size ${size}`).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('does not overflow the stack on a large blob (4 MB)', async () => {
    const bytes = new Uint8Array(4 * 1024 * 1024).fill(0xab);
    const out = await blobToBase64(new Blob([bytes]));
    expect(out).toHaveLength(Math.ceil(bytes.length / 3) * 4);
    expect(out.slice(0, 4)).toBe(Buffer.from(bytes.subarray(0, 3)).toString('base64'));
  });
});

describe('installedProviders', () => {
  it('lists the registry’s provider contributions', () => {
    const sim = createSimProvider();
    const kinds: string[] = [];
    const list = <T,>(kind: string): T[] => {
      kinds.push(kind);
      return [sim] as T[];
    };
    expect(installedProviders({ list })).toEqual([sim]);
    expect(kinds).toEqual([HOLODECK_KINDS.provider]);
  });
});
