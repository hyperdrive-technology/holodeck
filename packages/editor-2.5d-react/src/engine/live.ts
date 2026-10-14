/**
 * Live values for iso documents from a `ProviderHub` (contract: @holodeck/sdk
 * docs/PACKAGING.md §6.3).
 *
 *   const hub = host.createProviderHub({ secret });
 *   connectIsoDocument(hub, document);                 // connections + bindings
 *   <ProcessEditor scene={scene} metrics={useHubMetrics(hub)} />
 *
 * The hub's `snapshot.metrics` (objectId -> param -> transformed value) is
 * already the editor's `IsoMetrics` shape: objectId is the placement id, so
 * no adapter sits in between.
 */

import { useMemo, useSyncExternalStore } from 'react';
import type { HolodeckDocument, ProviderHub } from '@holodeck/sdk';
import type { IsoSceneFile } from '../iso/scene';
import type { IsoMetrics } from '../registry/types';
import { collectIsoBindings } from './bindings';
import { ISO_ENGINE_ID } from './iso-engine';

/** External store over a hub's metrics, in the shape `useSyncExternalStore` takes. */
export interface IsoMetricsStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): IsoMetrics;
}

const NO_METRICS: IsoMetrics = Object.freeze({});
const NO_HUB: IsoMetricsStore = Object.freeze({
  subscribe: () => () => {},
  getSnapshot: () => NO_METRICS,
});

/**
 * The store behind `useHubMetrics`. `getSnapshot` returns the hub's frozen
 * metrics object, which keeps its identity until a value changes (a status
 * change alone does not re-render). No hub = an empty, never-changing store.
 */
export function hubMetricsStore(hub: ProviderHub | undefined): IsoMetricsStore {
  if (!hub) return NO_HUB;
  return {
    // Both are arrow-function fields on ProviderHub: stable and already bound.
    subscribe: hub.subscribe,
    getSnapshot: () => hub.getSnapshot().metrics,
  };
}

/**
 * Live `metrics` for `ProcessEditor` / `IsoCanvas` from a hub. The result is
 * frozen; treat it as read-only. Server rendering uses the same snapshot.
 */
export function useHubMetrics(hub: ProviderHub | undefined): IsoMetrics {
  const store = useMemo(() => hubMetricsStore(hub), [hub]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * Point a hub at an iso document: its connections, then the bindings on its
 * placements. Call again with the new document after an edit; the hub diffs
 * both and only reopens what changed. Pass a document from `loadIsoDocument`
 * (or `toIsoDocument` of a parsed scene): the hub throws a `TypeError` on
 * malformed bindings.
 */
export function connectIsoDocument(
  hub: ProviderHub,
  document: Pick<HolodeckDocument<IsoSceneFile>, 'connections' | 'body'> & { engine?: string },
): void {
  if (document.engine !== undefined && document.engine !== ISO_ENGINE_ID) {
    throw new TypeError(`connectIsoDocument: document engine is "${document.engine}", not "${ISO_ENGINE_ID}"`);
  }
  hub.setConnections(document.connections ?? []);
  hub.setBindings(collectIsoBindings(document.body));
}
