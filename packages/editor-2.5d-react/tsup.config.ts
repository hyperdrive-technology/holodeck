import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { defineConfig, type Options } from 'tsup';

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

/** Built GLBs live here, next to index.mjs / index.js. */
const MODELS_OUT = 'models';

/**
 * Turns `import url from './x.glb?url'` (Vite's asset-URL import, used in
 * `assets/models/index.ts`) into
 *
 *   new URL('./models/x.glb', import.meta.url).href
 *
 * and copies the GLB to `dist/models/`. Every chunk tsup emits sits directly
 * in `dist/`, so the relative path holds for both formats. Downstream bundlers
 * (Vite, webpack 5, Rollup, Parcel) recognise this exact expression and emit
 * the file as an asset; Node resolves it to a real `file:` URL. The CJS build
 * relies on `shims: true` for `import.meta.url`.
 *
 * Consumer caveat (verified with Vite 5): Vite's dev-server dependency
 * pre-bundling (optimizeDeps / esbuild) rewrites the URL to
 * `/node_modules/.vite/deps/models/x.glb`, which 404s. Consumers using Vite dev
 * must list this package in `optimizeDeps.exclude`. `vite build` is fine.
 * scripts/smoke-dist.mjs (repo root) checks the built URLs in Node.
 */
function glbUrlPlugin(outDir: string): EsbuildPlugin {
  return {
    name: 'holodeck-glb-url',
    setup(build) {
      build.onResolve({ filter: /\.glb\?url$/ }, (args) => {
        const abs = resolve(args.resolveDir, args.path.replace(/\?url$/, ''));
        // Package-relative `path` keeps machine paths out of dist/ comments.
        return { path: relative(process.cwd(), abs), namespace: 'holodeck-glb-url', pluginData: abs };
      });
      build.onLoad({ filter: /.*/, namespace: 'holodeck-glb-url' }, (args) => {
        const abs = args.pluginData as string;
        const file = basename(abs);
        mkdirSync(join(outDir, MODELS_OUT), { recursive: true });
        copyFileSync(abs, join(outDir, MODELS_OUT, file));
        const rel = JSON.stringify(`./${MODELS_OUT}/${file}`);
        return {
          contents: `export default new URL(${rel}, import.meta.url).href;`,
          loader: 'js',
          // Rebuild in --watch when the Blender export rewrites the GLB.
          watchFiles: [abs],
          resolveDir: dirname(abs),
        };
      });
    },
  };
}

const OUT_DIR = 'dist';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  outDir: OUT_DIR,
  dts: true,
  clean: true,
  // CJS has no `import.meta`; the shim derives `import.meta.url` from __filename.
  shims: true,
  esbuildPlugins: [glbUrlPlugin(resolve(OUT_DIR))],
});
