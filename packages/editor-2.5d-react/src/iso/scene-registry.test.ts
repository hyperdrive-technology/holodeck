import { HOLODECK_KINDS } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { loadProcessScene, PROCESS_SCENE } from './load-process-scene';
import { partitionByPart, partitionScene } from './partition-scene';
import { parseSceneFile, type IsoSceneFile } from './scene';

const base = (objects: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 's',
  name: 's',
  gridCellSize: 1,
  objects,
  ...extra,
});

const fermenter: IsoPartDefinition = {
  id: 'brewery:fermenter',
  label: 'Fermenter',
  footprint: { w: 2, h: 2 },
  params: { level: { type: 'number', label: 'Level', default: 0 } },
  component: () => null,
};

describe('parseSceneFile with a registry', () => {
  it('rejects a part nobody installed, by default and with an explicit registry', () => {
    const raw = base([{ id: 'f', object: 'brewery:fermenter', x: 0, y: 0 }]);
    expect(() => parseSceneFile(raw)).toThrow(/unknown library object "brewery:fermenter" on f/);
    expect(() => parseSceneFile(raw, createIsoRegistryWithBuiltins())).toThrow(/unknown library object/);
  });

  it('accepts the same scene once the pack is installed', () => {
    const registry = createIsoRegistryWithBuiltins();
    registry.install({ id: 'brewery', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [fermenter] } });
    const scene = parseSceneFile(base([{ id: 'f', object: 'brewery:fermenter', x: 0, y: 0 }]), registry);
    expect(scene.objects[0]?.object).toBe('brewery:fermenter');
  });

  it('uninstalling a pack makes its scenes invalid again', () => {
    const registry = createIsoRegistryWithBuiltins();
    registry.install({ id: 'brewery', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [fermenter] } });
    registry.uninstall('brewery');
    expect(() => loadProcessScene(base([{ id: 'f', object: 'brewery:fermenter', x: 0, y: 0 }]), registry)).toThrow(
      /unknown library object/,
    );
  });

  it('round-trips params, animation, extensions, theme (structurally, via JSON)', () => {
    const file: IsoSceneFile = {
      id: 's',
      name: 's',
      gridCellSize: 1,
      theme: 'holodeck.dark',
      extensions: { 'host.meta': { rev: 3 } },
      objects: [
        {
          id: 'tank-1',
          object: 'tank',
          x: 1,
          y: 2,
          params: { level: 0.4, temp: 20 },
          animation: { level: { animator: 'fill', settings: { foo: 1 } } },
          extensions: { 'host.bindings': { level: 'plant/tank1/level' } },
        },
      ],
    };
    const parsed = parseSceneFile(JSON.parse(JSON.stringify(file)));
    expect(parsed).toEqual(file);
  });

  it('rejects malformed bags and theme', () => {
    expect(() => parseSceneFile(base([{ id: 'a', object: 'tank', x: 0, y: 0, params: [] }]))).toThrow(/params must be an object/);
    expect(() => parseSceneFile(base([{ id: 'a', object: 'tank', x: 0, y: 0, extensions: 'x' }]))).toThrow(
      /extensions must be an object/,
    );
    expect(() => parseSceneFile(base([], { theme: 3 }))).toThrow(/theme must be a string/);
    expect(() => parseSceneFile(base([], { extensions: [] }))).toThrow(/scene.extensions/);
    expect(() => parseSceneFile('nope')).toThrow(/must be an object/);
    expect(() => parseSceneFile(base([null]))).toThrow(/must be records/);
  });

  it('still rejects duplicate ids and bad coordinates', () => {
    const t = { object: 'tank', x: 0, y: 0 };
    expect(() => parseSceneFile(base([{ id: 'a', ...t }, { id: 'a', ...t }]))).toThrow(/duplicate placement ids: a/);
    expect(() => parseSceneFile(base([{ id: 'a', object: 'tank', x: Number.NaN, y: 0 }]))).toThrow(/numeric x,y/);
  });

  it('migrates legacy fill/text/bind into params without mutating the input', () => {
    const raw = base([
      { id: 't', object: 'tank', x: 0, y: 0, fill: 0.7 },
      { id: 'l', object: 'label', x: 0, y: 1, text: 'hi', bind: 'temp' },
      { id: 'p', object: 'pipe', x: 0, y: 2, toX: 1, toY: 2, text: 'ignored: pipes have no text param' },
    ]);
    const before = JSON.stringify(raw);
    const parsed = parseSceneFile(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(parsed.objects[0]).toEqual({ id: 't', object: 'tank', x: 0, y: 0, params: { level: 0.7 } });
    expect(parsed.objects[1]).toEqual({ id: 'l', object: 'label', x: 0, y: 1, params: { text: 'hi' } });
    expect(parsed.objects[2]?.params).toBeUndefined();
  });

  it('does not let legacy fill clobber an explicit params.level', () => {
    const parsed = parseSceneFile(base([{ id: 't', object: 'tank', x: 0, y: 0, fill: 0.7, params: { level: 0.2 } }]));
    expect(parsed.objects[0]?.params).toEqual({ level: 0.2 });
  });
});

describe('tests/scene.json in the new shape', () => {
  it('has no legacy fields left', () => {
    for (const o of PROCESS_SCENE.objects) {
      expect(o).not.toHaveProperty('fill');
      expect(o).not.toHaveProperty('bind');
      expect(o).not.toHaveProperty('text');
    }
  });

  it('keeps label text and vessel levels as params', () => {
    const byId = Object.fromEntries(PROCESS_SCENE.objects.map((o) => [o.id, o]));
    expect(byId['label-temp-val']?.params).toEqual({ text: '14 deg' });
    expect(byId['mixer']?.params).toEqual({ level: 0.52 });
    expect(byId['holding']?.params).toEqual({ level: 0.12 });
  });
});

describe('partitionByPart', () => {
  it('pools instanced parts by id and keeps the rest unique', () => {
    const { pools, unique } = partitionByPart(PROCESS_SCENE.objects);
    expect([...pools.keys()].sort()).toEqual(['elbow', 'pipe', 'valve']) // the only cap in the scene is the steam one (unique);
    expect(unique.every((o) => !['pipe', 'elbow', 'valve'].includes(o.object))).toBe(true);
  });

  it('honours instancedWhen: steam end-cap stays a unique mesh, other caps pool', () => {
    const { pools, unique } = partitionByPart([
      { id: 'cap-steam', object: 'end-cap', x: 0, y: 0 },
      { id: 'cap-a', object: 'end-cap', x: 1, y: 0 },
    ]);
    expect(pools.get('end-cap')?.map((o) => o.id)).toEqual(['cap-a']);
    expect(unique.map((o) => o.id)).toEqual(['cap-steam']);
  });

  it('treats unknown parts as unique and a pack part with no pool as unique', () => {
    const { pools, unique } = partitionByPart([{ id: 'x', object: 'mystery', x: 0, y: 0 }]);
    expect(pools.size).toBe(0);
    expect(unique).toHaveLength(1);
  });

  it('partitionScene matches the pools', () => {
    const view = partitionScene(PROCESS_SCENE.objects);
    expect(view.pipes.length + view.elbows.length + view.valves.length + view.caps.length + view.unique.length).toBe(
      PROCESS_SCENE.objects.length,
    );
  });
});
