import type { HolodeckHost } from '@holodeck/sdk';
import { createContext, useContext, type ReactNode } from 'react';
import type { DocumentStore } from './documents/store';

/** What every studio screen needs: the Holodeck host (engines + packages) and the document store. */
export interface StudioServices {
  host: HolodeckHost;
  store: DocumentStore;
}

const StudioContext = createContext<StudioServices | null>(null);

export function StudioProvider({ services, children }: { services: StudioServices; children: ReactNode }) {
  return <StudioContext.Provider value={services}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioServices {
  const services = useContext(StudioContext);
  if (!services) throw new Error('useStudio() outside <StudioProvider>');
  return services;
}
