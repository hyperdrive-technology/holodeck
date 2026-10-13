/**
 * `import url from './x.glb?url'` -> string. Declared locally rather than via
 * `vite/client` so the published declarations don't require Vite's types.
 * Vite handles the import in source; tsup's glbUrlPlugin handles it in dist/.
 */
declare module '*.glb?url' {
  const url: string;
  export default url;
}
