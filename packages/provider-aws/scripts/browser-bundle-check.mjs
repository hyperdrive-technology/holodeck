#!/usr/bin/env node
/**
 * Browser compatibility check for the built package (run after `pnpm build`):
 *
 *   node scripts/browser-bundle-check.mjs
 *
 * Bundles dist/index.js and dist/holodeck-package.js for the browser with
 * esbuild (`platform: "browser"`, the `browser` export conditions and
 * package.json `browser` fields the AWS SDK uses to swap its Node runtime
 * config for the browser one). The build fails if anything pulls in a Node
 * built-in (`fs`, `http`, `child_process` …), which is exactly what would break
 * a Vite/webpack consumer. Prints the minified bundle size for reference.
 *
 * esbuild comes from tsup (a dev dependency), so no extra install is needed.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// esbuild is tsup's dependency; resolve it through tsup so pnpm's strict layout finds it.
const requireFromTsup = createRequire(createRequire(join(PKG_DIR, 'package.json')).resolve('tsup'));
const esbuild = requireFromTsup('esbuild');

let failed = false;
for (const entry of ['dist/index.js', 'dist/holodeck-package.js']) {
  try {
    const result = await esbuild.build({
      entryPoints: [join(PKG_DIR, entry)],
      bundle: true,
      write: false,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      logLevel: 'silent',
      metafile: true,
    });
    const bytes = result.outputFiles.reduce((n, f) => n + f.contents.length, 0);
    const nodeInputs = Object.keys(result.metafile.inputs).filter((p) => /(^|\/)node:|runtimeConfig\.js$/.test(p) && !p.includes('runtimeConfig.shared'));
    if (nodeInputs.length) {
      failed = true;
      console.error(`${entry}: browser bundle includes Node-only modules:\n  ${nodeInputs.join('\n  ')}`);
    } else {
      console.log(`${entry}: browser bundle OK (${(bytes / 1024).toFixed(0)} KiB minified)`);
    }
  } catch (err) {
    failed = true;
    console.error(`${entry}: browser bundle failed:\n${err.errors?.map((e) => `  ${e.text} (${e.location?.file ?? '?'})`).join('\n') ?? err}`);
  }
}
if (failed) process.exit(1);
console.log('browser-bundle-check OK');
