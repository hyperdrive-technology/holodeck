import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveSecretStorage, SessionSecretStore } from './connections/secrets';
import { notify } from './layout/ui-state';
import { createDocumentChannel } from './documents/changes';
import { openStudioDb } from './documents/db';
import { DocumentStore } from './documents/store';
import { createStudioHost, hostDocumentProblems } from './host/studio-host';
import { createStudioRouter } from './router';
import { StudioProvider, type StudioServices } from './studio-context';
import './styles.css';

async function boot(): Promise<StudioServices> {
  const host = await createStudioHost();
  const channel = createDocumentChannel();
  const store = new DocumentStore(openStudioDb(), {
    validate: (doc) => hostDocumentProblems(host, doc),
    onChange: (change) => channel.post(change),
  });
  const secretStorage = resolveSecretStorage();
  if (secretStorage.kind === 'memory') {
    // Not fatal: secrets then last until this page reloads.
    queueMicrotask(() =>
      notify({
        tone: 'info',
        title: 'This browser blocks session storage',
        details: ['Connection secrets are kept in memory for this page only and must be entered again after a reload.'],
      }),
    );
  }
  return { host, store, channel, secrets: new SessionSecretStore(secretStorage.storage) };
}

const root = createRoot(document.getElementById('root')!);

boot().then(
  (services) => {
    // IndexedDB is local and fast: no refetch-on-focus churn, no retries masking real errors.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
    });
    const router = createStudioRouter();
    root.render(
      <StrictMode>
        <StudioProvider services={services}>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </StudioProvider>
      </StrictMode>,
    );
  },
  (error: unknown) => {
    console.error(error);
    root.render(
      <div role="alert" style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Holodeck Studio could not start</h1>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{error instanceof Error ? error.message : String(error)}</pre>
      </div>,
    );
  },
);
