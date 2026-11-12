import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Same arrangement as library-cloud (holodeck#137): the SDK resolves from
    // this package's own node_modules, and the editor's dependency-light
    // `./contracts` entry (validators, style tokens, built-in animators and
    // the pure animation planner) is aliased to its source file, so the CI job
    // needs no editor build or React install. The contracts entry is kept
    // React/three-free at runtime by the editor's contracts.test.ts.
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
