/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';

const EDITOR = '@holodeck/editor-2.5d-react';

/**
 * Anti-framing headers (holodeck#152) for `vite dev` and `vite preview`
 * (what the e2e suite runs): every path except `/embed/*` may not be framed.
 * Production deployments must send the same headers (README, "Deploying");
 * FrameGuard in the app is only a backstop.
 */
export function frameHeaders(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (!path.startsWith('/embed/')) {
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      res.setHeader('X-Frame-Options', 'DENY');
    }
    next();
  };
  return {
    name: 'holodeck-studio-frame-headers',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), frameHeaders()],
  resolve: {
    alias: { '@': decodeURIComponent(new URL('./src', import.meta.url).pathname) },
    // The editor and the SDK are `file:` dependencies with their own
    // node_modules. One copy of each of these must exist at runtime: two Reacts
    // break hooks, two SDKs break `instanceof ContributionRegistry`, two threes
    // break R3F's object checks.
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', '@holodeck/sdk'],
  },
  optimizeDeps: {
    // The editor's GLB URLs are `new URL('./models/x.glb', import.meta.url)`;
    // Vite dev pre-bundling rewrites them to 404s unless the package is
    // excluded (holodeck#28, packages/editor-2.5d-react/tsup.config.ts). Its
    // bare imports are then not scanned, hence the explicit include list.
    exclude: [EDITOR],
    // `editor > dep`: R3F and drei are the editor's dependencies, not the
    // studio's, so with pnpm they only resolve from the editor package. A bare
    // '@react-three/fiber' failed to resolve, which aborted pre-bundling and
    // `vite dev` then served CJS shims raw ("use-sync-external-store ... does
    // not provide an export named 'default'"): found while adding
    // `pnpm playground` (the e2e suite runs the production build, so it never
    // saw this).
    //
    // Every three entry the editor imports is listed so ONE optimizer run
    // bundles them over a shared three.core chunk. Discovered later at runtime
    // (`three/webgpu`, `three/tsl`, addons), Vite optimised them in a second
    // run with their own copy of the core: "Multiple instances of Three.js",
    // lights "not found", and floor raycasts that never hit, so click / drag
    // placement silently did nothing in `vite dev` (found in a real browser;
    // the production build was fine). Keep in step with the editor's imports:
    //   grep -ohE "from ['\"]three[^'\"]*" packages/editor-2.5d-react/dist/*.mjs | sort -u
    include: [
      `${EDITOR} > @react-three/fiber`,
      `${EDITOR} > @react-three/drei`,
      'three',
      'three/webgpu',
      'three/tsl',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/lines/webgpu/LineSegments2.js',
      'three/addons/lines/LineSegmentsGeometry.js',
    ],
  },
  build: {
    // three.js + R3F + the editor are ~2 MB minified; one chunk is fine for a
    // local-first app. Revisit with route-level code splitting (S2).
    chunkSizeWarningLimit: 2600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
