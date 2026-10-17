# Holodeck Studio (`apps/studio`)

Standalone editor for Holodeck documents (`holodeck.document.v1`). Part of
holodeck#16 (lane S1, plan `.agents/plans/holodeck-arcentry-parity.md`). No
PLC or Hyperdrive code: the studio is a plain Holodeck host.

## What it does

- **Host**: one `HolodeckHost` (`src/host/studio-host.ts`); engines are
  registered and packages installed through their manifests, as any
  third-party host would. Today: the `holodeck.iso` engine and its built-in
  package from `@holodeck/editor-2.5d-react`.
- **Documents** in IndexedDB (`src/documents/db.ts`, `store.ts`): every write
  is validated (envelope via `@holodeck/sdk`, body and installed packages via
  the host). Per-document view state lives in a separate `views` store.
- **Import / export** of `.holodeck.json` files (`src/documents/io.ts`):
  envelopes for any installed engine, or a bare legacy `IsoSceneFile` (wrapped).
  Every problem is listed at once. Re-importing an existing id makes a copy.
  Files can also be dropped anywhere on the window.
- **Library** sidebar: placeable items of every installed package, grouped by
  package and category, with multi-term search.
- **Inspector**: document properties (name, packages used, timestamps) or the
  selected object (position, rotation, part params).
- **Layout**: T3 Code idioms: resizable, persisted side panels
  (`src/layout/`), TanStack Store for UI state, TanStack Hotkeys for
  shortcuts (`Mod+/` lists them).

## Develop

The studio consumes the **built** editor and SDK (`file:` dependencies are
copied at install time). After changing either, rebuild it and reinstall:

```sh
(cd ../../../holodeck-sdk/ts && pnpm build)
(cd ../../packages/editor-2.5d-react && pnpm build)
pnpm install
pnpm dev          # http://localhost:5173
```

## Test

```sh
pnpm type-check
pnpm exec vitest run     # unit: store (fake-indexeddb), import/export, library, layout
pnpm build && pnpm e2e   # Playwright over the production build (vite preview)
```

E2E browser: `HOLODECK_CHROMIUM=/path/to/chrome`, else a local Google Chrome on
macOS, else Playwright's Chromium. CI uses the runner's Google Chrome.
The e2e suite runs without WebGPU on purpose (see `e2e/studio.spec.ts`);
rendering is covered by the engine's render tests.

## Known gaps (follow-ups)

- The engine's `ProcessEditor` brings its own palette, inspector and toolbar,
  so they show next to the studio's; it also has no camera props, so camera
  persistence is stored (`DocumentStore.saveCamera`) but not wired to the
  canvas yet. Both need `ProcessEditor` props (lane E2).
- Connections panel and binding editor (provider config, secrets in session
  storage, source picker via `browse`).
