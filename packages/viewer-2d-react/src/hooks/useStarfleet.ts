/**
 * Hook for accessing Starfleet context and state
 */

import { useContext } from 'react';
import type { StarfleetStore } from '../types';

// Create a placeholder context for now - will be implemented with the provider
export const StarfleetContext = {} as React.Context<StarfleetStore>;

/**
 * Hook to access the Starfleet store and actions
 */
export function useStarfleet(): StarfleetStore {
  const store = useContext(StarfleetContext);

  if (!store) {
    throw new Error('useStarfleet must be used within a StarfleetProvider');
  }

  return store;
}
