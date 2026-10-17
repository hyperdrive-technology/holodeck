import { useSelector } from '@tanstack/react-store';
import { XIcon } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { dismissNotice, noticeStore, type Notice } from '../layout/ui-state';

/** Info notices fade after this; errors stay until dismissed (they carry details to read). */
export const INFO_NOTICE_MS = 4000;

export function Notices() {
  const notices = useSelector(noticeStore);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {notices.map((n) => (
        <NoticeCard key={n.id} notice={n} />
      ))}
    </div>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  useEffect(() => {
    if (notice.tone !== 'info') return;
    const timer = setTimeout(() => dismissNotice(notice.id), INFO_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div
      role={notice.tone === 'error' ? 'alert' : 'status'}
      data-testid="notice"
      className={cn('pointer-events-auto rounded-lg border bg-popover p-3 text-sm shadow-lg', notice.tone === 'error' && 'border-destructive/50')}
    >
      <div className="flex items-start gap-2">
        <p className={cn('flex-1 font-medium', notice.tone === 'error' && 'text-destructive')}>{notice.title}</p>
        <button type="button" aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => dismissNotice(notice.id)}>
          <XIcon className="size-4" />
        </button>
      </div>
      {notice.details?.length ? (
        <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5 text-xs text-muted-foreground">
          {notice.details.map((d, i) => (
            <li key={i} className="whitespace-pre-wrap break-words">
              {d}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
