/**
 * Generic, domain-neutral palette: grouped by category, searchable, items are
 * HTML5 drag sources carrying the item id.
 */
import type { ScenePaletteItem } from '@holodeck/sdk';
import { useMemo, useState } from 'react';

export const PALETTE_DRAG_MIME = 'application/holodeck-palette-item';
export const UNCATEGORIZED = 'Other';

export function paletteCategory(item: ScenePaletteItem): string {
  const fromMeta = item.defaults?.metadata?.category;
  return item.category ?? (typeof fromMeta === 'string' && fromMeta ? fromMeta : UNCATEGORIZED);
}

export function filterPaletteItems(items: readonly ScenePaletteItem[], query: string): ScenePaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((i) =>
    [i.label, i.id, i.description ?? '', paletteCategory(i)].some((s) => s.toLowerCase().includes(q)),
  );
}

/** Groups sorted by name, with the uncategorized group last; item order preserved. */
export function groupPaletteItems(items: readonly ScenePaletteItem[]): Array<[string, ScenePaletteItem[]]> {
  const groups = new Map<string, ScenePaletteItem[]>();
  for (const item of items) {
    const cat = paletteCategory(item);
    const list = groups.get(cat);
    if (list) list.push(item);
    else groups.set(cat, [item]);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });
}

export interface HolodeckPaletteProps {
  items: readonly ScenePaletteItem[];
  /** Click-to-add alternative to dragging. */
  onItemActivate?: (item: ScenePaletteItem) => void;
  className?: string;
}

export function HolodeckPalette({ items, onItemActivate, className }: HolodeckPaletteProps) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupPaletteItems(filterPaletteItems(items, query)), [items, query]);

  return (
    <aside className={['holodeck-palette', className].filter(Boolean).join(' ')} data-testid="holodeck-palette">
      <input
        type="search"
        className="holodeck-palette-search"
        placeholder="Search palette"
        aria-label="Search palette"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.length === 0 ? <div className="holodeck-palette-empty">No matching items</div> : null}
      {groups.map(([category, group]) => (
        <section key={category} className="holodeck-palette-group" aria-label={category}>
          <h4 className="holodeck-palette-heading">{category}</h4>
          {group.map((item) => (
            <div
              key={item.id}
              className="holodeck-palette-item"
              data-testid={`palette-item-${item.id}`}
              draggable
              title={item.description}
              onDragStart={(e) => {
                e.dataTransfer.setData(PALETTE_DRAG_MIME, item.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onItemActivate?.(item)}
            >
              {item.label}
            </div>
          ))}
        </section>
      ))}
    </aside>
  );
}
