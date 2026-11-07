import { defineConfig } from 'tsup';

export default defineConfig({
  // `cli` is the `holodeck-mcp` bin (stdio server); `index` the library entry.
  entry: ['src/index.ts', 'src/cli.ts'],
  // ESM only, like the provider packages. Node >= 26.
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  // tsup's dts worker sets `baseUrl`, which TypeScript 6 deprecates (TS5101) when
  // `paths` is present; the declaration build does not depend on it.
  dts: { entry: 'src/index.ts', compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  // The studio modules bundled through src/studio.ts import these by name; they
  // stay external (dependencies of this package), resolved from dist/ at run time.
  external: [/^@holodeck\//, /^@modelcontextprotocol\//, 'zod'],
});
