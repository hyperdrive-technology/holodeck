# Arcentry parity (M2) and the flow engine (M3)

**Goal (Des, 2026-10-14):** Holodeck Studio mirrors most of Arcentry. The base product is the
`holodeck.iso` engine (React Three Fiber 2.5D) + an Arcentry-style theme + cloud component assets, with AWS
as the first live-data provider. Other clouds follow as more packs. The second engine (M3) is
`holodeck.flow`: xyflow + generic function blocks (AND/OR …), working like Node-RED.

How the pieces are packaged and installed: [holodeck-sdk `docs/PACKAGING.md`](https://github.com/hyperdrive-technology/holodeck-sdk/blob/main/docs/PACKAGING.md).

Reference: the Arcentry app bundle and an HMI prototype video in `~/dev/hyperdrive/reference/arcentry/`
(webpack dev bundle with readable module names). Its object model is `component`, `line-group`, `label`,
`icon`, `area`, `image`, `widget` (`chart`, `scale-group`), plus `layer` meta objects. Edits are transactions
(`create` / `update` / `delete` / `set`). Its plugin system has one plugin, AWS CloudWatch monitoring.
Its component catalogue is ~340 components over 62 archetype models (server, database, cache, queue, load balancer …),
each with a brand logo and colours on top.

## Package map

| Package | Role | Milestone |
|---|---|---|
| `@holodeck/editor-2.5d-react` (`holodeck.iso`) | Engine + built-in primitives + default theme | M2 (adopt the engine contract) |
| `@holodeck/library-cloud` (`holodeck.cloud`) | 3D archetypes (Blender → GLB) + `arcentry-light` / `arcentry-dark` themes | M2 (new) |
| `@holodeck/assets-aws` (`holodeck.aws`) | AWS services as data-only parts: archetype + AWS icon + colours | M2 (new) |
| `@holodeck/provider-aws` (`holodeck.provider-aws`) | `aws.cloudwatch`: metrics, alarm states, history, resource discovery | M2 (new) |
| `@holodeck/provider-http` (`holodeck.http`) | Generic JSON over HTTP polling / SSE / WebSocket; the "Arcentry API" equivalent | M2 (new) |
| `apps/studio` | Holodeck Studio: documents, library, inspector, connections, export | M2 (new) |
| `@holodeck/editor-2d-react` (`holodeck.flow`) | Flow engine on xyflow | M3 |
| `@holodeck/library-logic` (`holodeck.logic`) | Generic blocks + `holodeck.flow.local` runtime provider | M3 (new) |

## Parity matrix

Status: ✓ done · ◐ partial · ✗ missing · — out of scope (SaaS account features). Lanes refer to
`~/dev/hyperdrive/.agents/plans/holodeck-arcentry-parity.md`.

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
| Component: archetype model + brand logo + colours | GLB parts (`GlbPart`), no logo plane, needs code per part | ◐ | E2, A1 |
| Generic customisable components (block, cube, flat, billboard) | — | ✗ | A1 |
| Line groups: polyline between objects or free anchors, colour, width, dash, arrow tips | pipes with A* manhattan routing (process-specific) | ◐ | E2 |
| Line labels, animated flow along lines | flow animators exist for pipes | ◐ | E2 |
| Areas: fill, outline, dash, shadow level, walled "VPN" area, label | `area` part (fill only) | ◐ | E2 |
| Labels: font size, bold/italic, align, outline, rotation, flat or upright | `label` part (text only) | ◐ | E2 |
| Icons (font icons on the floor, colour, size) | — | ✗ | E2 |
| Images on the floor or a billboard | — | ✗ | E2 |
| Metadata key/value shown under a component | `params` in inspector only | ✗ | E2 |
| Opacity, z-index | — | ✗ | E2 |

### Editing

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| Place from library, drag move, delete | `ProcessEditor` palette, drag, Delete | ✓ | — |
| Undo / redo | editor-state history (resets on document switch) | ✓ | — |
| Multi-select (shift-click, marquee), multi-edit capabilities | single selection | ✗ | E3 |
| Copy / paste / duplicate | — | ✗ | E3 |
| Align and distribute | — | ✗ | E3 |
| Rotate objects | `rotation` on placements | ◐ | E3 |
| Layers: show/hide, lock, assign | — | ✗ | E3 |
| Keyboard shortcuts + help overlay | shortcuts, no help | ◐ | E3 |
| Component library: categories, search | `Palette` by category, no search | ◐ | S1 |

### Live data

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| CloudWatch plugin: connect with a read-only IAM role, per-component metrics | — | ✗ | P1 |
| Map component type → CloudWatch namespace | — | ✗ | A2, P1 |
| Metrics plane on a component (current value) | — | ✗ | E2 (bindings → `format` label) |
| Chart widget (time series) | — | ✗ | E2 (chart part) + P1 (`history`) |
| Scale group: scale components by a metric | animators drive params; no generic scale | ◐ | E1 (`scale` transform) |
| Alarm colouring | animators + `threshold`/`map` transforms (SDK) | ◐ | E1 |
| API: external systems set object state | — | ✗ | P2 (`holodeck.http`) + S2 (embed API) |
| Demo data without credentials | `holodeck.sim` provider (SDK) | ✓ | — |

### Documents, export, sharing

| Arcentry | Holodeck today | Status | Lane |
|---|---|---|---|
| Documents and folders | one scene in props | ✗ | S1 (local: IndexedDB + file import/export) |
| Export PNG (tiled, high resolution) | — | ✗ | S2 |
| Export JSON | scene JSON | ◐ | S2 (document envelope) |
| CSV export of components | — | ✗ | S2 |
| Embed / live embed (read-only viewer with live data) | `mode: 'run'` | ◐ | S2 |
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
