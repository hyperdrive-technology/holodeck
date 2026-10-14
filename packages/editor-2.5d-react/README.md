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

## Engine contract

This package is the `holodeck.iso` engine of the Holodeck packaging contract
(`@holodeck/sdk`, `docs/PACKAGING.md`). Code: `src/engine/`, `src/holodeck-package.ts`.

**Descriptor.** `isoEngine` (`HolodeckEngine<IsoSceneFile>`): id `holodeck.iso`, API version
`1.0.0`, document format `holodeck.iso.scene.v1`, kinds `holodeck.iso.{part,theme,animator,inspector}`.
`validateBody` never throws; it checks structure (via `parseSceneFile`) and bindings, but not
whether parts are installed, because the host installs libraries after registering the engine.
For that check too, register `createIsoEngine({ registry: host.registry })` instead.

**Built-ins as a package.** `holodeck.package.json` (id `holodeck.iso`, version `1.0.0`) with
entry `dist/holodeck-package.mjs` (also `@holodeck/editor-2.5d-react/holodeck-package`, and
`isoPackage` / `ISO_PACKAGE_MANIFEST` from the main entry):

```ts
import { HolodeckHost } from '@holodeck/sdk';
import { ISO_PACKAGE_MANIFEST, isoEngine, isoPackage } from '@holodeck/editor-2.5d-react';

const host = new HolodeckHost({ name: 'my-app' });
host.registerEngine(isoEngine);
await host.installPackage(ISO_PACKAGE_MANIFEST, isoPackage);
```

`BUILTIN_ISO_EXTENSION` keeps its id `holodeck.iso.builtin` for hosts that install it into a
registry directly. Use one or the other in a registry: together they collide on part ids.

**Bindings.** A placement binds part params to provider signals; the provider owns `source`:

```json
{ "id": "t1", "object": "tank", "x": 0, "y": 0,
  "bindings": { "level": { "connection": "plant", "source": "sine:10",
                           "transform": { "kind": "scale", "inMin": 0, "inMax": 100, "outMin": 0, "outMax": 1 } } } }
```

`parseSceneFile` rejects malformed bindings; `isoEngine.collectBindings(scene)` lists them as
`{ objectId: placementId, param, binding }`.

**Documents.** `toIsoDocument(scene, { connections, requires, metadata })` wraps a scene in a
`holodeck.document.v1` envelope for saving. `loadIsoDocument(raw, registry?)` accepts an
envelope or a bare legacy `IsoSceneFile`, and returns `{ document, scene }`. It throws one
`IsoDocumentError` whose `problems` list every problem: envelope fields, engine and major
version, the body, and bindings to connections the document does not have. The envelope
`theme` wins over `body.theme`, and the envelope `id` is always the loaded `scene.id`
(`toIsoDocument(scene, { id })` writes it into the body too). `ProcessEditor` resets undo/redo
on `scene.id`, so two documents saved from one scene must never share it.

**Live values.** One `ProviderHub` per open document; its metrics are already the editor's
`metrics` shape (placement id → param → value):

```tsx
const { document, scene } = loadIsoDocument(json, host.registry);
// Create and dispose the hub in one effect: a disposed hub cannot be reused (StrictMode re-runs effects).
const [hub, setHub] = useState<ProviderHub>();
useEffect(() => {
  const next = host.createProviderHub();
  setHub(next);
  return () => void next.dispose();
}, [host]);
useEffect(() => {
  if (hub) connectIsoDocument(hub, document); // re-run after edits; the hub diffs and only reopens what changed
}, [hub, document]);

<ProcessEditor scene={scene} onChange={setScene} mode="run" registry={host.registry} metrics={useHubMetrics(hub)} />;
```

## Checks

```sh
pnpm type-check
pnpm exec vitest run
pnpm build
pnpm smoke                  # Node import of dist (ESM+CJS), GLB files, npm pack, holodeck-package entry install
pnpm check:vite-consumer    # Vite consumer URL check, see above
```
