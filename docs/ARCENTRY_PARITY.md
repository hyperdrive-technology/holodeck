# Arcentry parity (M2) and the flow engine (M3)

**Goal (Des, 2026-10-14):** Holodeck Studio mirrors most of Arcentry. The base product is the
`holodeck.iso` engine (React Three Fiber 2.5D) + an Arcentry-style theme + cloud component assets, with AWS
as the first live-data provider. Other clouds follow as more packs. The second engine (M3) is
`holodeck.flow`: xyflow + generic function blocks (AND/OR …), working like Node-RED.

How the pieces are packaged and installed: [holodeck-sdk `docs/PACKAGING.md`](https://github.com/hyperdrive-technology/holodeck-sdk/blob/main/docs/PACKAGING.md).

Target feature set (parity with what Arcentry offers its users): scene objects for components, connector
lines, labels, icons, areas, images and live widgets (charts, scales), organised in layers; edits as undoable
transactions (create / update / delete / set); a live-monitoring plugin for AWS CloudWatch; and a large
component catalogue (a few hundred cloud components built from a few dozen archetypes such as server, database,
cache, queue and load balancer), each with brand logos and colours.

## Package map

| Package | Role | Milestone |
|---|---|---|
| `@holodeck/editor-2.5d-react` (`holodeck.iso`) | Engine + built-in primitives + default theme | M2 (adopt the engine contract) |
| `@holodeck/library-cloud` (`holodeck.cloud`) | 3D archetypes (Blender → GLB) + `arcentry-light` / `arcentry-dark` themes | M2 (new) |
| `@holodeck/assets-aws` (`holodeck.aws`) | AWS services as data-only parts: archetype + AWS icon + colours | M2 (new) |
| `@holodeck/provider-aws` (`holodeck.provider-aws`) | `aws.cloudwatch`: metrics, alarm states, history, resource discovery | M2 (P1) |
| `@holodeck/provider-http` (`holodeck.http`) | Generic JSON over HTTP polling / SSE / WebSocket; the "Arcentry API" equivalent | M2 (P2) |
| `apps/studio` | Holodeck Studio: documents, library, inspector, connections, export | M2 (new) |
| `@holodeck/editor-2d-react` (`holodeck.flow`) | Flow engine on xyflow | M3 |
| `@holodeck/library-logic` (`holodeck.logic`) | Generic blocks + `holodeck.flow.local` runtime provider | M3 (new) |

## Parity matrix

Scene object reference: [`packages/editor-2.5d-react/docs/objects.md`](../packages/editor-2.5d-react/docs/objects.md).

Status: ✓ done · ◐ partial · ✗ missing · — out of scope (SaaS account features). Lane codes match the issues in the
[M2](https://github.com/hyperdrive-technology/holodeck/milestone/2) and [M3](https://github.com/hyperdrive-technology/holodeck/milestones) milestones.

### Canvas and camera

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| Isometric grid canvas, pan, zoom | `IsoCanvas`, `use-view-pan`, auto-fit | ✓ | — |
| Rotate view in 90° steps | `rotatePose` (Q/E) | ✓ | — |
| Top-down 2D view | `toggleTopDown` | ✓ | — |
| Camera persisted per document | not persisted | ✗ | S1 |
| Show whole diagram | `fit.ts` | ✓ | — |

### Objects

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| Component: archetype model + brand logo + colours | data-only parts (`model` + `logo` + `colors`, no code; `DataPart`), logo plane on the top face (`logo` empty contract) | ◐ | A1 (archetypes) |
| Generic customisable components (block, cube, flat, billboard) | `cloud:generic-block` / `-cube` / `-flat` / `billboard` in `@holodeck/library-cloud` (per-part `colors`, placement `color`); the billboard's logo stands on its front face (E2 honours the `logo` empty's rotation) | ✓ | — |
| Line groups: polyline between objects or free anchors, colour, width, dash, arrow tips | `connector` part: object / port / free anchors, waypoints, A* routing, colour, width, dash, tips | ✓ | — |
| Line labels, animated flow along lines | connector `label` caption and `flow` dots | ✓ | — |
| Areas: fill, outline, dash, shadow level, walled "VPN" area, label | `area` params: fill, outline, outline style, shadow 0..3, walled (label: a `label` part) | ✓ | — |
| Labels: font size, bold/italic, align, outline, rotation, flat or upright | `label` params: bold, italic, align, outline, orient (+ `size`, `rotation`) | ✓ | — |
| Icons (font icons on the floor, colour, size) | `icon` part: built-in set or any glyph, colour, size, flat / upright | ✓ | — |
| Images on the floor or a billboard | `image` part: floor / billboard | ✓ | — |
| Metadata key/value shown under a component | `meta` metadata plane on any placement (editing UI: S1) | ✓ | — |
| Opacity, z-index | `opacity`, `z` on any placement | ✓ | — |

### Editing

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| Place from library, drag move, delete | `ProcessEditor` palette, drag, Delete | ✓ | — |
| Undo / redo | editor-state history (resets on document switch) | ✓ | — |
| Multi-select (shift-click, marquee), multi-edit capabilities | shift-click, Shift+drag marquee, select all; multi drag / delete / nudge; inspector edits shared params, opacity, layer, z-order on the whole selection | ✓ | — |
| Copy / paste / duplicate | Mod+C / X / V / D; system clipboard JSON (cross-tab / document), ids, groups and anchors remapped, cascading offset | ✓ | — |
| Align and distribute | 6 align edges + distribute x / y on grid axes; groups move as one unit | ✓ | — |
| Rotate objects | `[` / `]` and inspector; a multi-selection turns about its centre | ✓ | — |
| Layers: show/hide, lock, assign | `scene.layers` + `placement.layer`; Layers tab: show / hide, lock, rename, active layer, move selection, remove | ✓ | — |
| Groups | `placement.group`; Mod+G / Mod+Shift+G; click selects the group | ✓ | — |
| Draw / re-anchor connectors | connector tool (C): click part / port / cell twice; drag end handles to re-anchor or free; deleting a part detaches its connector ends | ◐ (waypoint editing: follow-up) | — |
| Keyboard shortcuts + help overlay | one table (`editor/shortcuts.ts`) drives keys and the `?` overlay | ✓ | — |
| Component library: categories, search | `Palette` by category, no search | ◐ | S1 |

### Live data

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| CloudWatch plugin: connect with a read-only IAM role, per-component metrics | `aws.cloudwatch` provider (`@holodeck/provider-aws`): batched GetMetricData polled at each source's period, alarm states, browse, discover; static / temporary keys, assumed read-only role, Cognito identity pool or host credentials via secrets | ✓ | — |
| Map component type → CloudWatch namespace | `discover` suggests a `partHint` and a default metric binding per resource kind (`DEFAULT_PART_HINTS`; ids are `@holodeck/assets-aws` parts, `aws:<slug>`; hosts may override via `partHints`) | ◐ | A2 |
| Metrics plane on a component (current value) | — | ✗ | E2 (bindings → `format` label) |
| Chart widget (time series) | provider `history` (CloudWatch metric series, alarm state changes) | ◐ | E2 follow-up (chart part) |
| Scale group: scale components by a metric | animators drive params; no generic scale | ◐ | E1 (`scale` transform) |
| Alarm colouring | animators + `threshold`/`map` transforms (SDK) | ◐ | E1 |
| API: external systems set object state | `holodeck.http` provider (`@holodeck/provider-http`): poll / SSE / WebSocket JSON, pointer or JSONPath-lite sources, HTTP writes; embed `postMessage` `setObjectState` (studio `/embed/:doc`, origin allow-list, validated messages) | ✓ | S2 |
| Demo data without credentials | `holodeck.sim` provider (SDK) | ✓ | — |

### Documents, export, sharing

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| Documents and folders | one scene in props | ✗ | S1 (local: IndexedDB + file import/export) |
| Export PNG (tiled, high resolution) | `ProcessEditorHandle.exportImage({ scale })`: tiled, render-signal gated; Studio Export dialog 1x / 2x / 4x | ✓ | S2 |
| Export JSON | `holodeck.document.v1` envelope (Studio Export dialog, `.holodeck.json`) | ✓ | S2 |
| CSV export of components | `isoComponentsCsv`: one row per placement, `meta:<key>` columns, formula-injection safe; Studio Export dialog | ✓ | S2 |
| Embed / live embed (read-only viewer with live data) | Studio `/embed/:doc`: run mode, no chrome, provider hub + `postMessage` API (`setObjectState`, `clearObjectState`, `loadDocument`, `getInfo`) | ✓ | S2 |
| Three-tier sample and production e2e | Studio **New from sample** / import: `samples/three-tier-web-app.holodeck.json`, cloud archetypes + Arcentry light, VPC/subnets, labelled arrows, sim threshold/format/scale bindings; `e2e/sample.spec.ts` covers live data, JSON/CSV and read-only embed; `sample.webgpu.spec.ts` covers PNG + deterministic screenshot (0.2 threshold / 1% tolerance; first reference capture still required on a browser-capable runner, see Studio README) | ◐ (sample and tests implemented; visual reference capture pending) | S3 (#43) |
| Collaboration, access control, accounts, billing, notifications | — | — | — |

## M3 — flow engine (Node-RED-style)

| Node-RED / FBD feature | Holodeck today | Status | Lane |
|---|---|---|---|
| Canvas, nodes, wires, palette, pan/zoom | `HolodeckEditor2D` on xyflow, `HolodeckPalette` | ◐ | F2 |
| Data-driven block definitions (ports, params, evaluate) | `holodeck.flow.block` kind name reserved in SDK | ✗ | F1 |
| Logic blocks: AND, OR, NOT, XOR, compare, math, select, SR/RS, R_TRIG/F_TRIG, TON/TOF/TP | — | ✗ | F3 |
| Inject (constant/interval), debug sidebar | — | ✗ | F3, F2 |
| Signal in/out blocks bound to any provider | provider contract (SDK) | ◐ | F1 |
| Deploy + run in the browser, live values on wires | `deploy` capability (SDK) | ◐ | F1 |
| Flows as documents (tabs), import/export JSON | — | ✗ | F2, S1 |
| Message-passing (`msg`) semantics | — | later | — |

## Acceptance

**M2 done when:** Studio opens, saves and reopens `holodeck.iso` documents locally. From the library you can
place AWS components (logo on archetype) and draw connectors with arrows, plus areas, labels, icons and images.
Multi-select, copy/paste, align and layers work. A `aws.cloudwatch` connection (or `holodeck.sim` / `holodeck.http`) drives colours, labels,
scale and a chart widget. Export to PNG and JSON works, plus a read-only live embed. Every package installs through
`HolodeckHost` from its manifest, and an e2e test builds the "three-tier web app on AWS" sample against
the sim provider.

**M3 done when:** a `holodeck.flow` document built from `holodeck.logic` blocks deploys to
`holodeck.flow.local`, shows live wire values, and an iso document binds to its outputs.
