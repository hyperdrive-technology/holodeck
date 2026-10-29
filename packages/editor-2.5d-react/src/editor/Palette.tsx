import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

/** Pointer travel (px) that turns a press on a palette item into a drag. */
export const PALETTE_DRAG_THRESHOLD = 4;

/**
 * Drag a part from the palette onto the canvas (drag-and-drop building).
 * Pointer events, not HTML5 drag and drop: during a native drag the browser
 * stops sending pointer moves to the canvas, so the editor's own ghost (grid
 * snap, port snap) could not follow the pointer. Past the threshold the part
 * is armed (`onDragStart`, the same as a click); on release `onDrop` gets
 * the element under the pointer (null when cancelled): the editor decides
 * whether that is ITS canvas (another canvas on the page is not, #221). A press that never moves stays a
 * click (arm the tool for click-to-place).
 */
function usePaletteDrag(onDragStart?: (partId: string) => void, onDrop?: (partId: string, target: Element | null) => void) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return (event: ReactPointerEvent<HTMLElement>, partId: string) => {
    if (event.button !== 0 || !onDragStart || !onDrop) return;
    cleanup.current?.();
    // Touch / pen capture the pointer to the pressed element implicitly; release
    // it so moves reach the canvas under the finger.
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY };
    let active = false;
    const move = (e: PointerEvent) => {
      if (active || Math.hypot(e.clientX - start.x, e.clientY - start.y) < PALETTE_DRAG_THRESHOLD) return;
      active = true;
      onDragStart(partId);
    };
    const up = (e: PointerEvent) => {
      cleanup.current?.();
      if (!active) return;
      onDrop(partId, document.elementFromPoint(e.clientX, e.clientY));
    };
    const cancel = () => {
      cleanup.current?.();
      if (active) onDrop(partId, null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      cleanup.current = null;
    };
  };
}

export function Palette({
  registry,
  placing,
  drawing,
  onPick,
  onDragStart,
  onDrop,
}: {
  registry: ContributionRegistry;
  placing: string | null;
  drawing: boolean;
  onPick: (partId: string) => void;
  /** Drag-and-drop from the palette (see `usePaletteDrag`); omit both to keep click-to-place only. */
  onDragStart?: (partId: string) => void;
  onDrop?: (partId: string, target: Element | null) => void;
}) {
  const [query, setQuery] = useState('');
  const startDrag = usePaletteDrag(onDragStart, onDrop);
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
                  data-part={item.id}
                  onPointerDown={(event) => startDrag(event, item.id)}
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
