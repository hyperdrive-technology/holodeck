import { Link } from '@tanstack/react-router';
import { FileIcon, PlusIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDocumentList } from '../documents/queries';
import { openImportPicker } from './file-io';
import { useStudioActions } from './use-studio-actions';

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function DocumentList() {
  const { data, isPending, error } = useDocumentList();
  const { newDocument } = useStudioActions();
  return (
    <section aria-labelledby="documents-heading" className="flex max-h-[45%] min-h-28 shrink-0 flex-col border-b">
      <header className="flex items-center gap-1 px-3 pb-1 pt-3">
        <h2 id="documents-heading" className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documents
        </h2>
        <Button variant="ghost" size="icon-sm" aria-label="Import document" title="Import document" onClick={openImportPicker}>
          <UploadIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="New document" title="New document" onClick={() => void newDocument()}>
          <PlusIcon />
        </Button>
      </header>
      <nav aria-label="Documents" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {isPending ? <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p> : null}
        {error ? <p className="px-2 py-1 text-xs text-destructive">Could not read documents: {error.message}</p> : null}
        {data?.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">No documents yet.</p> : null}
        <ul className="flex flex-col gap-0.5" data-testid="document-list">
          {data?.map((doc) => (
            <li key={doc.id}>
              <Link
                to="/d/$docId"
                params={{ docId: doc.id }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium"
                title={`Updated ${timeFormat.format(doc.updatedAt)}`}
              >
                <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.name || 'Untitled'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
