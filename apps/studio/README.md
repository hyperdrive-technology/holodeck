# Holodeck Studio (`apps/studio`)

Standalone editor for Holodeck documents (`holodeck.document.v1`). Part of
holodeck#16 (lane S1, plan `.agents/plans/holodeck-arcentry-parity.md`). No
PLC or Hyperdrive code: the studio is a plain Holodeck host.

## What it does

- **Host**: one `HolodeckHost` (`src/host/studio-host.ts`); engines are
  registered and packages installed through their manifests, as any
  third-party host would. Today: the `holodeck.iso` engine and its built-in
  package from `@holodeck/editor-2.5d-react`, plus `@holodeck/library-cloud`
  (all 26 cloud archetypes and both Arcentry themes). Cloud assets resolve
  through Vite URL imports (`src/host/cloud-package.ts`) in dev and production.
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
- **New from sample** (header or welcome screen, holodeck#43): creates an
  independent, editable **Three-tier web app** document with live simulated
  traffic. The sample can also be imported from
  [`samples/three-tier-web-app.holodeck.json`](samples/three-tier-web-app.holodeck.json).
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
- **Connections and live data** (holodeck#101, `src/connections/`,
  `src/features/connections/`): the inspector's Connections tab adds, edits
  and removes the document's provider connections (`holodeck.sim`,
  `holodeck.http`, `aws.cloudwatch`, installed as packages in
  `src/host/provider-packages.ts`). Settings come from each provider's
  `configSchema` (form + Ajv validation, `config-form.ts`). Each object
  parameter can be bound to a signal (source typed or picked with the
  provider's `browse`, optional scale / threshold / map / format transform,
  validated by the SDK); binding edits are canvas edits (undoable). A
  `ProviderHub` per open document streams live values into the canvas and
  the inspector, with a status badge per connection.
- **Secrets** (API tokens, passwords, AWS keys) live in this tab's
  `sessionStorage` only (`connections/secrets.ts`): never in IndexedDB, a
  document, an export or an embed, and never shown again once entered (the UI
  only says whether one is set). Another tab, or the same document after the
  tab closes, asks for them again; the browser's Duplicate tab copies them.
  Each secret is bound to the endpoint it was entered for
  (`connections/fingerprint.ts`: HTTP origin + auth scheme, AWS region + role /
  pool, the whole config for other providers): point the connection elsewhere,
  or import another document under the same id, and it is not sent. The
  binding is per provider session (`connections/session-secrets.ts`): a
  session only ever receives secrets for the endpoint it was opened with. If
  the browser blocks sessionStorage, secrets are kept in memory for the page
  (with a notice) instead of failing to start.
- **Undo and connections**: removing a connection is an envelope edit, outside
  the canvas undo history. If an undo brings back bindings to a connection
  removed in this session, the connection is restored (with a notice) so the
  document stays valid; a binding to an unknown connection is flagged
  "missing" in the inspector and can always be removed.
- **No credentials in documents** (`connections/credentials.ts`): connection
  configs pass the provider's own validation (`parseHttpConfig`,
  `parseAwsConfig`: no Authorization / Cookie headers, no `user:pass@` URLs,
  no AWS key names) and a generic deep scan for credential-looking keys and
  values, in the connection dialog, on every save and on import / embed load.
  Connection labels and binding sources (which can carry an endpoint query)
  are scanned too.
- **Layout**: T3 Code idioms: resizable, persisted side panels
  (`src/layout/`), TanStack Store for UI state, TanStack Hotkeys for
  shortcuts (`Mod+/` lists them).

## Three-tier web app sample (S3)

The sample uses `holodeck.document.v1`, `holodeck.iso` and `arcentry-light`:
users → CDN → load balancer → two web servers → two app servers → database
and cache. The app tier enqueues async work for a function, which persists
results. Fourteen labelled connectors have arrow tips; dashed lines denote
async work. Public and private subnet areas sit inside a walled VPC area.

One secret-free `holodeck.sim` connection (`demo`) drives:

| Target | Signal / transform | Behaviour |
|---|---|---|
| Web and app accents | `ramp:8:0:100` / `threshold` | green below 60%, amber at 60%, red at 85% |
| Request-rate label text | `ramp:6:100:700` / `format` | `Requests {value} req/s`, zero decimals |
| CPU fraction label value | `ramp:8:0:100` / `scale` | normalises 0–100 to 0–1 |

Studio and embeds also expose named text equivalents of live readings for
assistive technology (`Live values`; no automatic announcements). Rendering
and PNG export need WebGPU; creating, importing, saving, live text readings
and JSON / CSV export work without it. The sample uses vendor-neutral cloud
archetypes and needs no AWS account or credentials.

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

### Live data in embeds

An embed connects the document's connections without any secrets: secret-free
connections (`holodeck.sim`, a public `holodeck.http` endpoint, AWS through a
Cognito identity pool) go live; a connection whose provider needs a secret
(bearer token, AWS access keys) stays in `error`, because the embedding page
has no way to hand credentials to the frame yet. Until a credentials channel
exists (follow-up: holodeck#162), the host should expose such data
through a secret-free endpoint or push values with `setObjectState`. The
embed root reports connection states as `data-connections="id:state,..."`.

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

Firefox has no `location.ancestorOrigins`, so there the embed trusts
`document.referrer` (single-level framing only). That is the origin of the page
that *initiated* the iframe navigation, so it equals the parent only while no
studio page navigates a named or attacker-chosen frame. **Rule: no studio page
may use `window.open(url, name)`, a `target=` link or form fed by untrusted
input, or an open redirect** (documented beside `storedDocumentsVisible` in
`src/embed/origins.ts`; drop the fallback once Firefox ships ancestorOrigins).
A configured partner that sends `Referrer-Policy: no-referrer` therefore gets no
stored documents on Firefox (fail closed; the embed says why): it must send the
document with `loadDocument` or use `strict-origin-when-cross-origin`.

## Develop

The studio consumes the **built** editor and SDK (`file:` dependencies are
copied at install time). After changing either, rebuild it and reinstall:

```sh
(cd ../../../holodeck-sdk/ts && pnpm build)
(cd ../../packages/editor-2.5d-react && pnpm build)
(cd ../../packages/library-cloud && pnpm install --frozen-lockfile && pnpm build)
(cd ../../packages/provider-http && pnpm install --frozen-lockfile && pnpm build)
(cd ../../packages/provider-aws && pnpm install --frozen-lockfile && pnpm build)
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
only `*.webgpu.spec.ts` (PNG export and sample baseline) with headless-WebGPU flags (SwiftShader on
Linux CI). The embed spec serves its cross-origin parent page from a local
server on 127.0.0.1 (Chrome's Local Network Access blocks route-fulfilled
"public" pages from framing localhost).

### Sample e2e and visual baseline

> The sample baseline runs at a 1080×520 viewport with a 1× export so the hosted
> runner's SwiftShader can finish it (2× at 1280×800 timed out, holodeck#175).

`e2e/sample.spec.ts` uses the existing `withoutWebGPU` helper and checks sample
creation/import, placements and connector anchors in downloaded JSON, changing
formatted text, threshold colours, scaled readings, JSON/CSV downloads,
persistence and read-only live embed behaviour. `e2e/sample.webgpu.spec.ts`
checks the sample's 1× PNG download and image-compares that exported PNG
to a Playwright PNG snapshot (`toMatchSnapshot`). It uses the same local WebGPU skip / required-on-CI rule as
`export-png.webgpu.spec.ts`.

The baseline fixes `Date.now` at `2026-01-01T00:00:02Z` (CPU 25%, traffic
300 req/s), keeps normal timers/frames running, waits for the engine's
`data-render-state="ready"` signal, and compares the engine's own 1× export
(an offscreen render of the canvas at the WebGPU project's 1280×800 viewport).
A browser screenshot is not used: on the Linux CI runner SwiftShader cannot
produce compositor screenshots of this scene in time, while the export path
renders fine. There is no animated
connector flow. Comparison allows a per-pixel threshold of 0.2 and at most
1% different pixels for text/edge antialiasing. No pre-existing Studio
snapshot mechanism was present; this uses Playwright's `toMatchSnapshot` on
the exported PNG bytes.

Run from `apps/studio`, after building the dependencies above:

```sh
pnpm build
pnpm exec playwright test sample.spec.ts --project=chromium
pnpm exec playwright test sample.webgpu.spec.ts --project=webgpu
# First capture, or an intentional visual change; inspect the PNG before accepting it:
pnpm exec playwright test sample.webgpu.spec.ts --project=webgpu --update-snapshots
```

Playwright stores the reference under
`e2e/sample.webgpu.spec.ts-snapshots/three-tier-web-app-1x-webgpu-<platform>.png`.
Capture/review on the same platform and adapter as the comparison run (Linux
CI uses SwiftShader); include each required platform's PNG in the change.
A missing reference fails the comparison and writes an initial candidate;
it never silently passes. Browser-restricted environments can type-check and
list the tests but cannot capture or approve a reference. The first reference
capture remains required on a browser-capable runner.

## Known gaps (follow-ups)

- Adopting another tab's version still remounts the canvas to reset undo
  history (no history-reset action on `ProcessEditor` yet); camera and
  selection are carried over, an in-progress drag is dropped.
