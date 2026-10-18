import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { MAX_IMPORT_BYTES, parseDocumentText } from '../documents/io';
import { createIsoDocument, newDocumentId, nextUntitledName } from '../documents/new-document';
import { useCreateDocument, useDeleteDocument, useDocumentList } from '../documents/queries';
import { withDocumentId } from '../documents/document-ops';
import { notify } from '../layout/ui-state';
import { useStudio } from '../studio-context';
import { createSampleDocument } from '../samples/three-tier-web-app';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Document-level actions shared by buttons, menus, drag-and-drop and hotkeys. */
export function useStudioActions() {
  const { host, store } = useStudio();
  const navigate = useNavigate();
  const list = useDocumentList();
  // Stable callbacks only (the mutation result objects change every render).
  const { mutateAsync: createDocument } = useCreateDocument();
  const { mutateAsync: removeDocument } = useDeleteDocument();

  const openDocument = useCallback((id: string) => navigate({ to: '/d/$docId', params: { docId: id } }), [navigate]);

  const newDocument = useCallback(async () => {
    const name = nextUntitledName((list.data ?? []).map((d) => d.name));
    try {
      const saved = await createDocument(createIsoDocument(name));
      await openDocument(saved.document.id);
    } catch (error) {
      notify({ tone: 'error', title: 'Could not create a document', details: [messageOf(error)] });
    }
  }, [createDocument, list.data, openDocument]);

  const newFromSample = useCallback(async () => {
    try {
      const saved = await createDocument(createSampleDocument());
      await openDocument(saved.document.id);
    } catch (error) {
      notify({ tone: 'error', title: 'Could not create a document from the sample', details: [messageOf(error)] });
    }
  }, [createDocument, openDocument]);

  /** Import every file; opens the last one that succeeded. Returns how many were imported. */
  const importFiles = useCallback(
    async (files: Iterable<File>) => {
      let lastId: string | undefined;
      let imported = 0;
      for (const file of files) {
        if (file.size > MAX_IMPORT_BYTES) {
          notify({ tone: 'error', title: `Could not import ${file.name}`, details: ['the file is too large'] });
          continue;
        }
        const result = parseDocumentText(await file.text(), host);
        if (!result.ok) {
          notify({ tone: 'error', title: `Could not import ${file.name}`, details: result.problems });
          continue;
        }
        let doc = result.document;
        // Re-importing a file the studio already has must never overwrite it.
        const copy = await store.has(doc.id);
        if (copy) doc = withDocumentId(doc, newDocumentId());
        try {
          const saved = await createDocument(doc);
          lastId = saved.document.id;
          imported += 1;
          const notes = [result.wrapped ? 'converted from a bare scene file' : '', copy ? 'imported as a copy (that id already exists)' : ''];
          notify({ tone: 'info', title: `Imported ${file.name}`, details: notes.filter(Boolean) });
        } catch (error) {
          notify({ tone: 'error', title: `Could not import ${file.name}`, details: [messageOf(error)] });
        }
      }
      if (lastId) await openDocument(lastId);
      return imported;
    },
    [createDocument, host, openDocument, store],
  );

  const deleteDocument = useCallback(
    async (id: string, { navigateAway }: { navigateAway: boolean }) => {
      try {
        await removeDocument(id);
        if (navigateAway) await navigate({ to: '/' });
      } catch (error) {
        notify({ tone: 'error', title: 'Could not delete the document', details: [messageOf(error)] });
      }
    },
    [navigate, removeDocument],
  );

  return { newDocument, newFromSample, importFiles, deleteDocument, openDocument };
}
