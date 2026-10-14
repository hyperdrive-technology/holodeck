import { defineConfig } from 'tsup';

export default defineConfig({
  // `holodeck-package` is the Holodeck package entry named in holodeck.package.json
  // (`entry`); hosts load it by path, so it is a separate file, not just an export.
  entry: ['src/index.ts', 'src/holodeck-package.ts'],
  format: ['cjs', 'esm'],
  outDir: 'dist',
  dts: true,
  clean: true,
});
