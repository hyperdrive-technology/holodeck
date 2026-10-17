/**
 * TanStack Query bindings for the document store. IndexedDB is the "server"
 * here: queries read it, mutations write it and refresh the affected keys.
 */

import type { HolodeckDocument } from '@holodeck/sdk';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStudio } from '../studio-context';

export const documentKeys = {
  all: ['documents'] as const,
  list: () => [...documentKeys.all, 'list'] as const,
  detail: (id: string) => [...documentKeys.all, 'detail', id] as const,
};

export function useDocumentList() {
  const { store } = useStudio();
  return useQuery({ queryKey: documentKeys.list(), queryFn: () => store.list() });
}

export function useDocument(id: string) {
  const { store } = useStudio();
  // `null` (not undefined) for a missing document: Query treats undefined as an error.
  return useQuery({ queryKey: documentKeys.detail(id), queryFn: async () => (await store.get(id)) ?? null });
}

export function useCreateDocument() {
  const { store } = useStudio();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (doc: HolodeckDocument) => store.create(doc),
    onSuccess: (saved) => {
      client.setQueryData(documentKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: documentKeys.list() });
    },
  });
}

export function useSaveDocument() {
  const { store } = useStudio();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (doc: HolodeckDocument) => store.save(doc),
    onSuccess: (saved) => {
      client.setQueryData(documentKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: documentKeys.list() });
    },
  });
}

export function useRenameDocument() {
  const { store } = useStudio();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => store.rename(id, name),
    onSuccess: (saved) => {
      client.setQueryData(documentKeys.detail(saved.id), saved);
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
      void client.invalidateQueries({ queryKey: documentKeys.list() });
    },
  });
}
