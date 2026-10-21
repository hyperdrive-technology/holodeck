import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The integration test imports the engine's pure validators from source.
    // Resolve their SDK import here: the CI matrix need not install the editor.
    // Point at the package directory so its own `exports` map picks the entry
    // (holodeck-sdk >= 0.2.0 is ESM-only: dist/index.js, no index.mjs).
    //
    // `@holodeck/editor-2.5d-react/contracts` is the editor's stable,
    // dependency-light entry (validators + style; src/contracts.ts). Tests
    // import it by that name; this alias maps it to the source entry so the job
    // needs no editor build or React/three install (holodeck#137). Only the
    // entry file is pinned here: the editor can move its internals freely, and
    // its own contracts.test.ts keeps the entry React-free.
    alias: {
      '@holodeck/sdk': fileURLToPath(new URL('./node_modules/@holodeck/sdk', import.meta.url)),
      '@holodeck/editor-2.5d-react/contracts': fileURLToPath(new URL('../editor-2.5d-react/src/contracts.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.mjs'],
    testTimeout: 30_000,
  },
});
