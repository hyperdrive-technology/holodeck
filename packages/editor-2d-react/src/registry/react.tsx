import {
  HOLODECK_KINDS,
  type Contribution,
  type ContributionRegistry,
  type FlowComponentContribution,
} from '@holodeck/sdk';
import { createContext, useCallback, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { FlowPaletteContribution } from './flowKinds';

const FlowRegistryContext = createContext<ContributionRegistry | undefined>(undefined);

export function FlowRegistryProvider(props: { registry: ContributionRegistry; children?: ReactNode }) {
  return <FlowRegistryContext.Provider value={props.registry}>{props.children}</FlowRegistryContext.Provider>;
}

/** Registry from context, or undefined when no provider is mounted. */
export function useOptionalFlowRegistry(): ContributionRegistry | undefined {
  return useContext(FlowRegistryContext);
}

export function useFlowRegistry(): ContributionRegistry {
  const registry = useContext(FlowRegistryContext);
  if (!registry) throw new Error('useFlowRegistry must be used inside <FlowRegistryProvider>');
  return registry;
}

const EMPTY: readonly never[] = [];

/**
 * Subscribe to the contributions of one kind. `registry.list()` allocates a new
 * array on every call, which would make useSyncExternalStore loop, so the
 * snapshot is cached and only replaced when its members actually change.
 */
export function useRegistryContributions<T extends Contribution>(
  registry: ContributionRegistry | undefined,
  kind: string,
): readonly T[] {
  const cache = useRef<readonly T[]>(EMPTY as readonly T[]);
  const subscribe = useCallback(
    (cb: () => void) => (registry ? registry.subscribe(() => cb()) : () => {}),
    [registry],
  );
  const getSnapshot = useCallback((): readonly T[] => {
    const next = registry ? registry.list<T>(kind) : (EMPTY as readonly T[]);
    const prev = cache.current;
    if (prev.length === next.length && prev.every((item, i) => item === next[i])) return prev;
    cache.current = next;
    return next;
  }, [registry, kind]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Contributions of `kind` from the registry in context; re-renders on change. */
export function useFlowContributions<T extends Contribution = Contribution>(kind: string): readonly T[] {
  return useRegistryContributions<T>(useFlowRegistry(), kind);
}

export const useFlowNodeTypeContributions = (registry: ContributionRegistry | undefined) =>
  useRegistryContributions<FlowComponentContribution>(registry, HOLODECK_KINDS.flowNodeType);
export const useFlowEdgeTypeContributions = (registry: ContributionRegistry | undefined) =>
  useRegistryContributions<FlowComponentContribution>(registry, HOLODECK_KINDS.flowEdgeType);
export const useFlowPaletteContributions = (registry: ContributionRegistry | undefined) =>
  useRegistryContributions<FlowPaletteContribution>(registry, HOLODECK_KINDS.flowPalette);
