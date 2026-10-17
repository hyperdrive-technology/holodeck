/**
 * `/embed/$docId`: a read-only, chrome-less view of one document with live
 * data (holodeck#42, lane S2). For iframes:
 *
 *   <iframe src="https://studio.example/embed/<docId>?parentOrigin=https://app.example"></iframe>
 *
 * - Run mode: the engine's `ProcessEditor` with `mode="run"` and
 *   `chrome="canvas"`: pan / zoom / rotate only, no palette, inspector, drags,
 *   or edit shortcuts. Nothing here ever writes to the document store.
 * - Live data: a `ProviderHub` from the studio host, connected to the
 *   document's connections and bindings; `setObjectState` messages override
 *   values per param on top (protocol.ts).
 * - Documents: the stored one for `docId` (kept current when another tab
 *   saves it), or one the parent sends with `loadDocument`, which then wins.
 *   A cross-site parent sees an empty store (partitioned storage), so
 *   `loadDocument` is how it shows its own documents.
 */

import type { ProviderHub } from '@holodeck/sdk';
import { connectIsoDocument, ISO_ENGINE_ID, ProcessEditor, useHubMetrics } from '@holodeck/editor-2.5d-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { documentKeys, useDocument, useDocumentCamera } from '../documents/queries';
import { useStudio } from '../studio-context';
import { handleEmbedMessage, type IsoDocument } from './handler';
import { embedOriginPolicy } from './origins';
import { mergeObjectStates, withObjectState, withoutObjectState, type EmbedInbound, type ObjectStates } from './protocol';
import { useEmbedBridge, type EmbedParent } from './use-embed-bridge';

const EMPTY_STATES: ObjectStates = Object.freeze(Object.create(null));
const noop = () => {};

export function EmbedRoute({
  docId,
  embedParent,
}: {
  docId: string;
  /** Tests only: stands in for `window.parent` (default: the real parent frame, if any). */
  embedParent?: EmbedParent | null;
}) {
  const { host, channel } = useStudio();
  const client = useQueryClient();
  const stored = useDocument(docId);
  const camera = useDocumentCamera(docId);
  /** A document the parent sent (`loadDocument`); wins over the stored one. */
  const [supplied, setSupplied] = useState<IsoDocument | null>(null);
  const storedDoc = (stored.data?.document as IsoDocument | undefined) ?? null;
  const doc = supplied ?? storedDoc;
  const [states, setStates] = useState<ObjectStates>(EMPTY_STATES);
  const docRef = useRef(doc);
  docRef.current = doc;

  // Read once: the URL and build config do not change while the embed lives.
  const policy = useMemo(
    () => embedOriginPolicy(window.location.origin, new URLSearchParams(window.location.search), import.meta.env.VITE_HOLODECK_EMBED_ORIGINS),
    [],
  );
  useEffect(() => {
    if (policy.rejected.length) console.warn(`holodeck embed: ignored parentOrigin ${policy.rejected.map((o) => JSON.stringify(o)).join(', ')}`);
  }, [policy]);

  // Keep the stored document current: another tab saving it re-reads it here.
  useEffect(
    () =>
      channel.subscribe((change) => {
        if (change.id === docId) void client.invalidateQueries({ queryKey: documentKeys.detail(docId) });
      }),
    [channel, client, docId],
  );

  // One hub per mounted embed. Created in an effect (not useMemo) so React's
  // StrictMode double-mount disposes the first hub instead of reusing it disposed.
  const [hub, setHub] = useState<ProviderHub | undefined>(undefined);
  useEffect(() => {
    const created = host.createProviderHub();
    setHub(created);
    return () => {
      void created.dispose();
    };
  }, [host]);
  useEffect(() => {
    if (!hub || !doc) return;
    try {
      connectIsoDocument(hub, doc);
    } catch (error) {
      console.warn('holodeck embed: could not connect live data', error);
    }
  }, [hub, doc]);
  const hubMetrics = useHubMetrics(hub);
  const metrics = useMemo(() => mergeObjectStates(hubMetrics, states), [hubMetrics, states]);

  const onMessage = useCallback(
    (message: EmbedInbound) => {
      const outcome = handleEmbedMessage(message, { document: docRef.current, host });
      const { action } = outcome;
      if (action.kind === 'set-state') setStates((s) => withObjectState(s, action.objectId, action.state));
      else if (action.kind === 'clear-state') setStates((s) => withoutObjectState(s, action.objectId));
      else if (action.kind === 'load') {
        docRef.current = action.document;
        setSupplied(action.document);
        setStates(EMPTY_STATES);
      }
      return outcome;
    },
    [host],
  );
  const { enabled } = useEmbedBridge({ policy, documentId: doc?.id ?? null, onMessage, parent: embedParent });

  const stateCount = Object.keys(states).length;
  const rootProps = {
    'data-testid': 'embed',
    'data-embed-api': enabled ? 'on' : 'off',
    'data-document-id': doc?.id ?? '',
    'data-object-states': String(stateCount),
    className: 'relative flex h-full w-full flex-1 overflow-hidden bg-white',
  };

  if (!doc) {
    const waiting = stored.isPending || camera.isPending;
    return (
      <div {...rootProps}>
        <p role="status" className="m-auto p-6 text-sm text-muted-foreground">
          {waiting ? 'Loading…' : stored.error ? `Could not open the document: ${stored.error.message}` : 'This document is not available here.'}
        </p>
      </div>
    );
  }
  if (doc.engine !== ISO_ENGINE_ID) {
    return (
      <div {...rootProps}>
        <p role="status" className="m-auto p-6 text-sm text-muted-foreground">
          No viewer for engine “{doc.engine}”.
        </p>
      </div>
    );
  }
  // Wait for the stored camera (if any) so the first frame is the author's view, not a fit that then jumps.
  if (!supplied && camera.isPending) {
    return (
      <div {...rootProps}>
        <p role="status" className="m-auto p-6 text-sm text-muted-foreground">
          Loading…
        </p>
      </div>
    );
  }
  const storedCamera = !supplied && !camera.isError ? (camera.data ?? undefined) : undefined;
  return (
    <div {...rootProps}>
      <ProcessEditor
        // A new document (loadDocument) gets a fresh view.
        key={doc.id}
        scene={doc.body}
        onChange={noop}
        mode="run"
        chrome="canvas"
        registry={host.registry}
        metrics={metrics}
        camera={storedCamera}
      />
    </div>
  );
}
