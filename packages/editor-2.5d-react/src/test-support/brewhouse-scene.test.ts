import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { boundMetrics, breweryVesselPreset, builtinBrewhouse, metricSnapshot } from './brewhouse-scene';
import { BUILTIN_ISO_PARTS, tankPlacementShape } from '../registry/builtin';
import { mergeTankParams } from '../../assets/process/tank-params';

const fixture = path.resolve(import.meta.dirname, '../../tests/fixtures/brewery/brewhouse.iso.json');
const raw = JSON.parse(readFileSync(fixture, 'utf8')) as IsoSceneFile;
const scene = builtinBrewhouse(raw);
const byId = (id: string) => scene.objects.find((o) => o.id === id);
const rawById = (id: string) => raw.objects.find((o) => o.id === id)!;

describe('builtinBrewhouse (core brewhouse -> built-in parts)', () => {
  it('every brewery vessel becomes a tank with its own preset, size and level fraction', () => {
    for (const [id, preset] of [['hlt', 'hlt'], ['mash-tun', 'mash-tun'], ['kettle', 'kettle'], ['whirlpool', 'whirlpool']] as const) {
      const src = rawById(id);
      const o = byId(id)!;
      expect(o.object).toBe('tank');
      expect(o.params).toMatchObject({ preset, level: (src.params!.level as number) / 100, radius: src.params!.radius });
      expect(o.height).toBe(src.params!.height);
    }
  });

  it('the mash tun is the agitated vessel and the whirlpool has its flat lid', () => {
    expect(mergeTankParams(tankPlacementShape(byId('mash-tun')!).params).agitator).toBe(true);
    expect(mergeTankParams(tankPlacementShape(byId('whirlpool')!).params).top).toBe('flat');
    expect(mergeTankParams(tankPlacementShape(byId('hlt')!).params).top).toBe('dome');
  });

  it('an empty vessel (and one without a level) has level 0, not a default fill', () => {
    expect(byId('whirlpool')!.params!.level).toBe(0);
    const bare = builtinBrewhouse({ ...raw, objects: [{ id: 'v', object: 'brewery:kettle', x: 0, y: 0 }] });
    expect(bare.objects[0]!.params!.level).toBe(0);
  });

  it('level labels read their vessel: the label and the tank bind the same metric', () => {
    for (const [label, vessel] of [['l-hlt-level', 'hlt'], ['l-mt-level', 'mash-tun'], ['l-kettle-level', 'kettle'], ['l-wp-level', 'whirlpool']]) {
      expect(rawById(label).params!.value).toBe(0); // the stale value core's file stores
      expect(byId(label)!.params!.value).toBe(rawById(vessel).params!.level);
      expect(boundMetrics(rawById(label)).value).toBe(boundMetrics(rawById(vessel)).level);
    }
    expect(byId('l-hlt-temp')!.params!.value).toBe(rawById('hlt').params!.tempC);
    // Pumps are dropped but still feed their labels.
    expect(byId('pump-hlt')).toBeUndefined();
    expect(byId('l-pump-hlt')!.params!.value).toBe(false);
    // Unbound labels are untouched.
    expect(byId('l-hlt')!.params).toEqual(rawById('l-hlt').params);
  });

  it('keeps every non-brewery object, drops core extensions, and only uses parts this package ships', () => {
    const kept = raw.objects.filter((o) => !o.object.startsWith('brewery:') || breweryVesselPreset(o.object));
    expect(scene.objects.map((o) => o.id)).toEqual(kept.map((o) => o.id));
    expect(scene.objects.every((o) => o.extensions === undefined)).toBe(true);
    const shipped = new Set(BUILTIN_ISO_PARTS.map((p) => p.id));
    expect(scene.objects.filter((o) => !shipped.has(o.object))).toEqual([]);
  });

  it('helpers: presets only for vessel parts; snapshot skips labels and keeps the first value', () => {
    expect(breweryVesselPreset('brewery:pump')).toBeUndefined();
    expect(breweryVesselPreset('brewery:heat-exchanger')).toBeUndefined();
    expect(breweryVesselPreset('brewery:nope')).toBeUndefined();
    expect(breweryVesselPreset('tank')).toBeUndefined();
    expect(breweryVesselPreset('brewery:brite-tank')).toBe('brite-tank');
    const ext = (metric: string) => ({ 'hyperdrive.bindings': { metrics: { level: metric, value: metric } } });
    const objs: IsoPlacement[] = [
      { id: 'a', object: 'tank', x: 0, y: 0, params: { level: 1 }, extensions: ext('m') },
      { id: 'b', object: 'tank', x: 0, y: 0, params: { level: 2 }, extensions: ext('m') },
      { id: 'c', object: 'label', x: 0, y: 0, params: { value: 9 }, extensions: ext('n') },
    ];
    expect([...metricSnapshot(objs)]).toEqual([['m', 1]]);
    expect(boundMetrics({ id: 'x', object: 'tank', x: 0, y: 0 })).toEqual({});
  });
});
