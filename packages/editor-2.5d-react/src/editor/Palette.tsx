import { useMemo, useState } from 'react';
import type { ContributionRegistry } from '@holodeck/sdk';
import { useIsoParts } from '../registry/react';
import type { IsoPartDefinition } from '../registry/types';
import { FIELD_BG, FONT, MUTED, SIDEBAR_TEXT } from './editor-styles';

const UNCATEGORISED = 'Other';

/** Registry parts for the palette, grouped by `category` in first-seen order. */
export function paletteGroups(
  parts: readonly IsoPartDefinition[],
  query: string,
): Array<{ category: string; items: IsoPartDefinition[] }> {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, IsoPartDefinition[]>();
  for (const part of parts) {
    if (part.hideInPalette) continue;
    if (q && !part.label.toLowerCase().includes(q)) continue;
    const category = part.category ?? UNCATEGORISED;
    const group = groups.get(category);
    if (group) group.push(part);
    else groups.set(category, [part]);
  }
  return Array.from(groups, ([category, items]) => ({ category, items }));
}

export function Palette({
  registry,
  placing,
  drawing,
  onPick,
}: {
  registry: ContributionRegistry;
  placing: string | null;
  drawing: boolean;
  onPick: (partId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const parts = useIsoParts(registry);
  const groups = useMemo(() => paletteGroups(parts, query), [parts, query]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: '14px 14px 8px', fontSize: 16, fontWeight: 600 }}>Process library</div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="search components..."
        style={{
          margin: '0 14px 12px',
          padding: '8px 10px',
          border: '0',
          borderRadius: 4,
          background: FIELD_BG,
          color: SIDEBAR_TEXT,
          font: FONT,
        }}
      />
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0, padding: '0 8px 12px' }}>
        {groups.map(({ category, items }) => (
          <section key={category} aria-label={category}>
            <div style={{ color: MUTED, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, padding: '8px 8px 4px' }}>
              {category}
            </div>
            {items.map((item) => {
              const active = item.draw === 'run' ? drawing : placing === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  draggable
                  onDragStart={() => onPick(item.id)}
                  onClick={() => onPick(item.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 8px',
                    marginBottom: 4,
                    border: 0,
                    borderRadius: 4,
                    background: active ? FIELD_BG : 'transparent',
                    color: SIDEBAR_TEXT,
                    cursor: 'grab',
                    font: FONT,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.label}</div>
                  {item.hint ? <div style={{ color: MUTED, fontSize: 12 }}>{item.hint}</div> : null}
                </button>
              );
            })}
          </section>
        ))}
        {groups.length === 0 ? <div style={{ color: MUTED, padding: 8 }}>no matching parts</div> : null}
      </div>
    </div>
  );
}
