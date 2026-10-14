/**
 * `placement.bindings` in parseSceneFile. A separate file from scene.test.ts
 * so it does not collide with other branches editing that suite.
 */
import { describe, expect, it } from 'vitest';
import sceneJson from '../../tests/scene.json';
import { PROCESS_SCENE } from './load-process-scene';
import { parseSceneFile, type IsoSceneFile } from './scene';

const scene = (objects: unknown[]): unknown => ({ id: 's', name: 'S', gridCellSize: 1, objects });
const tank = (extra: Record<string, unknown> = {}) => ({ id: 't1', object: 'tank', x: 0, y: 0, ...extra });
const level = { connection: 'plant', source: 'sine:10', transform: { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 } };

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('parseSceneFile: bindings', () => {
  it('still loads files without bindings exactly as before', () => {
    // tests/scene.json has no legacy fields, so parsing must return it unchanged.
    expect(parseSceneFile(sceneJson)).toEqual(sceneJson);
    expect(PROCESS_SCENE.objects.every((o) => !('bindings' in o))).toBe(true);
  });

  it('keeps valid bindings on the placement', () => {
    const parsed = parseSceneFile(scene([tank({ bindings: { level, alarm: { connection: 'plant', source: 'square:4' } } })]));
    expect(parsed.objects[0]?.bindings).toEqual({ level, alarm: { connection: 'plant', source: 'square:4' } });
  });

  it('accepts an empty bindings map', () => {
    expect(parseSceneFile(scene([tank({ bindings: {} })])).objects[0]?.bindings).toEqual({});
  });

  it('keeps bindings alongside legacy fields it migrates', () => {
    const parsed = parseSceneFile(scene([tank({ fill: 0.8, bindings: { temp: { connection: 'p', source: 'ramp:9' } } })]));
    expect(parsed.objects[0]).toMatchObject({ params: { level: 0.8 }, bindings: { temp: { connection: 'p', source: 'ramp:9' } } });
    expect(parsed.objects[0]).not.toHaveProperty('fill');
  });

  it('rejects a bindings value that is not a map, naming the placement', () => {
    for (const bindings of [null, [], 'plant/level', 1]) {
      expect(() => parseSceneFile(scene([tank({ bindings })]))).toThrow(
        'placement t1: bindings must be an object mapping param names to bindings',
      );
    }
  });

  it('rejects malformed bindings with every problem of that placement', () => {
    expect(() =>
      parseSceneFile(scene([tank({ bindings: { level: { connection: 'plant' }, temp: { ...level, transform: { kind: 'nope' } } } })])),
    ).toThrow(
      'placement t1: bindings.level.source: must be a non-empty string; placement t1: bindings.temp.transform.kind: must be one of scale, threshold, map, format',
    );
  });

  it('rejects a binding on a placement with an empty id', () => {
    expect(() => parseSceneFile(scene([tank({ id: '', bindings: { level } })]))).toThrow(
      'placement : bindings need a non-empty placement id',
    );
  });

  it('does not check connections (the body has none; that is a document check)', () => {
    expect(() => parseSceneFile(scene([tank({ bindings: { level: { connection: 'nowhere', source: 'x' } } })]))).not.toThrow();
  });

  it('does not mutate its input', () => {
    const raw = deepFreeze(scene([tank({ fill: 0.5, bindings: { level } })]));
    const parsed: IsoSceneFile = parseSceneFile(raw);
    expect(parsed.objects[0]?.bindings).toEqual({ level });
    expect((raw as { objects: Array<Record<string, unknown>> }).objects[0]?.fill).toBe(0.5);
  });

  it('leaves host extension bags opaque next to bindings', () => {
    const parsed = parseSceneFile(scene([tank({ bindings: { level }, extensions: { 'host.tags': { level: 'tank1.level' } } })]));
    expect(parsed.objects[0]?.extensions).toEqual({ 'host.tags': { level: 'tank1.level' } });
  });
});
