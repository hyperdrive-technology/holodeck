import type { HolodeckDocument } from '@holodeck/sdk';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { withDocumentId, withDocumentName } from '../documents/document-ops';
import { newDocumentId } from '../documents/new-document';
import { useCreateDocument } from '../documents/queries';
import type { VersionedDocument } from '../documents/store';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The copy "Save mine as a copy" creates: a new id, the name marked so the two are told apart. */
export function conflictCopy(mine: HolodeckDocument, id: string = newDocumentId()): HolodeckDocument {
  return withDocumentName(withDocumentId(mine, id), `${mine.name} (my version)`);
}

/**
 * Shown when a save found a newer stored revision (another tab saved first)
 * or the document deleted. Modal and not dismissable: nothing more is saved
 * until the user keeps one version. Both stay recoverable: "load latest"
 * leaves this tab's edits only after an explicit choice, "save mine as a
 * copy" keeps them as a new document next to the other tab's version.
 */
export function ConflictDialog({
  name,
  latest,
  mine,
  onLoadLatest,
  onSavedCopy,
  onDiscard,
}: {
  name: string;
  latest: VersionedDocument | undefined;
  mine: HolodeckDocument;
  onLoadLatest: (latest: VersionedDocument) => void;
  onSavedCopy: (copyId: string) => void;
  /** Leave without keeping this tab's edits (document deleted elsewhere). */
  onDiscard: () => void;
}) {
  const { mutateAsync: createDocument } = useCreateDocument();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveCopy = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await createDocument(conflictCopy(mine));
      onSavedCopy(saved.document.id);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent
        data-testid="conflict-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>“{name}” changed somewhere else</DialogTitle>
          <DialogDescription>
            {latest
              ? `Another tab saved this document (revision ${latest.revision}) after this tab loaded it. Your latest change here was not saved. Keep one version:`
              : 'This document was deleted in another tab. Your latest change here was not saved.'}
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">Could not save a copy: {error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {latest ? (
            <Button variant="outline" disabled={busy} onClick={() => onLoadLatest(latest)}>
              Load latest (discard mine)
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={onDiscard}>
              Close (discard mine)
            </Button>
          )}
          <Button disabled={busy} onClick={() => void saveCopy()}>
            Save mine as a copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
