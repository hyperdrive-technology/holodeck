/**
 * The library sidebar's model: placeable items of every installed package,
 * searchable and grouped by package, then category.
 *
 * Only `holodeck.iso.part` today (the one engine the studio hosts). A flow
 * engine would add its block kind to `LIBRARY_KINDS` with an adapter to
 * `LibraryItem`.
 */

import { HOLODECK_KINDS, type HolodeckHost } from '@holodeck/sdk';
import type { IsoPartDefinition } from '@holodeck/editor-2.5d-react';

export interface LibraryItem {
  kind: string;
  id: string;
  label: string;
  hint?: string;
  category: string;
  /** Owning package id (`registry.ownerOf`); `unknown` for contributions installed outside a package. */
  packageId: string;
  packageName: string;
}

export interface LibraryGroup {
  packageId: string;
  packageName: string;
  categories: Array<{ category: string; items: LibraryItem[] }>;
}

export const UNCATEGORISED = 'Other';
const UNKNOWN_PACKAGE = 'unknown';

/** Every placeable item, in registry order. Parts with `hideInPalette` are left out. */
export function libraryItems(host: HolodeckHost): LibraryItem[] {
  const parts = host.registry.list<IsoPartDefinition>(HOLODECK_KINDS.isoPart);
  return parts
    .filter((part) => !part.hideInPalette)
    .map((part) => {
      const packageId = host.registry.ownerOf(HOLODECK_KINDS.isoPart, part.id) ?? UNKNOWN_PACKAGE;
      const item: LibraryItem = {
        kind: HOLODECK_KINDS.isoPart,
        id: part.id,
        label: part.label,
        category: part.category ?? UNCATEGORISED,
        packageId,
        packageName: host.package(packageId)?.manifest.name ?? packageId,
      };
      if (part.hint !== undefined) item.hint = part.hint;
      return item;
    });
}

/**
 * Case-insensitive search: every whitespace-separated term must appear in the
 * label, id, category, hint or package name. An empty query matches all.
 */
export function matchesQuery(item: LibraryItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [item.label, item.id, item.category, item.hint ?? '', item.packageName].join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Matching items grouped by package then category, both in first-seen order. */
export function groupLibrary(items: readonly LibraryItem[], query = ''): LibraryGroup[] {
  const groups = new Map<string, { packageName: string; categories: Map<string, LibraryItem[]> }>();
  for (const item of items) {
    if (!matchesQuery(item, query)) continue;
    let group = groups.get(item.packageId);
    if (!group) {
      group = { packageName: item.packageName, categories: new Map() };
      groups.set(item.packageId, group);
    }
    const list = group.categories.get(item.category);
    if (list) list.push(item);
    else group.categories.set(item.category, [item]);
  }
  return Array.from(groups, ([packageId, { packageName, categories }]) => ({
    packageId,
    packageName,
    categories: Array.from(categories, ([category, list]) => ({ category, items: list })),
  }));
}
