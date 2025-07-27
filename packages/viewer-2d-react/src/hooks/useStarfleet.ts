/**
 * Hook for accessing Starfleet scene state
 */

import React, { useContext, createContext, type ReactNode } from 'react';
import type { SceneFile } from '../types';

interface StarfleetContextValue {
  scene: SceneFile | null;
}

const StarfleetContext = createContext<StarfleetContextValue | null>(null);

export function StarfleetProvider({ children, scene }: { children: ReactNode; scene: SceneFile }) {
  return React.createElement(
    StarfleetContext.Provider,
    { value: { scene } },
    children
  );
}

export function useStarfleet() {
  const context = useContext(StarfleetContext);
  if (!context) {
    throw new Error('useStarfleet must be used within a StarfleetProvider');
  }
  return context;
}
