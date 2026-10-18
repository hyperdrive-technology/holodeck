import type { ConnectionState } from '@holodeck/sdk';
import { cn } from '@/lib/utils';

const TONE: Record<string, string> = {
  live: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  connecting: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  stale: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  disconnected: 'bg-muted text-muted-foreground',
  error: 'bg-destructive/15 text-destructive',
};

/** Connection status from the hub; `idle` when the hub has not opened it (yet). */
export function StatusBadge({ state, testId }: { state: ConnectionState | undefined; testId?: string }) {
  const s = state?.status.state ?? 'idle';
  return (
    <span
      data-testid={testId}
      data-state={s}
      title={state?.status.message ?? s}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', TONE[s] ?? 'bg-muted text-muted-foreground')}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {s}
    </span>
  );
}
