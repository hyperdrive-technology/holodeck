/**
 * TanStack Query bindings for the document store. IndexedDB is the "server"
 * here: queries read it, mutations write it and refresh the affected keys.
 */

import type { HolodeckDocument } from '@holodeck/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStudio } from '../studio-context';
import type { StudioCamera } from './db';

export const documentKeys = {
  all: ['documents'] as const,
  list: () => [...documentKeys.all, 'list'] as const,
  detail: (id: string) => [...documentKeys.all, 'detail', id] as const,
  camera: (id: string) => [...documentKeys.all, 'camera', id] as const,
};

export function useDocumentList() {
  const { store } = useStudio();
  return useQuery({ queryKey: documentKeys.list(), queryFn: () => store.list() });
}

export function useDocument(id: string) {
  const { store } = useStudio();
  // `null` (not undefined) for a missing document: Query treats undefined as an error.
  // Always re-read on mount: a cached copy may predate another tab's save (or
  // this tab's own last write), and a workspace opened on it would conflict on
  // its first edit against a version the user never saw (holodeck#117).
  return useQuery({
    queryKey: documentKeys.detail(id),
    queryFn: async () => (await store.get(id)) ?? null,
    refetchOnMount: 'always',
  });
}

/** The camera stored for a document (`null`: none yet, the editor fits the scene). */
export function useDocumentCamera(id: string) {
  const { store } = useStudio();
  return useQuery({
    queryKey: documentKeys.camera(id),
    queryFn: async () => (await store.getCamera(id)) ?? null,
    refetchOnMount: 'always',
  });
}

export function useCreateDocument() {
  const { store } = useStudio();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (doc: HolodeckDocument) => store.create(doc),
    onSuccess: (saved) => {
      client.setQueryData(documentKeys.detail(saved.document.id), saved);
      void client.invalidateQueries({ queryKey: documentKeys.list() });
    },
  });
}

export function useDeleteDocument() {
  const { store } = useStudio();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => store.remove(id),
    onSuccess: (_void, id) => {
      client.removeQueries({ queryKey: documentKeys.detail(id) });
      client.removeQueries({ queryKey: documentKeys.camera(id) });
      void client.invalidateQueries({ queryKey: documentKeys.list() });
    },
  });
}

/** Persist the canvas camera of a document (called once per gesture by the editor). */
export function useSaveCamera() {
  const { store } = useStudio();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, camera }: { id: string; camera: StudioCamera }) => store.saveCamera(id, camera),
    onSuccess: (_saved, { id, camera }) => client.setQueryData(documentKeys.camera(id), camera),
  });
}
