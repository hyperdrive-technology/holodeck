/**
 * Route tree (TanStack Router, code-based: three routes do not need the
 * file-route generator).
 *
 *   /            Welcome (no document open)
 *   /d/$docId    DocumentRoute (canvas + inspector)
 */

import { createRootRoute, createRoute, createRouter, type RouterHistory } from '@tanstack/react-router';
import { AppShell } from './features/AppShell';
import { DocumentRoute } from './features/DocumentWorkspace';
import { Welcome } from './features/Welcome';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Welcome });

const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/d/$docId',
  component: function DocumentPage() {
    const { docId } = documentRoute.useParams();
    // key: a fresh route per document, so its queries re-read on mount
    // (refetchOnMount 'always'); without it a key change reuses the observer
    // and a cached copy is never re-read (holodeck#117).
    return <DocumentRoute key={docId} docId={docId} />;
  },
});

const routeTree = rootRoute.addChildren([indexRoute, documentRoute]);

export function createStudioRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: false });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createStudioRouter>;
  }
}
