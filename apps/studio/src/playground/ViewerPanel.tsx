import type { ConnectionState, ProviderConnection } from '@holodeck/sdk';
import type { IsoMetrics } from '@holodeck/editor-2.5d-react';
import { PauseIcon, PlayIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '../features/connections/StatusBadge';
import { LiveValues } from '../features/LiveValues';

/** Connections whose provider reported an error (with its message), for the badge list and the canvas banner. */
export function connectionProblems(
  connections: readonly ProviderConnection[],
  statuses: Readonly<Record<string, ConnectionState>>,
): Array<{ id: string; label: string; message: string }> {
  return connections.flatMap((c) => {
    const status = statuses[c.id]?.status;
    if (status?.state !== 'error') return [];
    return [{ id: c.id, label: c.label ?? c.id, message: status.message ?? 'the provider reported an error' }];
  });
}

/**
 * The Viewer tab's side panel: one status badge per connection (with the
 * provider's message when it has one), pause / resume of the feed, and the
 * live values as a table (LiveValues, `visible`).
 */
export function ViewerPanel({
  connections,
  statuses,
  metrics,
  paused,
  onPausedChange,
}: {
  connections: readonly ProviderConnection[];
  statuses: Readonly<Record<string, ConnectionState>>;
  metrics: IsoMetrics;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="viewer-panel">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connections</h2>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          aria-pressed={paused}
          data-testid="viewer-pause"
          onClick={() => onPausedChange(!paused)}
          title={paused ? 'Resume: show incoming values again' : 'Pause: freeze the view on the current values (the providers keep running)'}
        >
          {paused ? <PlayIcon /> : <PauseIcon />} {paused ? 'Resume' : 'Pause'}
        </Button>
      </div>
      <ul className="flex flex-col gap-2 px-4" aria-label="Connection status">
        {connections.length === 0 ? (
          <li className="text-xs text-muted-foreground">No connections. Add one in the Edit tab (inspector, Connections).</li>
        ) : null}
        {connections.map((c) => {
          const state = statuses[c.id];
          const message = state?.status.state === 'error' || state?.status.state === 'stale' ? state.status.message : undefined;
          return (
            <li key={c.id} className="flex flex-col gap-0.5 text-sm" data-testid={`viewer-connection-${c.id}`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={`${c.id} (${c.provider})`}>
                  {c.label ?? c.id}
                </span>
                <StatusBadge state={state} testId={`viewer-status-${c.id}`} />
              </div>
              <span className="text-[11px] text-muted-foreground">{c.provider}</span>
              {message ? (
                <span className="text-[11px] text-destructive" data-testid={`viewer-message-${c.id}`}>
                  {message}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Separator className="my-4" />
      <h2 className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Live values{paused ? <span className="ml-2 normal-case text-amber-600">(paused)</span> : null}
      </h2>
      <div className="px-4 pb-4">
        <LiveValues metrics={metrics} visible />
      </div>
    </div>
  );
}
