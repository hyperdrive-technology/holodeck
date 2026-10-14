# @holodeck/editor-2.5d-react

Orthographic 2.5D process editor and viewer (React + react-three-fiber).

## Using the built package in a Vite app

The package ships its equipment models as GLB files in `dist/models/` and
references them with `new URL('./models/x.glb', import.meta.url)`. Vite's
production build handles this. **Vite's dev server does not**, unless you
configure dependency pre-bundling:

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // Do not pre-bundle this package: esbuild rewrites the GLB URLs to
    // /node_modules/.vite/deps/models/<name>.glb, which 404s.
    exclude: ['@holodeck/editor-2.5d-react'],
    // Excluded packages are not scanned, so their CommonJS dependencies must
    // be listed or the browser fails on `import { ... } from '@react-three/...'`.
    include: ['@react-three/drei', '@react-three/fiber'],
  },
});
```

Notes:

- Symptom without `exclude`: model requests to `/node_modules/.vite/deps/models/*.glb` return 404 (or the SPA fallback HTML) and parts render as missing.
- Your app must import `react`/`react-dom` itself (any normal app does) so Vite pre-bundles them; see `scripts/vite-consumer-check.mjs` if you need the exact fixture.
- `vite build` needs no special configuration.
- Vite logs `THREE.WARNING: Multiple instances of Three.js being imported` in dev with this setup; it has not caused any observed problem.

This is enforced in CI: `pnpm check:vite-consumer` (after `pnpm build`) creates a throwaway Vite app that consumes a copy of the built package, in real Chromium, and fetches every URL in `BUILTIN_MODEL_URLS` in dev (documented config), `vite build` + `vite preview`, and (informationally) dev without the config. It needs a Playwright Chromium (`pnpm exec playwright install chromium`, or set `HOLODECK_CHROMIUM`). No GPU is required because nothing is rendered.

## Checks

```sh
pnpm type-check
pnpm exec vitest run
pnpm build
pnpm smoke                  # Node import of dist (ESM+CJS), GLB files, npm pack
pnpm check:vite-consumer    # Vite consumer URL check, see above
```
