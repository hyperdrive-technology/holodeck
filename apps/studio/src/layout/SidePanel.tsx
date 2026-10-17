import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { PanelBounds } from './panel-width.logic';
import { PANEL_WIDTH_VAR, useResizableWidth } from './useResizableWidth';

/**
 * A resizable side column. `side="left"` puts the handle on its right edge.
 * Width comes from `--panel-width` (set live during a drag) falling back to
 * the committed width.
 */
export function SidePanel({
  side,
  storageKey,
  bounds,
  label,
  className,
  children,
  testId,
}: {
  side: 'left' | 'right';
  storageKey: string;
  bounds: PanelBounds;
  label: string;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const edge = side === 'left' ? 'right' : 'left';
  const { width, handleProps } = useResizableWidth(storageKey, bounds, edge);
  return (
    <aside
      aria-label={label}
      data-testid={testId}
      className={cn('relative flex h-full min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground', side === 'left' ? 'border-r' : 'border-l', className)}
      style={{ width: `var(${PANEL_WIDTH_VAR}, ${width}px)` }}
    >
      {children}
      <div
        {...handleProps}
        aria-label={`Resize ${label.toLowerCase()}`}
        className={cn(
          'absolute inset-y-0 z-10 w-1.5 cursor-col-resize outline-none transition-colors hover:bg-ring/40 focus-visible:bg-ring/60',
          edge === 'right' ? '-right-0.75' : '-left-0.75',
        )}
      />
    </aside>
  );
}
