/// <reference types="vite/client" />
/**
 * Bundled GLB part models as URLs. `?url` makes Vite emit each file as an
 * asset and hand back its served URL, so packs never hard-code `/models/...`.
 * Works unchanged under Vitest (vite transforms `import.meta.glob`).
 */
const urls = import.meta.glob('./*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Basename without extension (`fermenter`) -> asset URL. */
export const BUILTIN_MODEL_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([path, url]) => [path.replace(/^.*\//, '').replace(/\.glb$/, ''), url]),
);

/** URL of a bundled model; throws on an unknown name so a typo fails loudly. */
export function modelUrl(name: string): string {
  const url = BUILTIN_MODEL_URLS[name];
  if (!url) {
    throw new Error(`unknown built-in model "${name}" (have: ${Object.keys(BUILTIN_MODEL_URLS).sort().join(', ')})`);
  }
  return url;
}
