import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));
// Same map as tsconfig.json `paths`: the bundled studio modules (src/studio.ts)
// resolve their imports from this package, not from apps/studio/node_modules.
const shared = ['@holodeck/sdk', '@holodeck/editor-2.5d-react', '@holodeck/provider-http', '@holodeck/provider-aws'];

export default defineConfig({
  resolve: {
    alias: shared.map((name) => ({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`), replacement: resolve(here, 'node_modules', name) })),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
