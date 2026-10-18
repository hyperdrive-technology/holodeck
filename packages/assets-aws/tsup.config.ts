import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/holodeck-package.ts'],
  format: ['esm'],
  outDir: 'dist',
  dts: true,
  clean: true,
});
