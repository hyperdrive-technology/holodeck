import { describe, expect, it } from 'vitest';
import { BUILTIN_MODEL_URLS, modelUrl } from './index';

describe('built-in model urls', () => {
  it('has every bundled GLB keyed by basename', () => {
    expect(Object.keys(BUILTIN_MODEL_URLS).sort()).toEqual(
      ['brite-tank', 'fermenter', 'heat-exchanger', 'kettle', 'mash-tun', 'pump', 'valve'],
    );
    for (const name of Object.keys(BUILTIN_MODEL_URLS)) expect(modelUrl(name)).toMatch(/\.glb/);
  });
  it('throws on unknown names', () => {
    expect(() => modelUrl('nope')).toThrow(/unknown built-in model "nope"/);
  });
});
