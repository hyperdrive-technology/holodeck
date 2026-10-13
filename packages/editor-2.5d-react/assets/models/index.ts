/**
 * Bundled GLB part models as URLs: an explicit asset map, one static import
 * per file, so every toolchain that touches this module can see the assets.
 *
 * - Source (Vite dev/build, Vitest): Vite's `?url` suffix emits the file as an
 *   asset and returns its served URL.
 * - Built package (tsup): `glbUrlPlugin` in `tsup.config.ts` rewrites each
 *   `./<name>.glb?url` import to `new URL('./models/<name>.glb', import.meta.url).href`
 *   and copies the GLB to `dist/models/`. That expression is the cross-bundler
 *   asset idiom (Vite, webpack 5, Rollup, Parcel) and resolves to a `file:` URL
 *   under plain Node (the CJS build gets `import.meta.url` from tsup's shim).
 *
 * This replaced `import.meta.glob`, which is Vite-only and which tsup leaves
 * untransformed, so the built package threw on import (holodeck#7).
 * Adding a model: drop the GLB here and add a line below;
 * `index.test.ts` fails if the map and the directory disagree.
 */
import briteTank from './brite-tank.glb?url';
import fermenter from './fermenter.glb?url';
import heatExchanger from './heat-exchanger.glb?url';
import kettle from './kettle.glb?url';
import mashTun from './mash-tun.glb?url';
import pump from './pump.glb?url';
import valve from './valve.glb?url';

/** Basename without extension (`fermenter`) -> asset URL. */
export const BUILTIN_MODEL_URLS: Readonly<Record<string, string>> = Object.freeze({
  'brite-tank': briteTank,
  fermenter,
  'heat-exchanger': heatExchanger,
  kettle,
  'mash-tun': mashTun,
  pump,
  valve,
});

/** URL of a bundled model; throws on an unknown name so a typo fails loudly. */
export function modelUrl(name: string): string {
  const url = Object.prototype.hasOwnProperty.call(BUILTIN_MODEL_URLS, name) ? BUILTIN_MODEL_URLS[name] : undefined;
  if (!url) {
    throw new Error(`unknown built-in model "${name}" (have: ${Object.keys(BUILTIN_MODEL_URLS).sort().join(', ')})`);
  }
  return url;
}
