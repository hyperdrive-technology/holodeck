/**
 * Playground state outside React: the tab search param, and loading (or
 * creating) the one persistent playground document.
 */

import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { DocumentExistsError, type DocumentStore, type VersionedDocument } from '../documents/store';
import { withRequires } from '../features/use-document-session';
import { createPlaygroundDocument, PLAYGROUND_DOCUMENT_ID } from './starter';

/** Tabs are the playground's primary navigation: `/playground?tab=viewer` is linkable and survives a reload. */
export const PLAYGROUND_TABS = ['edit', 'viewer'] as const;
export type PlaygroundTab = (typeof PLAYGROUND_TABS)[number];
export const DEFAULT_PLAYGROUND_TAB: PlaygroundTab = 'edit';

export interface PlaygroundSearch {
  tab: PlaygroundTab;
}

/**
 * The route's `validateSearch`: anything that is not a known tab (missing,
 * misspelt, an array from `?tab=a&tab=b`) opens the Edit tab rather than
 * failing the route.
 */
export function parsePlaygroundSearch(search: Record<string, unknown>): PlaygroundSearch {
  const tab = search.tab;
  return { tab: typeof tab === 'string' && (PLAYGROUND_TABS as readonly string[]).includes(tab) ? (tab as PlaygroundTab) : DEFAULT_PLAYGROUND_TAB };
}

/** The starter document with `requires` filled in for this host (what the store validates). */
export function playgroundStarter(host: HolodeckHost): HolodeckDocument<IsoSceneFile> {
  const doc = createPlaygroundDocument();
  withRequires(doc, host);
  return doc;
}

/**
 * The stored playground document, created from the starter on first use.
 * Another tab creating it at the same moment is not an error: the loser
 * reads the winner's copy.
 */
export async function ensurePlaygroundDocument(store: DocumentStore, host: HolodeckHost): Promise<VersionedDocument> {
  const existing = await store.get(PLAYGROUND_DOCUMENT_ID);
  if (existing) return existing;
  try {
    return await store.create(playgroundStarter(host));
  } catch (error) {
    if (!(error instanceof DocumentExistsError)) throw error;
    const winner = await store.get(PLAYGROUND_DOCUMENT_ID);
    if (!winner) throw error;
    return winner;
  }
}
