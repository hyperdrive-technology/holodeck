import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The integration test imports the engine's pure validators from source.
    // Resolve their SDK import here: the CI matrix need not install the editor.
    alias: { '@holodeck/sdk': fileURLToPath(new URL('./node_modules/@holodeck/sdk/dist/index.mjs', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.mjs'],
    testTimeout: 30_000,
  },
});
