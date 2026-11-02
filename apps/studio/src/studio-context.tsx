import type { HolodeckHost } from '@holodeck/sdk';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { DocumentChannel } from './documents/changes';
import type { SessionSecretStore } from './connections/secrets';
import type { DocumentStore } from './documents/store';

/**
 * What every studio screen needs: the Holodeck host (engines + packages), the
 * document store, cross-tab change notices, and this tab's connection secrets.
 */
export interface StudioServices {
  host: HolodeckHost;
  store: DocumentStore;
  channel: DocumentChannel;
  secrets: SessionSecretStore;
}

const StudioContext = createContext<StudioServices | null>(null);

export function StudioProvider({ services, children }: { services: StudioServices; children: ReactNode }) {
  const { channel, secrets } = services;
  // A document deleted in another tab takes this tab's secrets for it along,
  // on every route (holodeck#166, #241 review): a document imported later
  // under the same id must never inherit them. This used to live in the
  // studio shell (AppShell), so a tab on /playground or /embed kept them.
  // The open playground's own deletion is cleared here too, at once, even
  // while its "deleted elsewhere" dialog waits for the user; the copy that
  // dialog can save is a new document with no secrets.
  useEffect(
    () =>
      channel.subscribe((change) => {
        if (change.type === 'deleted') secrets.clear(change.id);
      }),
    [channel, secrets],
  );
  return <StudioContext.Provider value={services}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioServices {
  const services = useContext(StudioContext);
  if (!services) throw new Error('useStudio() outside <StudioProvider>');
  return services;
}
