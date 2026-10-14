import {
  HOLODECK_KINDS,
  HolodeckHost,
  runContributionKindConformance,
  validateEngine,
  type Contribution,
  type ContributionKind,
} from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import sceneJson from '../../tests/scene.json';
import { BUILTIN_ISO_ANIMATORS } from '../anim/animators';
import { BUILTIN_ISO_PARTS } from '../registry/builtin';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import { ISO_KINDS } from '../registry/kinds';
import { BUILTIN_ISO_THEMES } from '../registry/themes';
import type { IsoInspectorPanel } from '../registry/types';
import { toIsoDocument } from './document';
import {
  ISO_DOCUMENT_FORMAT,
  ISO_ENGINE_API_VERSION,
  ISO_ENGINE_ID,
  createIsoEngine,
  isoEngine,
  validateIsoBody,
} from './iso-engine';

const scene = (objects: unknown[], extra: Record<string, unknown> = {}) => ({ id: 's', name: 'S', gridCellSize: 1, objects, ...extra });
const tank = (extra: Record<string, unknown> = {}) => ({ id: 't1', object: 'tank', x: 0, y: 0, ...extra });
const level = { connection: 'plant', source: 'sine:10' };

describe('isoEngine descriptor', () => {
  it('passes the SDK validateEngine', () => {
    expect(validateEngine(isoEngine)).toEqual([]);
    expect(validateEngine(createIsoEngine({ registry: createIsoRegistryWithBuiltins() }))).toEqual([]);
  });

  it('declares the holodeck.iso contract', () => {
    expect(isoEngine).toMatchObject({
      id: 'holodeck.iso',
      apiVersion: '1.0.0',
      documentFormat: 'holodeck.iso.scene.v1',
    });
    expect([ISO_ENGINE_ID, ISO_ENGINE_API_VERSION, ISO_DOCUMENT_FORMAT]).toEqual(['holodeck.iso', '1.0.0', 'holodeck.iso.scene.v1']);
    expect(isoEngine.label).toBeTruthy();
    expect(isoEngine.kinds).toBe(ISO_KINDS);
    expect(isoEngine.kinds.map((k) => k.kind)).toEqual([
      HOLODECK_KINDS.isoPart,
      HOLODECK_KINDS.isoTheme,
      HOLODECK_KINDS.isoAnimator,
      HOLODECK_KINDS.isoInspector,
    ]);
  });

  it('is frozen, so a host cannot change the shared descriptor', () => {
    expect(Object.isFrozen(isoEngine)).toBe(true);
    expect(() => {
      (isoEngine as { id: string }).id = 'other';
    }).toThrow(TypeError);
  });
});

describe('isoEngine in a HolodeckHost', () => {
  it('registers its four kinds and unregisters them again', () => {
    const host = new HolodeckHost({ name: 'test' });
    const off = host.registerEngine(isoEngine);
    expect(host.engine('holodeck.iso')?.documentFormat).toBe('holodeck.iso.scene.v1');
    for (const k of ISO_KINDS) expect(host.registry.hasKind(k.kind)).toBe(true);
    off();
    expect(host.engine('holodeck.iso')).toBeUndefined();
    for (const k of ISO_KINDS) expect(host.registry.hasKind(k.kind)).toBe(false);
  });

  it('refuses a second registration of the same engine id', () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(isoEngine);
    expect(() => host.registerEngine(createIsoEngine())).toThrow(/already registered/);
  });

  it('adopts kinds a pre-engine registry already has (createIsoRegistry hosts)', () => {
    const registry = createIsoRegistryWithBuiltins();
    const host = new HolodeckHost({ name: 'test', registry });
    const off = host.registerEngine(isoEngine);
    off();
    // Adopted kinds stay: the parts installed before the engine still resolve.
    expect(registry.get(HOLODECK_KINDS.isoPart, 'tank')).toBeDefined();
  });

  // Each kind the registered engine carries passes the SDK conformance kit on
  // registries made by a HolodeckHost (host kinds present, iso kinds absent).
  const panel = (id: string): IsoInspectorPanel => ({ id, label: id, component: () => null });
  const samples: Record<string, [Contribution, Contribution]> = {
    [HOLODECK_KINDS.isoPart]: [BUILTIN_ISO_PARTS[0]!, BUILTIN_ISO_PARTS[1]!],
    [HOLODECK_KINDS.isoTheme]: [BUILTIN_ISO_THEMES[0]!, BUILTIN_ISO_THEMES[1]!],
    [HOLODECK_KINDS.isoAnimator]: [BUILTIN_ISO_ANIMATORS[0]!, BUILTIN_ISO_ANIMATORS[1]!],
    [HOLODECK_KINDS.isoInspector]: [panel('a'), panel('b')],
  };
  const host = new HolodeckHost({ name: 'conformance' });
  host.registerEngine(isoEngine);
  for (const kind of host.engine('holodeck.iso')!.kinds as readonly ContributionKind[]) {
    it(`conformance: ${kind.kind}`, () => {
      const failures: string[] = [];
      runContributionKindConformance(() => new HolodeckHost({ name: 'conformance' }).registry, kind, samples[kind.kind]!, (ok, message) => {
        if (!ok) failures.push(message);
      });
      expect(failures).toEqual([]);
    });
  }

  it('host.checkDocument reports body problems from validateBody as INVALID_BODY', async () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(isoEngine);
    const good = toIsoDocument(scene([tank()]) as never);
    expect(await host.checkDocument(good)).toEqual([]);
    const bad = toIsoDocument(scene([tank({ bindings: { level: { connection: 'plant' } } })]) as never);
    expect(await host.checkDocument(bad)).toEqual([
      {
        check: 'holodeck.iso.body',
        severity: 'error',
        code: 'INVALID_BODY',
        message: 'placement t1: bindings.level.source: must be a non-empty string',
      },
    ]);
  });
});

describe('collectBindings', () => {
  it('finds bindings by placement id', () => {
    const body = scene([tank({ bindings: { level } }), { id: 'v1', object: 'valve', x: 3, y: 0, bindings: { open: level } }]);
    expect(isoEngine.collectBindings?.(body as never)).toEqual([
      { objectId: 't1', param: 'level', binding: level },
      { objectId: 'v1', param: 'open', binding: level },
    ]);
  });

  it('returns nothing for scenes without bindings', () => {
    expect(isoEngine.collectBindings?.(sceneJson as never)).toEqual([]);
  });
});

describe('validateBody', () => {
  it('accepts valid bodies, with or without bindings', () => {
    expect(isoEngine.validateBody?.(sceneJson)).toEqual([]);
    expect(isoEngine.validateBody?.(scene([tank({ bindings: { level } })]))).toEqual([]);
    expect(isoEngine.validateBody?.(scene([]))).toEqual([]);
  });

  it('accepts parts from any library by default (it cannot know what the host installed)', () => {
    expect(isoEngine.validateBody?.(scene([{ id: 'db', object: 'aws.rds', x: 0, y: 0 }]))).toEqual([]);
  });

  it('checks parts against a registry when created with one', () => {
    const strict = createIsoEngine({ registry: createIsoRegistryWithBuiltins() });
    expect(strict.validateBody?.(scene([{ id: 'db', object: 'aws.rds', x: 0, y: 0 }]))).toEqual([
      'unknown library object "aws.rds" on db',
    ]);
    expect(strict.validateBody?.(sceneJson)).toEqual([]);
  });

  it('wraps parseSceneFile: structural problems come back as strings', () => {
    const v = (body: unknown) => isoEngine.validateBody?.(body);
    expect(v(scene([{ id: 'ghost', object: 'tank' }]))).toEqual(['placement ghost missing numeric x,y']);
    expect(v({ objects: 'x' })).toEqual(['scene.objects must be an array']);
    expect(v(scene([tank(), tank()]))).toEqual(['duplicate placement ids: t1']);
    expect(v(scene([], { theme: 3 }))).toEqual(['scene.theme must be a string']);
    expect(v(scene([{ id: 'e', object: '', x: 0, y: 0 }]))).toEqual(['unknown library object "" on e']);
    expect(v(scene([tank({ params: [] })]))).toEqual(['placement t1: params must be an object']);
  });

  it('lists every binding problem once, after the structural one', () => {
    const body = scene([
      tank({ bindings: { level: { connection: 'plant' }, temp: { ...level, transform: { kind: 'nope' } } } }),
      { id: 'v1', object: 'valve', x: 1, y: 1, bindings: 'x' },
      { id: 'ghost', object: 'tank' },
    ]);
    expect(isoEngine.validateBody?.(body)).toEqual([
      'placement ghost missing numeric x,y',
      'placement t1: bindings.level.source: must be a non-empty string',
      'placement t1: bindings.temp.transform.kind: must be one of scale, threshold, map, format',
      'placement v1: bindings must be an object mapping param names to bindings',
    ]);
  });

  it('never throws, whatever the body', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
        has() {
          throw new Error('boom');
        },
      },
    );
    for (const body of [undefined, null, 0, 'scene', [], {}, hostile, { objects: [hostile] }]) {
      expect(() => isoEngine.validateBody?.(body)).not.toThrow();
      expect(isoEngine.validateBody?.(body)?.length).toBeGreaterThan(0);
    }
    expect(isoEngine.validateBody?.(null)).toEqual(['scene must be an object']);
    expect(isoEngine.validateBody?.(hostile)).toEqual(['body could not be validated: boom']);
  });

  it('does not mutate the body', () => {
    const body = Object.freeze(scene([Object.freeze(tank({ fill: 0.5, bindings: Object.freeze({ level: { connection: 'p' } }) }))]));
    expect(() => validateIsoBody(body)).not.toThrow();
    expect((body.objects[0] as Record<string, unknown>).fill).toBe(0.5);
  });
});
