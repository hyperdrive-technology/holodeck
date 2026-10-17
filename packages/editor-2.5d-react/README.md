# @holodeck/editor-2.5d-react

Orthographic 2.5D process editor and viewer (React Three Fiber + WebGPU) for live,
animated process scenes in the Arcentry look. Parts come from a contribution registry
(built-ins plus Blender-built GLBs in `assets/models/`); the look comes from one style
layer (`assets/process/style.ts`).

```tsx
import { ProcessEditor } from '@holodeck/editor-2.5d-react';

<ProcessEditor scene={scene} onChange={setScene} mode="edit" onRendered={(rev) => {}} />;
```

Give the editor a box with a definite size; it fills it, never grows past it, and fits
the scene to it on load.

## Editing (lane E3)

Multi-select (click, Shift+click, Shift+drag marquee, Mod+A), copy / cut / paste / duplicate
(also through the system clipboard as `holodeck.iso.clipboard.v1` JSON), align and distribute
on grid axes, rotate (`[` / `]`, a multi-selection turns about its centre), nudge (arrows),
groups (`placement.group`, Mod+G), z-order (Mod+`[` / `]`), layers (`scene.layers` +
`placement.layer`: show / hide, lock, active layer for new parts) and a connector tool (C:
click a part, port or cell, then another; drag a selected connector's end handles to
re-anchor; "+" midpoint handles add waypoints, double-click removes one). Every edit is one undo step. Press `?` for the shortcut list (`editor/shortcuts.ts`).

### Host props (Studio, holodeck#100)

```tsx
<ProcessEditor
  scene={doc.body}
  onChange={save}
  mode="edit"
  chrome="canvas"                      // or { palette: false, inspector: false, ... }
  camera={storedCamera}                // { zoom, target, yaw?, topDown? }: opens there, no fit
  onCameraChange={saveCamera}          // user zoom / pan / rotate / fit, debounced
  placing={armedPartId}                // arm the place tool from a host library
  onPlacingChange={setArmedPartId}
  onPlaced={(placement) => {}}
  selectedIds={ids}                    // multi-selection (selectedId stays the primary)
  onSelectionChange={setIds}
  editorRef={handle}                   // handle.current.dispatch({ type: 'align', edge: 'min-x' })
/>;
```

`stampPlacement(registry, partId, x, y, { objects })` returns exactly what the palette would
place, for hosts that add parts themselves.

### Export (holodeck#42)

```ts
// High-resolution PNG of the current view: canvas size x scale, drawn in 1024 px tiles.
const { blob, width, height, tiles } = await editorRef.current.exportImage({ scale: 4, signal });
// Components table: one row per placement (+ meta:<key> columns), formula-safe CSV.
const csv = isoComponentsCsv(doc.body, host.registry);
```

`exportImage` waits for the rendered signal (below) before drawing, hides selection and tool
overlays, scales screen-space line widths with the picture, and runs one export at a time. Each
tile is the same orthographic camera narrowed with `setViewOffset`, rendered into an off-screen
output render target (same colour conversion as the canvas) and read back; the screen is never
resized. Limits: scale <= 8, 16384 px per side, 100 MP (`planExportTiles` throws
`ExportSizeError`). `toCsv` / `csvCell` prefix text cells that start with `=`, `+`, `-`, `@`, tab
or CR with `'` (spreadsheet formula injection); numbers are never prefixed.
`src/export/export-render.test.ts` checks the export against the on-screen canvas, tiled vs one
tile, byte determinism, and hidden overlays.

## Rendered signal

`ProcessEditor` (on `[data-testid="process-editor"]`) and `IsoCanvas` (on its container)
expose:

| attribute | meaning |
|---|---|
| `data-holodeck-revision` | current revision; increases on any change to the picture |
| `data-holodeck-rendered` | last revision a presented frame showed |
| `data-render-state` | `ready` when the two match, else `pending`; `unsupported` without WebGPU |

A revision counts as rendered only when every GLB part has loaded, no camera animation is
running, the editor has fitted the scene, and two settled frames have passed. Tests and
screenshot loops wait on `data-render-state="ready"`, never on a timeout
(`src/test-support/render-harness.ts` has `waitForRendered`). `onRendered(revision)` fires
at the same moment.

## Tests

```bash
pnpm type-check
pnpm exec vitest run      # unit + *-render browser tests (WebGPU Chromium; CI runs them too)
pnpm build && pnpm smoke
```

Browser tests write review output to `artifacts/` (gitignored): review shots to
`artifacts/render/`, the fidelity run to `artifacts/visual/`. CI uploads that folder as the
`render-artifacts` artifact. `tests/snapshots/` holds committed comparison inputs only
(`src/visual/artifacts-layout.test.ts` enforces it).

**Browser.** `src/test-support/chromium.ts` picks it (the render tests and
`pnpm visual:reference` share it): `HOLODECK_CHROMIUM`, else Playwright's pinned build for
the `playwright` devDependency, else system Google Chrome. Install the pinned build with
`pnpm exec playwright install chromium`. If that hangs while unpacking (seen with Node 26 on
CI and on macOS), download the zip it prints and unpack it into
`~/Library/Caches/ms-playwright/chromium-<revision>/` yourself, then create an empty
`INSTALLATION_COMPLETE` file there. In CI (`CI` set and not `0`/`false`) render tests never
skip quietly. A missing or wrong `HOLODECK_CHROMIUM` fails the guard test in
`render-harness.test.ts`. Opt out only with `HOLODECK_SKIP_RENDER_TESTS=1`.

## Arcentry fidelity loop (agents)

`src/iso/scene-render.test.ts` renders `tests/scene.json` with a fixed setup (760x540
viewport, DPR 1, `REFERENCE_ZOOM` and the frozen look-at, frozen metrics), waits for the
rendered signal, and measures the render against the Arcentry target
`tests/snapshots/reference-canvas.png` (the process pane of `reference.jpg`; regenerate
it with `pnpm visual:reference` only if `reference.jpg` changes). Five consecutive runs
on macOS produced byte-identical renders, so every score change is a real change. The gate
only judges on a pinned browser (`HOLODECK_CHROMIUM` or Playwright's build, see **Browser**
above). On an auto-updating system Chrome it writes the images and then fails, asking for
the pinned build. The darwin record is from Playwright 1.59.1's chromium-1217 (Chrome for
Testing 147).

**Score.** `fidelity` = share of the relevant pixels that match. A pixel is relevant when
it is drawn in either image or different. Drawn means darker than the floor grid's `#EEE`
and away from that image's own background colour. A pixel matches when pixelmatch
(threshold 0.1, anti-aliasing ignored) calls it equal and it is not *uncovered*. Uncovered
means drawn in one image while the other shows its background there. Background-aware
scoring (holodeck#70) means a blank or uniformly tinted render scores 0. Before, `#e5e5e5`
scored 0.305, because pixelmatch calls it equal to both white floor and Arcentry's pale
shading. Arcentry's toolbar, baked into the reference, is ignored. `rmse` (0..255) is
reported too: it moves on shading changes too small to cross the pixelmatch threshold.
Current records: darwin **fidelity 0.16487, rmse 25.34**; linux (CI, SwiftShader)
**fidelity 0.1654, rmse 24.867**. Under the pre-#70 metric these were 0.283 / 0.28371.

**Gate.** `tests/visual/reference-fidelity.json` holds the best score per platform. A run
fails when fidelity drops more than `epsilon` (0.0005) below it. The record only goes up:
`pnpm visual:record` raises it when a run beats it by more than `epsilon` and never lowers it. Lowering it (a
deliberate trade-off) is a hand edit of the JSON with the reason in the PR.

**Loop.**

1. `pnpm visual` (about 5 s).
2. Read `artifacts/visual/reference-metrics.json`: `verdict`, `metrics.fidelity`,
   `metrics.rmse`, `darkerPixels` (extra ink: lines too thick, shading too dark) vs
   `lighterPixels` (missing ink), and `metrics.worstCells` (the 4x3 grid cells with the
   most difference, with pixel rectangles).
3. Look at the images in `artifacts/visual/`: `reference-heatmap.png` (colour distance,
   blue to yellow to red), `reference-diff.png` (red = missing ink, blue = extra ink),
   `reference-overlay.png` (50/50 blend, shows misalignment), and `reference-render.png`
   next to `tests/snapshots/reference.jpg`.
4. Change one thing: a style token in `assets/process/style.ts`, a part's geometry or
   Blender script, lights in `IsoCanvas.tsx`. Use `pnpm tuner` for interactive tank
   tuning against the reference.
5. Re-run. Keep the change if `fidelity` rises (or holds while `rmse` falls); otherwise
   revert it. A misaligned overlay means a placement or camera problem, not a style one:
   fix that first, because it swamps everything else.
6. When `verdict` is `improved`, run `pnpm visual:record` and commit the JSON with the
   change. The PR states the before/after score and attaches the heatmap.

Set `HOLODECK_ARTIFACTS_DIR` to keep runs apart (e.g. one directory per iteration).
Scores are per platform because GPU paths and font rasterisation differ. Locally, a
platform with no record reports `unrecorded` and passes. **In CI (`CI` set) a missing
record fails** (`missing`): otherwise the ratchet could never fail there.

**The linux record comes from CI.** CI renders on the runner's preinstalled Google Chrome
with SwiftShader (software Vulkan). To set or raise it: download the `render-artifacts`
artifact of the `editor-2.5d-react` job (`gh run download <run> -n render-artifacts`),
copy `metrics.fidelity` and `metrics.rmse` from `visual/reference-metrics.json` into the
`linux` entry, and say which run it came from in `source`. (Running `pnpm visual:record`
on a Linux box with SwiftShader works too.) Epsilon is the default 0.0005: two attempts
of CI run 38702345405, on Chrome 154 and 155, gave byte-identical renders, so SwiftShader
showed no run-to-run jitter. If a runner Chrome update moves the score, the job fails as
`regressed` or reports `improved`: check the heatmap, then re-record by hand with the
reason in the PR.

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

## Scene objects

Beyond process parts the engine has the Arcentry-style objects: data-only components (GLB or block +
brand logo + colours, no React code), connectors (anchored to objects, ports or free points; routed
with the pipe router; colour, width, dash, arrow tips, caption, animated flow), styled areas and
labels, icons, images, a metadata plane, and per-placement opacity / z-order. Reference and JSON
examples: [`docs/objects.md`](docs/objects.md). JSON Schema of the scene body:
[`schema/holodeck-iso-scene.v1.schema.json`](schema/holodeck-iso-scene.v1.schema.json).

## Checks

```sh
pnpm type-check
pnpm exec vitest run
pnpm build
pnpm smoke                  # Node import of dist (ESM+CJS), GLB files, npm pack, holodeck-package entry install
pnpm check:vite-consumer    # Vite consumer URL check, see above
```
