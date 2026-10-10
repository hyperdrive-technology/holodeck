import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { HOLODECK_KINDS, type Contribution, type ContributionRegistry } from '@holodeck/sdk';
import { getDefaultIsoRegistry } from './default';
import type { IsoAnimator, IsoInspectorPanel, IsoPartDefinition, IsoTheme } from './types';

const RegistryContext = createContext<ContributionRegistry | null>(null);

export function IsoRegistryProvider({
  registry,
  children,
}: {
  registry: ContributionRegistry;
  children?: ReactNode;
}) {
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/** The provided registry, else the shared built-in one. */
export function useIsoRegistry(): ContributionRegistry {
  return useContext(RegistryContext) ?? getDefaultIsoRegistry();
}

/**
 * Contributions of `kind`, re-rendering when the registry changes
 * (late installs, uninstalls, kind registration). `registry.list()` builds a
 * fresh array every call, so we cache per registry version: useSyncExternalStore
 * needs a referentially stable snapshot or it loops.
 */
export function useIsoContributions<T extends Contribution>(kind: string, registry?: ContributionRegistry): readonly T[] {
  const fromContext = useIsoRegistry();
  const reg = registry ?? fromContext;
  const store = getStore(reg);
  const snapshot = () => store.snapshot<T>(kind);
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/** Exported for tests (no DOM here to mount a component against). */
export interface ContributionStore {
  subscribe(listener: () => void): () => void;
  snapshot<T extends Contribution>(kind: string): readonly T[];
}

const stores = new WeakMap<ContributionRegistry, ContributionStore>();

export function getStore(registry: ContributionRegistry): ContributionStore {
  let store = stores.get(registry);
  if (store) return store;
  let version = 0;
  const cache = new Map<string, { version: number; items: readonly Contribution[] }>();
  const listeners = new Set<() => void>();
  // Permanent subscription (dies with the registry): changes made while no
  // component is mounted must still invalidate the snapshot cache.
  registry.subscribe(() => {
    version += 1;
    for (const l of listeners) l();
  });
  store = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot<T extends Contribution>(kind: string) {
      const hit = cache.get(kind);
      if (hit && hit.version === version) return hit.items as readonly T[];
      const items = registry.list<T>(kind);
      cache.set(kind, { version, items });
      return items;
    },
  };
  stores.set(registry, store);
  return store;
}

export const useIsoParts = (registry?: ContributionRegistry) =>
  useIsoContributions<IsoPartDefinition>(HOLODECK_KINDS.isoPart, registry);
export const useIsoThemes = (registry?: ContributionRegistry) =>
  useIsoContributions<IsoTheme>(HOLODECK_KINDS.isoTheme, registry);
export const useIsoAnimatorList = (registry?: ContributionRegistry) =>
  useIsoContributions<IsoAnimator>(HOLODECK_KINDS.isoAnimator, registry);
export const useIsoInspectorPanels = (registry?: ContributionRegistry) =>
  useIsoContributions<IsoInspectorPanel>(HOLODECK_KINDS.isoInspector, registry);

/**
 * Style of the `holodeck.iso.theme` named `themeId`, or `undefined` for no
 * id (caller keeps the default look). An id nobody installed also yields
 * `undefined`, with a console warning: a scene should still render when the
 * pack that carried its theme is missing.
 */
export function useIsoThemeStyle(themeId: string | undefined, registry?: ContributionRegistry) {
  const themes = useIsoThemes(registry);
  if (!themeId) return undefined;
  const theme = themes.find((t) => t.id === themeId);
  if (!theme) warnOnce(`theme:${themeId}`, `unknown iso theme "${themeId}"; using the default look`);
  return theme?.style;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}
