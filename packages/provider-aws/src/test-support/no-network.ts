/**
 * Vitest setup: the global fetch throws, so a request that bypasses
 * ProviderContext.fetch (and the fake backend) fails the test instead of
 * reaching AWS.
 */
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`no-network: test tried to fetch ${url} outside ProviderContext.fetch`);
}) as typeof fetch;
