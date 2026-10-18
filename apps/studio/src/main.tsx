import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionSecretStore } from './connections/secrets';
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
  return { host, store, channel, secrets: new SessionSecretStore() };
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
