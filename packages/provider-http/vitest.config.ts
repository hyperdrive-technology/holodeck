import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Every test talks to a local server on 127.0.0.1 (src/test-support/server.ts);
    // nothing reaches an external network.
    testTimeout: 15_000,
  },
});
