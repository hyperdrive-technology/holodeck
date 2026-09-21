/**
 * Hook for accessing Holodeck context and state
 */

import { useContext } from 'react';
import type { HolodeckStore } from '../types';

// Create a placeholder context for now - will be implemented with the provider
export const HolodeckContext = {} as React.Context<HolodeckStore>;

/**
 * Hook to access the Holodeck store and actions
 */
export function useHolodeck(): HolodeckStore {
  const store = useContext(HolodeckContext);

  if (!store) {
    throw new Error('useHolodeck must be used within a HolodeckProvider');
  }

  return store;
}
