/**
 * Registers the open playground with the MCP bridge (when `pnpm playground`
 * runs one) so an agent can read and edit the live scene: see
 * mcp-bridge-session.ts for what it may do, bridge-protocol.ts for the wire.
 * Without a bridge this makes one request at mount and then does nothing.
 */

import { useEffect, useRef, useState } from 'react';
import type { SignalNode } from '@holodeck/sdk';
import { useStudio } from '../studio-context';
import type { DocumentSession } from '../features/use-document-session';
import { startBridgeClient, type BridgeClient, type BridgeClientState } from './mcp-bridge-client';
import { BridgeError } from './bridge-protocol';
import { createPlaygroundBridgeHandler, installedProviders } from './mcp-bridge-session';

export interface McpBridgeOptions {
  tab: string;
  /** A dialog owns the working copy (reset, conflict, rebuilding): why, or null. */
  blocked: string | null;
}

export function useMcpBridge(session: DocumentSession, { tab, blocked }: McpBridgeOptions): BridgeClientState | null {
  const { host } = useStudio();
  const [state, setState] = useState<BridgeClientState | null>(null);
  // Everything the handler reads goes through refs: one client for the
  // workspace's lifetime, always seeing the latest render.
  const live = useRef({ session, tab, blocked });
  live.current = { session, tab, blocked };
  const client = useRef<BridgeClient | null>(null);

  useEffect(() => {
    const now = () => live.current;
    const handle = createPlaygroundBridgeHandler({
      doc: () => now().session.docRef.current,
      editor: () => now().session.editorRef.current,
      tab: () => now().tab,
      blocked: () => now().blocked,
      save: () => {
        const w = now().session.writer.getState();
        return { status: w.status.kind, revision: w.revision, dirty: w.dirty };
      },
      selectedId: () => now().session.selectedId,
      statuses: () => now().session.live.statuses,
      metrics: () => now().session.live.metrics,
      providers: () => installedProviders(host.registry),
      saveConnection: (connection, isNew) => now().session.saveConnection({ connection, secrets: {} }, isNew),
      browse: async (connectionId, path): Promise<SignalNode[]> => {
        const providerSession = now().session.live.hub?.session(connectionId);
        if (!providerSession) throw new BridgeError(`connection "${connectionId}" is not connected in the playground`, 'not_connected');
        if (!providerSession.browse) throw new BridgeError(`connection "${connectionId}" cannot list its signals`, 'unsupported');
        return providerSession.browse(path);
      },
    });
    client.current = startBridgeClient({
      info: () => ({ documentId: now().session.docRef.current.id, documentName: now().session.docRef.current.name, tab: now().tab }),
      handle,
      onState: setState,
    });
    return () => {
      client.current?.close();
      client.current = null;
    };
  }, [host]);

  // Keep the bridge's session list current.
  const name = session.doc.name;
  useEffect(() => client.current?.update(), [tab, name]);

  return state;
}
