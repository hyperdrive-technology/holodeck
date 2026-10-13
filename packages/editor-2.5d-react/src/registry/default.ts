import type { ContributionRegistry } from '@holodeck/sdk';
import { BUILTIN_ISO_EXTENSION } from './builtin';
import { createIsoRegistry } from './kinds';

let shared: ContributionRegistry | null = null;

/**
 * Shared registry with only the built-in extension installed. Lazy so that
 * importing `scene.ts` does not build it until a parse actually needs it.
 * Hosts that add packs should create their own registry (`createIsoRegistry()`
 * + `install(BUILTIN_ISO_EXTENSION)`) and pass it down; mutating this shared
 * one leaks packs between unrelated editors on the page.
 */
export function getDefaultIsoRegistry(): ContributionRegistry {
  if (!shared) {
    shared = createIsoRegistry();
    shared.install(BUILTIN_ISO_EXTENSION);
  }
  return shared;
}

/** Fresh registry with the iso kinds registered and the built-ins installed. */
export function createIsoRegistryWithBuiltins(): ContributionRegistry {
  const registry = createIsoRegistry();
  registry.install(BUILTIN_ISO_EXTENSION);
  return registry;
}
