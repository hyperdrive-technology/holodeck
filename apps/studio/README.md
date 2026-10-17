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
- **Concurrency**: every stored document has a `revision`. Each write is one
  IndexedDB readwrite transaction that checks the revision the caller's copy
  was based on and commits `revision + 1`, or fails with a conflict; renames
  are applied to the stored document inside that transaction. An open
  document writes through one `DocumentWriter` (`src/documents/writer.ts`),
  which serialises this tab's writes. A conflict (another tab saved first)
  opens a dialog: load the latest, or save yours as a copy. Idle tabs pick up
  other tabs' saves via a BroadcastChannel. `Mod+S` re-saves and reports the
  real outcome.
- **Import / export** of `.holodeck.json` files (`src/documents/io.ts`):
  envelopes for any installed engine, or a bare legacy `IsoSceneFile` (wrapped).
  Every problem is listed at once. Re-importing an existing id makes a copy.
  Files can also be dropped anywhere on the window.
- **Library** sidebar: placeable items of every installed package, grouped by
  package and category, with multi-term search. Click an item to arm the
  canvas place tool (then click the floor); "+" adds it next to the scene.
- **Inspector**: document properties (name, packages used, timestamps) or the
  selected object (position, rotation, part params).
- **Canvas**: the engine's `ProcessEditor` with `chrome="canvas"`. Library and
  inspector edits run as editor actions (`editorRef.dispatch`), so they share
  the canvas undo history. The camera is stored per document.
- **Export** (holodeck#42, header "Export" / `Mod+Shift+E`): the document as
  `.holodeck.json`, its components as `.components.csv` (one row per object,
  `meta:<key>` columns, spreadsheet-formula-safe cells), and the current view
  as a PNG at 1x / 2x / 4x (the engine's tiled `exportImage`; needs WebGPU).
- **Embed** (`/embed/<docId>`, `src/embed/`): a read-only live view for
  iframes: run mode, no studio chrome, provider hub for live data, never
  writes. The Export dialog builds the URL and an `<iframe>` snippet.
- **Layout**: T3 Code idioms: resizable, persisted side panels
  (`src/layout/`), TanStack Store for UI state, TanStack Hotkeys for
  shortcuts (`Mod+/` lists them).

## Embed API (`postMessage`)

```js
// Parent page on https://app.example; iframe src:
//   https://studio.example/embed/<docId>?parentOrigin=https://app.example
const studio = 'https://studio.example';
frame.contentWindow.postMessage(
  { protocol: 'holodeck.embed.v1', type: 'setObjectState', requestId: 'r1', objectId: 'tank-1', state: { level: 0.42 } },
  studio,
);
addEventListener('message', (e) => {
  if (e.origin !== studio) return;
  // { protocol, type: 'ready', documentId } | { type: 'result', requestId, ok, error? } | { type: 'info', ... }
});
```

| inbound `type` | fields | effect |
|---|---|---|
| `setObjectState` | `objectId`, `state: { param: number \| string \| boolean \| null }` | live values for one placement, over provider data |
| `clearObjectState` | `objectId?` | drop overrides for one placement, or all |
| `loadDocument` | `document` | show a `holodeck.document.v1` envelope (or bare scene); validated like an import, never stored |
| `getInfo` | | reply `info` with the document id, name and objects |

Rules (`src/embed/`):

- **Who may talk to it.** A message is handled only if it comes from the
  direct parent frame (`event.source === parent`) on an *allowed* origin: the
  studio's own, the build-time `VITE_HOLODECK_EMBED_ORIGINS` list, or a
  `parentOrigin` URL parameter that is an exact http(s) origin (inside that
  list when it is set).
- **Who may see stored documents** (holodeck#151). Only a *trusted* frame
  chain: every ancestor (`location.ancestorOrigins`; Firefox: a single-level
  frame's referrer) is the studio's own origin or in
  `VITE_HOLODECK_EMBED_ORIGINS`. A URL grant is never trust: the embedding
  page writes the URL itself, and a same-site sibling (another subdomain or
  port) shares the studio's storage. For any other parent the store is never
  read: the embed waits for `loadDocument`, and `ready` / `getInfo` report no
  stored document.
- Every message is validated against a strict schema (plain objects only, no
  unknown fields, bounded sizes, no `__proto__` / `constructor` keys) and
  refused with a `result { ok: false, error }` when it carries a `requestId`.
  Replies go to the verified sender origin; `ready` goes to each allowed
  origin with that exact `targetOrigin`; nothing is posted with `'*'`.

## Deploying

The studio is a static SPA. Whatever serves it must send, on every path
**except** `/embed/*` (holodeck#152):

```
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

`vite dev` / `vite preview` do this (`frameHeaders()` in vite.config.ts) and
the e2e suite checks it; CSP `frame-ancestors` cannot be set from a `<meta>`
tag. `/embed/*` may send `frame-ancestors` with the embedding origins you
allow. As a backstop the studio routes refuse to render inside a frame
(`src/features/FrameGuard.tsx`). Set `VITE_HOLODECK_EMBED_ORIGINS` at build
time to the origins that may embed stored documents.

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
The `chromium` project runs without WebGPU on purpose (see `e2e/studio.spec.ts`);
rendering is covered by the engine's render tests. The `webgpu` project runs
only `*.webgpu.spec.ts` (PNG export) with headless-WebGPU flags (SwiftShader on
Linux CI). The embed spec serves its cross-origin parent page from a local
server on 127.0.0.1 (Chrome's Local Network Access blocks route-fulfilled
"public" pages from framing localhost).

## Known gaps (follow-ups)

- Connections panel and binding editor (provider config, secrets in session
  storage, source picker via `browse`): holodeck#101.
- Adopting another tab's version still remounts the canvas to reset undo
  history (no history-reset action on `ProcessEditor` yet); camera and
  selection are carried over, an in-progress drag is dropped.
