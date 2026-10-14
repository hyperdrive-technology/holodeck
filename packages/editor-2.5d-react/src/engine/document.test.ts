import { HOLODECK_KINDS, validateHolodeckDocument, type ProviderConnection } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import sceneJson from '../../tests/scene.json';
import { PROCESS_SCENE } from '../iso/load-process-scene';
import { parseSceneFile, type IsoSceneFile } from '../iso/scene';
import { BUILTIN_ISO_EXTENSION } from '../registry/builtin';
import { createIsoRegistry } from '../registry/kinds';
import { IsoDocumentError, loadIsoDocument, toIsoDocument } from './document';
import { isoEngine } from './iso-engine';

const plant: ProviderConnection = { id: 'plant', provider: 'holodeck.sim', label: 'Demo plant', config: { intervalMs: 100 } };
const level = { connection: 'plant', source: 'sine:10', transform: { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 } };

const scene = (objects: unknown[], extra: Record<string, unknown> = {}): IsoSceneFile =>
  ({ id: 'brewhouse', name: 'Brewhouse', gridCellSize: 1, objects, ...extra }) as IsoSceneFile;
const tank = (extra: Record<string, unknown> = {}) => ({ id: 't1', object: 'tank', x: 0, y: 0, ...extra });

const envelope = (extra: Record<string, unknown> = {}) => ({
  format: 'holodeck.document.v1',
  id: 'doc-1',
  name: 'Doc one',
  engine: 'holodeck.iso',
  engineVersion: '1.0.0',
  connections: [plant],
  body: scene([tank({ bindings: { level } })]),
  ...extra,
});

/** The problems of the IsoDocumentError `fn` throws. */
function problemsOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IsoDocumentError);
    return (error as IsoDocumentError).problems;
  }
  throw new Error('expected an IsoDocumentError');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('toIsoDocument', () => {
  it('wraps a scene in a valid holodeck.document.v1 envelope', () => {
    const doc = toIsoDocument(PROCESS_SCENE);
    expect(validateHolodeckDocument(doc)).toEqual([]);
    expect(doc).toEqual({
      format: 'holodeck.document.v1',
      id: PROCESS_SCENE.id,
      name: PROCESS_SCENE.name,
      engine: 'holodeck.iso',
      engineVersion: '1.0.0',
      body: PROCESS_SCENE,
    });
    expect(doc.body).toBe(PROCESS_SCENE);
    expect(isoEngine.validateBody?.(doc.body)).toEqual([]);
  });

  it('mirrors scene.theme on the envelope, and leaves it off when absent', () => {
    expect(toIsoDocument(scene([], { theme: 'holodeck.dark' })).theme).toBe('holodeck.dark');
    expect(toIsoDocument(scene([]))).not.toHaveProperty('theme');
  });

  it('takes connections, requires, metadata, extensions and an id/name override', () => {
    const doc = toIsoDocument(scene([tank({ bindings: { level } })]), {
      id: 'saved-1',
      name: 'Saved',
      connections: [plant],
      requires: { 'holodeck.cloud': '^0.1' },
      metadata: { author: 'des', tags: ['demo'] },
      extensions: { 'host.layout': { split: 0.3 } },
    });
    expect(doc).toMatchObject({
      id: 'saved-1',
      name: 'Saved',
      connections: [plant],
      requires: { 'holodeck.cloud': '^0.1' },
      metadata: { author: 'des', tags: ['demo'] },
      extensions: { 'host.layout': { split: 0.3 } },
    });
    expect(validateHolodeckDocument(doc)).toEqual([]);
    // Scene-level extension bags stay in the body.
    expect(toIsoDocument(scene([], { extensions: { a: 1 } }))).not.toHaveProperty('extensions');
  });
});

describe('loadIsoDocument: round trips', () => {
  it('bare -> envelope -> bare gives the same scene (also through JSON)', () => {
    const bare = parseSceneFile(sceneJson);
    const viaObject = loadIsoDocument(toIsoDocument(bare));
    expect(viaObject.scene).toEqual(bare);
    const viaJson = loadIsoDocument(JSON.parse(JSON.stringify(toIsoDocument(bare))));
    expect(viaJson.scene).toEqual(bare);
    expect(viaJson.document).toEqual(toIsoDocument(bare));
  });

  it('envelope with connections and bindings survives save -> load -> save', () => {
    const doc = envelope({ theme: 'holodeck.dark', requires: { 'holodeck.cloud': '^0.1' }, metadata: { author: 'des' } });
    const first = loadIsoDocument(JSON.parse(JSON.stringify(doc)));
    expect(first.document.connections).toEqual([plant]);
    expect(first.scene.objects[0]?.bindings).toEqual({ level });
    expect(isoEngine.collectBindings?.(first.scene)).toEqual([{ objectId: 't1', param: 'level', binding: level }]);
    const saved = toIsoDocument(first.scene, {
      id: first.document.id,
      name: first.document.name,
      connections: first.document.connections,
      requires: first.document.requires,
      metadata: first.document.metadata,
    });
    expect(JSON.parse(JSON.stringify(saved))).toEqual(JSON.parse(JSON.stringify(first.document)));
    expect(loadIsoDocument(JSON.parse(JSON.stringify(saved))).scene).toEqual(first.scene);
  });

  it('returns document.body === scene', () => {
    const { document, scene: loaded } = loadIsoDocument(envelope());
    expect(document.body).toBe(loaded);
  });

  it('does not mutate its input', () => {
    const raw = deepFreeze(envelope({ body: scene([tank({ fill: 0.5, bindings: { level } })], { theme: 'a' }), theme: 'b' }));
    const { scene: loaded } = loadIsoDocument(raw);
    expect(loaded.theme).toBe('b');
    expect(raw.body.theme).toBe('a');
    expect((raw.body.objects[0] as unknown as Record<string, unknown>).fill).toBe(0.5);
  });
});

describe('loadIsoDocument: legacy bare scene files', () => {
  it('wraps a bare IsoSceneFile', () => {
    const { document, scene: loaded } = loadIsoDocument(sceneJson);
    expect(loaded).toEqual(PROCESS_SCENE);
    expect(document).toEqual(toIsoDocument(loaded));
    expect(document.connections).toBeUndefined();
  });

  it('still migrates legacy placement fields', () => {
    const { scene: loaded } = loadIsoDocument(scene([tank({ fill: 0.7, bind: 'old.tag' })]));
    expect(loaded.objects[0]).toMatchObject({ params: { level: 0.7 } });
    expect(loaded.objects[0]).not.toHaveProperty('bind');
  });

  it('reports bindings in a bare file as unknown connections, with a hint', () => {
    expect(problemsOf(() => loadIsoDocument(scene([tank({ bindings: { level } })])))).toEqual([
      't1.level: unknown connection "plant"',
      'a bare scene file has no connections: save it with toIsoDocument(scene, { connections })',
    ]);
  });

  it('reports structural problems unprefixed', () => {
    expect(problemsOf(() => loadIsoDocument(scene([{ id: 'ghost', object: 'tank' }])))).toEqual([
      'placement ghost missing numeric x,y',
    ]);
    expect(problemsOf(() => loadIsoDocument({ objects: 'x' }))).toEqual(['scene.objects must be an array']);
  });

  it('needs what an envelope needs (id, name)', () => {
    expect(problemsOf(() => loadIsoDocument({ objects: [] }))).toEqual([
      'id: must be a non-empty string',
      'name: must be a string',
    ]);
    expect(problemsOf(() => loadIsoDocument(scene([], { theme: '' })))).toEqual(['theme: must be a non-empty string']);
  });
});

describe('loadIsoDocument: envelope checks', () => {
  it('rejects non-objects', () => {
    for (const raw of [undefined, null, 'doc', 3, []]) {
      expect(problemsOf(() => loadIsoDocument(raw))).toEqual(['document: must be an object']);
    }
  });

  it('rejects another engine', () => {
    expect(problemsOf(() => loadIsoDocument(envelope({ engine: 'holodeck.flow' })))).toEqual([
      'engine: "holodeck.flow" is not "holodeck.iso"',
    ]);
  });

  it('rejects a document written for another major engine version, accepts a newer minor', () => {
    expect(problemsOf(() => loadIsoDocument(envelope({ engineVersion: '2.0.0' })))).toEqual([
      'engineVersion: 2.0.0 needs holodeck.iso ^2, this engine is 1.0.0',
    ]);
    expect(problemsOf(() => loadIsoDocument(envelope({ engineVersion: '0.9.0' })))).toHaveLength(1);
    expect(loadIsoDocument(envelope({ engineVersion: '1.4.2' })).document.engineVersion).toBe('1.4.2');
    expect(loadIsoDocument(envelope({ engineVersion: undefined })).scene.id).toBe('doc-1');
  });

  it('lists every envelope problem at once', () => {
    const problems = problemsOf(() =>
      loadIsoDocument({
        format: 'holodeck.document.v0',
        id: '',
        name: 3,
        engine: 'holodeck.iso',
        engineVersion: 'one',
        theme: '',
        requires: { 'Not An Id': 'latest' },
        connections: [{ id: 'a', provider: 'x.y' }, { id: 'a', provider: 'x.y' }, 'nope'],
        metadata: 'x',
        extensions: [],
        body: scene([]),
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        'format: must be "holodeck.document.v1"',
        'id: must be a non-empty string',
        'name: must be a string',
        'engineVersion: must be a MAJOR.MINOR.PATCH version',
        'theme: must be a non-empty string',
        'connections[1].id: duplicate connection id "a"',
        'connections[2]: must be an object',
        'metadata: must be an object',
        'extensions: must be an object',
      ]),
    );
    expect(problems.length).toBeGreaterThanOrEqual(10);
  });

  it('a missing body is one problem', () => {
    const raw: Record<string, unknown> = envelope();
    delete raw.body;
    expect(problemsOf(() => loadIsoDocument(raw))).toEqual(['body: is required']);
  });

  it('treats anything with format, engine or body as an envelope', () => {
    expect(problemsOf(() => loadIsoDocument({ body: scene([]) }))).toEqual(
      expect.arrayContaining(['format: must be "holodeck.document.v1"', 'engine: must be a dotted id such as "holodeck.iso"']),
    );
    expect(problemsOf(() => loadIsoDocument({ ...scene([]), engine: 'holodeck.iso' }))).toContain('body: is required');
  });

  it('prefixes body problems with "body: " and lists them with envelope problems', () => {
    const problems = problemsOf(() =>
      loadIsoDocument(
        envelope({
          name: 1,
          body: scene([tank({ bindings: { level: { connection: 'plant' }, temp: { connection: 'gone', source: 'x' } } }), { id: 'g', object: 'tank' }]),
        }),
      ),
    );
    expect(problems).toEqual([
      'name: must be a string',
      'body: placement g missing numeric x,y',
      'body: placement t1: bindings.level.source: must be a non-empty string',
      'body: t1.temp: unknown connection "gone"',
    ]);
  });

  it('checks bindings against document.connections, each problem once', () => {
    const body = scene([
      tank({ bindings: { level, temp: { connection: 'aws', source: 'cloudwatch:x' } } }),
      { id: 'v1', object: 'valve', x: 3, y: 0, bindings: { open: { connection: 'aws', source: 'y', transform: { kind: 'nope' } } } },
    ]);
    expect(problemsOf(() => loadIsoDocument(envelope({ body })))).toEqual([
      'body: placement v1: bindings.open.transform.kind: must be one of scale, threshold, map, format',
      'body: t1.temp: unknown connection "aws"',
    ]);
    // Adding the connection leaves only the malformed transform.
    const connections = [plant, { id: 'aws', provider: 'aws.cloudwatch' }];
    expect(problemsOf(() => loadIsoDocument(envelope({ body, connections })))).toEqual([
      'body: placement v1: bindings.open.transform.kind: must be one of scale, threshold, map, format',
    ]);
    const fixed = scene([tank({ bindings: { level, temp: { connection: 'aws', source: 'cloudwatch:x' } } })]);
    expect(loadIsoDocument(envelope({ body: fixed, connections })).document.connections).toEqual(connections);
  });

  it('skips the connection cross-check when connections itself is malformed', () => {
    expect(problemsOf(() => loadIsoDocument(envelope({ connections: 'plant' })))).toEqual(['connections: must be an array']);
  });

  it('checks parts against the given registry (default: the built-ins)', () => {
    const body = scene([{ id: 'db', object: 'aws.rds', x: 0, y: 0 }]);
    expect(problemsOf(() => loadIsoDocument(envelope({ body })))).toEqual(['body: unknown library object "aws.rds" on db']);
    const registry = createIsoRegistry();
    registry.install(BUILTIN_ISO_EXTENSION);
    registry.install({
      id: 'holodeck.aws',
      version: '0.1.0',
      contributions: { [HOLODECK_KINDS.isoPart]: [{ ...BUILTIN_ISO_EXTENSION.contributions[HOLODECK_KINDS.isoPart]![0]!, id: 'aws.rds' }] },
    });
    expect(loadIsoDocument(envelope({ body }), registry).scene.objects[0]?.object).toBe('aws.rds');
  });

  it('hostile input surfaces as an IsoDocumentError', () => {
    const hostile = new Proxy(
      { format: 'holodeck.document.v1' },
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    expect(problemsOf(() => loadIsoDocument(hostile))).toEqual(['document could not be read: boom']);
  });

  it('IsoDocumentError lists the problems in its message', () => {
    expect(() => loadIsoDocument(envelope({ engine: 'holodeck.flow', name: 1 }))).toThrow(
      expect.objectContaining({
        name: 'IsoDocumentError',
        message: 'invalid iso document:\n- name: must be a string\n- engine: "holodeck.flow" is not "holodeck.iso"',
      }),
    );
  });
});

describe('loadIsoDocument: theme, id and name', () => {
  it('envelope theme wins over the body theme', () => {
    const { document, scene: loaded } = loadIsoDocument(envelope({ theme: 'holodeck.dark', body: scene([], { theme: 'holodeck.default' }) }));
    expect(loaded.theme).toBe('holodeck.dark');
    expect(document.theme).toBe('holodeck.dark');
  });

  it('a body-only theme is mirrored onto the envelope', () => {
    const { document, scene: loaded } = loadIsoDocument(envelope({ body: scene([], { theme: 'holodeck.dark' }) }));
    expect(loaded.theme).toBe('holodeck.dark');
    expect(document.theme).toBe('holodeck.dark');
  });

  it('no theme anywhere stays absent', () => {
    const { document, scene: loaded } = loadIsoDocument(envelope({ body: scene([]) }));
    expect(loaded.theme).toBeUndefined();
    expect(document).not.toHaveProperty('theme');
  });

  it('a body without id/name takes the envelope ones (PACKAGING.md writes bodies as { objects })', () => {
    const { scene: loaded } = loadIsoDocument(envelope({ body: { objects: [tank()] } }));
    expect(loaded).toMatchObject({ id: 'doc-1', name: 'Doc one' });
    // The envelope id always wins (it is the history-reset identity, see
    // document-identity.test.ts); a body keeps its own name.
    expect(loadIsoDocument(envelope()).scene).toMatchObject({ id: 'doc-1', name: 'Brewhouse' });
  });

  it('keeps unknown envelope fields (the SDK envelope is open)', () => {
    expect((loadIsoDocument(envelope({ 'x-studio': { pinned: true } })).document as unknown as Record<string, unknown>)['x-studio']).toEqual({
      pinned: true,
    });
  });
});
