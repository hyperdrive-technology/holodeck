import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // Every AWS call goes to a fake backend behind ProviderContext.fetch
    // (src/test-support/fake-aws.ts); the global fetch throws, so nothing
    // reaches a network.
    setupFiles: ['src/test-support/no-network.ts'],
    testTimeout: 15_000,
  },
});
