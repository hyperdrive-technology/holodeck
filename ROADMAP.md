# Holodeck Roadmap

Phased plan for the Holodeck HMI and visualization stack. Hyperdrive master plan (package roles, licensing): [../PLAN.md](../PLAN.md) § Holodeck HMI And Visualization. Active tasks: [TODO.md](./TODO.md).

**Policy:** Rust for native services, browser TypeScript for HMI packages — see [LANGUAGE_POLICY.md](../LANGUAGE_POLICY.md). No Go gateways or importers.

## Role

Holodeck consumes Hyperdrive runtime data for 2D/3D HMI and infrastructure visualization. It does **not** run PLC scan logic. Hyperdrive owns control, compile, deploy, and the host API; Holodeck owns scene tooling and live overlays.

## Repositories

| Repo | Status | Role |
|------|--------|------|
| [`holodeck-sdk/`](../holodeck-sdk/) | **Mostly done** — TS + JSON Schema | `@holodeck/sdk` contracts |
| [`holodeck/`](./) (this monorepo) | **Partial** — scaffolds exist | `@holodeck/cli`, `@holodeck/editor-2d-react`, `@holodeck/viewer-3d-react` |
| [`holodeck-importer-brainboard/`](../holodeck-importer-brainboard/) | **Complete** | Brainboard SVG → `SceneFile` |
| [`core/gateway/`](../core/gateway/) | **Planned** | Rust metrics fan-out (not a separate `holodeck-gateway` service) |
| `holodeck-pro` (private) | **Planned** | Commercial renderer, assets, licence SDK, gated plugins |
| External OSS (future) | **Planned** | `@holodeck/importer-tf`, `@holodeck/provider-otel`, `@holodeck/provider-hyperdrive` |

Open-source packages depend only on `@holodeck/sdk`. Commercial packages use `@holodeck-pro/*` and ship from the private registry.

## Phases

| Phase | Focus | Status |
|-------|--------|--------|
| **0 — Scaffolding** | Monorepo layout, package stubs | **Partial** — structure in place |
| **1 — SDK** | `SceneFile`, `Importer`, `Provider`, JSON Schema, semver publish | **Mostly done** — publish `@holodeck/sdk` v0.1.0 pending |
| **2 — CLI** | `generate`, `dev`, `validate`, `info`; importer auto-discovery | **Blocked** — `generate` partial; dev/validate/info missing |
| **3 — Importers** | Brainboard; Terraform (TS or Rust CLI) | **Partial** — Brainboard done; TF pending |
| **4 — Viewers** | 2D editor (React Flow), 3D viewer (R3F) | **Partial** — placeholders; rendering not wired |
| **5 — Providers & gateway** | OTLP/Prometheus, Hyperdrive WS bridge, `core/gateway` `/query` fan-out | **Not started** |
| **6 — Pro tier** | 3D editor, Draco assets, licence JWT | **Not started** (private repo) |
| **7 — Hyperdrive embed** | `<HolodeckEditor>` in engineering UI with runtime provider | **Not started** |
| **8–9 — Docs & release** | Contributor guides, templates, v1 npm publish | **Not started** |

## Package matrix

**Core contracts**

- `@holodeck/sdk` — scene types, plugin interfaces, JSON Schema ([`holodeck-sdk/schema/scenefile.schema.json`](../holodeck-sdk/schema/scenefile.schema.json))

**CLI & tooling**

- `@holodeck/cli` — `holodeck generate`, `dev`, `validate`, `info`; discovers `node_modules/@holodeck/importer-*`

**Rendering**

- `@holodeck/editor-2d-react` — editable 2D diagram (evolved from original viewer scaffold)
- `@holodeck/viewer-3d-react` — read-only 3D scene with live-data coloring
- `@holodeck-pro/viewer-3d-react`, `@holodeck-pro/editor-3d-react` — commercial (licence-gated)

**Importers**

- `@holodeck-pro/importer-brainboard` — **done** ([`holodeck-importer-brainboard`](../holodeck-importer-brainboard/))
- `@holodeck/importer-tf` — Terraform state → `SceneFile` (external TS or Rust CLI + thin npm wrapper)

**Providers**

- `@holodeck/provider-hyperdrive` — WebSocket/HTTP bridge to runtime variables, alarms, scan timing, diagnostics
- `@holodeck/provider-otel` — OTLP/Prometheus (Rust adapter in `core/gateway`)
- `@holodeck-pro/provider-datadog` — commercial Datadog metrics API

**Templates**

- `@holodeck/create-importer`, `@holodeck/create-provider` — starter scaffolds for plugin authors

**Naming:** `@holodeck/<role>-<id>-<lang>` (OSS) · `@holodeck-pro/<role>-<id>-<lang>` (commercial)

## Hyperdrive integration

- `@holodeck/provider-hyperdrive` subscribes to the host HTTP/WebSocket surface (port **4444**): live variables, diagnostics, scan timing, protocol status.
- Tracked in [PLAN.md § Product depth backlog](../PLAN.md) and [core/.agents/TODO.md § Product depth backlog](../core/.agents/TODO.md) (CODESYS 2025 alignment — WS HMI + **alarms** when historian events land).
- Scene nodes map to runtime tag names or configured aliases; overlays show health, alarms, and timing — not control logic.
- Cantina and the browser IDE may embed Holodeck views later; scan execution stays in `core/runtime`.

## Licensing

| Package / repo | Licence |
|----------------|---------|
| `holodeck`, `holodeck-sdk`, OSS importers/providers | MIT |
| `holodeck-importer-brainboard` | MIT (may also ship as `@holodeck-pro/*`) |
| `holodeck-pro`, Datadog provider, pro renderers/assets | Commercial EULA |

Community plugins target the MIT `@holodeck/sdk` contract only.

## Non-goals

- Holodeck does not replace the Hyperdrive compiler, runtime, or historian.
- No safety-PLC or certified HMI claims in the OSS milestone.
- No vendor-native PLC project parsers in Holodeck repos (those stay Hyperdrive cloud importers per master plan).

## Next priorities

1. Publish `@holodeck/sdk` v0.1.0 with stable semver and CI.
2. Finish `@holodeck/cli` commands and importer discovery (unblocks Brainboard E2E).
3. Implement real scene rendering in `@holodeck/editor-2d-react`.
4. Spike `@holodeck/provider-hyperdrive` against runtime `/ws` and variable snapshot APIs.

See [TODO.md](./TODO.md) for file-level checklists.
