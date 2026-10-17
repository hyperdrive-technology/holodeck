/**
 * Backward compatibility of the stricter param validation (holodeck#36 review
 * BLOCK): every scene we know of must still load with the REAL built-in parts,
 * not just pass the JSON Schema. core's brewery scenes (vendored copies in
 * tests/fixtures/brewery, kept identical by brewery-fixtures.test.ts) store
 * label `value: false` with `format: "onoff"`; the first E2 cut rejected that
 * and the M1 brewery demo would have stopped loading.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { parseSceneFile, validateSceneGeometry, type IsoSceneFile } from '../iso/scene';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const coreHmi = path.resolve(pkgRoot, '../../../core/src/typescript/packages/hyperdrive-ui/examples/brewery/hmi');
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as IsoSceneFile;

const SCENES = [
  'tests/scene.json',
  'tests/fixtures/brewery/brewhouse.iso.json',
  'tests/fixtures/brewery/cellar.iso.json',
].map((f) => path.join(pkgRoot, f));

/**
 * Stand-ins for core's `brewery:*` parts (hyperdrive-ext-brewery), which this
 * repo cannot import. No param specs, so their params only need to be finite
 * JSON; the built-in parts (label, valve, pipe, area...) are the real ones.
 */
function registryWithBreweryStandIns(scenes: IsoSceneFile[]) {
  const registry = createIsoRegistryWithBuiltins();
  const ids = new Set(scenes.flatMap((s) => s.objects.map((o) => o.object)).filter((id) => id.startsWith('brewery:')));
  const parts: IsoPartDefinition[] = [...ids].map((id) => ({ id, label: id, footprint: { w: 2, h: 2 }, params: {} }));
  registry.install({ id: 'brewery-stand-ins', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: parts } });
  return registry;
}

describe('existing scenes still load with the real built-in parts', () => {
  const scenes = SCENES.map(read);
  const registry = registryWithBreweryStandIns(scenes);

  it.each(SCENES.map((f) => [path.relative(pkgRoot, f), f]))('%s parses (strict import)', (_name, file) => {
    expect(() => parseSceneFile(read(file), registry)).not.toThrow();
  });

  it('brewery ON/OFF readings: label value false with format onoff is accepted', () => {
    const brewhouse = read(SCENES[1]!);
    const onoff = brewhouse.objects.filter((o) => o.object === 'label' && o.params?.format === 'onoff');
    expect(onoff.length).toBeGreaterThan(0);
    expect(onoff.every((o) => typeof o.params?.value === 'boolean')).toBe(true);
    // Geometry validation alone checks every built-in placement's params against the real specs.
    expect(() => validateSceneGeometry(brewhouse, createIsoRegistryWithBuiltins())).not.toThrow();
  });

  it('label value accepts number, boolean, string and null readings; still rejects non-finite numbers and objects', () => {
    const registry = createIsoRegistryWithBuiltins();
    const scene = (value: unknown) => ({ id: 's', name: 's', gridCellSize: 1, objects: [{ id: 'l', object: 'label', x: 0, y: 0, params: { text: 'Pump', value } }] });
    for (const ok of [0, 64.2, true, false, 'HeatHLT', null]) expect(() => parseSceneFile(scene(ok), registry), String(ok)).not.toThrow();
    for (const bad of [Infinity, NaN, { a: 1 }, 'x'.repeat(5000)]) expect(() => parseSceneFile(scene(bad), registry)).toThrow(/params\.value/);
  });

  // Local dev with core checked out next to holodeck: parse core's live copies too.
  for (const name of ['brewhouse', 'cellar']) {
    const file = path.join(coreHmi, `${name}.iso.json`);
    it.skipIf(!existsSync(file))(`core's ${name}.iso.json parses`, () => {
      const scene = read(file);
      expect(() => parseSceneFile(scene, registryWithBreweryStandIns([scene]))).not.toThrow();
    });
  }
});
