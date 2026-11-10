import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_MODEL_URLS, modelUrl } from './index';

const onDisk = readdirSync(__dirname)
  .filter((f) => f.endsWith('.glb'))
  .map((f) => f.replace(/\.glb$/, ''))
  .sort();

describe('built-in model urls', () => {
  it('maps exactly the GLBs in this directory (the map is explicit; keep it in sync)', () => {
    expect(Object.keys(BUILTIN_MODEL_URLS).sort()).toEqual(onDisk);
    expect(onDisk).toEqual(['brite-tank', 'fermenter', 'heat-exchanger', 'kettle', 'mash-tun', 'mixer', 'pump', 'valve']);
  });
  it('each url ends in its own basename', () => {
    for (const name of onDisk) expect(modelUrl(name)).toMatch(new RegExp(`${name}\\.glb$`));
  });
  it('throws on unknown names, including Object.prototype keys', () => {
    expect(() => modelUrl('nope')).toThrow(/unknown built-in model "nope"/);
    expect(() => modelUrl('toString')).toThrow(/unknown built-in model "toString"/);
  });
  it('is frozen so a consumer cannot repoint a built-in', () => {
    expect(Object.isFrozen(BUILTIN_MODEL_URLS)).toBe(true);
  });
});
