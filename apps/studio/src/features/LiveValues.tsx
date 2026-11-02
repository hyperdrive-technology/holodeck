import type { IsoMetrics } from '@holodeck/editor-2.5d-react';
import { cn } from '@/lib/utils';

/** One reading as text: numbers to at most 4 decimals, null as "No reading". */
export function formatLiveValue(value: unknown): string {
  if (value == null) return 'No reading';
  if (typeof value === 'number') return String(Number(value.toFixed(4)));
  return String(value);
}

/** Text equivalents for canvas readings, also available when WebGPU is unavailable.
 * Do not make this an aria-live region: providers may update several times a second.
 *
 * `visible`: shown as a values table (the playground's Viewer panel) instead
 * of screen-reader-only text; same markup and labels either way.
 */
export function LiveValues({ metrics, visible = false, className }: { metrics: IsoMetrics; visible?: boolean; className?: string }) {
  const rows = Object.entries(metrics).flatMap(([object, params]) => Object.entries(params).map(([param, value]) => ({ object, param, value })));
  return (
    <>
    <dl
      className={cn(visible ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs' : 'sr-only', className)}
      aria-label="Live values"
      data-testid={visible ? 'live-values' : undefined}
    >
      {rows.map(({ object, param, value }) => (
        <div key={`${object}.${param}`} className={visible ? 'contents' : undefined}>
          <dt className={visible ? 'truncate font-mono text-muted-foreground' : undefined} title={visible ? `${object}.${param}` : undefined}>
            {object}.{param}
          </dt>
          <dd className={visible ? 'text-right font-medium tabular-nums' : undefined}>
            <output aria-label={`${object}.${param}`} aria-live="off">
              {visible ? formatLiveValue(value) : value == null ? 'No reading' : String(value)}
            </output>
          </dd>
        </div>
      ))}
    </dl>
    {visible && rows.length === 0 ? <p className="text-xs text-muted-foreground">No live values yet: bind a parameter to a signal.</p> : null}
    </>
  );
}
