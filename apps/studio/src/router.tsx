/**
 * Route tree (TanStack Router, code-based: a handful of routes do not need
 * the file-route generator).
 *
 *   (shell)          AppShell: header, sidebar, hotkeys (pathless layout)
 *     /              Welcome (no document open)
 *     /d/$docId      DocumentRoute (canvas + inspector)
 *   /embed/$docId    EmbedRoute: read-only live view for iframes, no studio chrome
 */

import { createRootRoute, createRoute, createRouter, Outlet, type RouterHistory } from '@tanstack/react-router';
import { EmbedRoute } from './embed/EmbedRoute';
import { AppShell } from './features/AppShell';
import { DocumentRoute } from './features/DocumentWorkspace';
import { FrameGuard } from './features/FrameGuard';
import { Welcome } from './features/Welcome';

const rootRoute = createRootRoute({ component: Outlet });

/** Everything with the studio chrome. Pathless: adds no URL segment. */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  // Never inside a frame (holodeck#152): only /embed/* is embeddable.
  component: function Shell() {
    return (
      <FrameGuard>
        <AppShell />
      </FrameGuard>
    );
  },
});

const indexRoute = createRoute({ getParentRoute: () => shellRoute, path: '/', component: Welcome });

const documentRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/d/$docId',
  component: function DocumentPage() {
    const { docId } = documentRoute.useParams();
    // key: a fresh route per document, so its queries re-read on mount
    // (refetchOnMount 'always'); without it a key change reuses the observer
    // and a cached copy is never re-read (holodeck#117).
    return <DocumentRoute key={docId} docId={docId} />;
  },
});

const embedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/embed/$docId',
  component: function EmbedPage() {
    const { docId } = embedRoute.useParams();
    return <EmbedRoute key={docId} docId={docId} />;
  },
});

const routeTree = rootRoute.addChildren([shellRoute.addChildren([indexRoute, documentRoute]), embedRoute]);

export function createStudioRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: false });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createStudioRouter>;
  }
}
