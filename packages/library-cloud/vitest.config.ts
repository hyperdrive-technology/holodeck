import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The integration test imports the engine's pure validators from source.
    // Resolve their SDK import here: the CI matrix need not install the editor.
    // Point at the package directory so its own `exports` map picks the entry
    // (holodeck-sdk >= 0.2.0 is ESM-only: dist/index.js, no index.mjs).
    alias: { '@holodeck/sdk': fileURLToPath(new URL('./node_modules/@holodeck/sdk', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.mjs'],
    testTimeout: 30_000,
  },
});
