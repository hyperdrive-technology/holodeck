import { defineConfig } from 'tsup';

export default defineConfig({
  // `holodeck-package` is the Holodeck package entry named in holodeck.package.json
  // (`entry`); hosts load it by path, so it is a separate file, not just an export.
  entry: ['src/index.ts', 'src/holodeck-package.ts'],
  // ESM only, like @holodeck/flow-runtime (holodeck#60). No top-level await, so
  // Node's require(esm) still works.
  format: ['esm'],
  outDir: 'dist',
  dts: true,
  clean: true,
});
