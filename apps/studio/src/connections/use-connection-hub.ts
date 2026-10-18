/**
 * Live data for the open document: one `ProviderHub` per open document,
 * pointed at its connections and bindings (`connectIsoDocument`), with
 * secrets from this tab's sessionStorage. Returns the live metrics for
 * `ProcessEditor` and each connection's status for the badges.
 */

import type { ConnectionState, HolodeckDocument, HolodeckHost, ProviderHub } from '@holodeck/sdk';
import { connectIsoDocument, useHubMetrics, type IsoMetrics, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { connectionFingerprint } from './fingerprint';
import type { SessionSecretStore } from './secrets';

const NO_CONNECTIONS: Readonly<Record<string, ConnectionState>> = Object.freeze({});
const noSubscribe = () => () => undefined;

export interface ConnectionHub {
  hub: ProviderHub | undefined;
  metrics: IsoMetrics;
  /** connectionId -> provider + status (`connecting` | `live` | `stale` | `disconnected` | `error`). */
  statuses: Readonly<Record<string, ConnectionState>>;
  /** Close and reopen one connection (after its secrets changed: the config, and so the hub key, did not). */
  reconnect: (connectionId: string) => void;
}

export function useConnectionHub(
  host: HolodeckHost,
  doc: Pick<HolodeckDocument<IsoSceneFile>, 'id' | 'connections' | 'body'>,
  secrets: SessionSecretStore,
): ConnectionHub {
  const [hub, setHub] = useState<ProviderHub | undefined>(undefined);
  // The hub asks for secrets whenever a session (re)opens; answer with the
  // connection's CURRENT fingerprint, so a secret entered for another
  // endpoint is never sent (holodeck#166).
  const connectionsRef = useRef(doc.connections);
  connectionsRef.current = doc.connections;
  // Created in an effect (not useMemo) so StrictMode's double mount disposes
  // the first hub instead of reusing a disposed one (same as the embed route).
  useEffect(() => {
    const fingerprintOf = (connectionId: string) => {
      const connection = connectionsRef.current?.find((c) => c.id === connectionId);
      return connection ? connectionFingerprint(connection) : undefined;
    };
    const created = host.createProviderHub({ secret: secrets.forDocument(doc.id, fingerprintOf) });
    setHub(created);
    return () => {
      void created.dispose();
    };
  }, [host, secrets, doc.id]);

  const { connections, body } = doc;
  useEffect(() => {
    if (!hub) return;
    try {
      connectIsoDocument(hub, { connections, body });
    } catch (error) {
      // A malformed binding (validated documents have none) must not take the editor down.
      console.warn('holodeck studio: could not connect live data', error);
    }
  }, [hub, connections, body]);

  const metrics = useHubMetrics(hub);
  const statuses = useSyncExternalStore(
    hub?.subscribe ?? noSubscribe,
    () => hub?.getSnapshot().connections ?? NO_CONNECTIONS,
    () => NO_CONNECTIONS,
  );

  const reconnect = useCallback(
    (connectionId: string) => {
      if (!hub) return;
      const all = connections ?? [];
      hub.setConnections(all.filter((c) => c.id !== connectionId));
      hub.setConnections(all);
    },
    [hub, connections],
  );

  return { hub, metrics, statuses, reconnect };
}
