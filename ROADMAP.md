# Holodeck roadmap

Holodeck owns browser scene tooling and live visual overlays. [Hyperdrive core](https://github.com/hyperdrive-technology/core) owns PLC compilation and execution; the [Holodeck SDK](https://github.com/hyperdrive-technology/holodeck-sdk) owns shared scene and extension contracts. See [README.md](README.md#project-status) for the status snapshot and [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks.

## M1 — Brewery on WASM

The current milestone is [M1 — Brewery on WASM](https://github.com/hyperdrive-technology/holodeck/milestone/1), shared with [core](https://github.com/hyperdrive-technology/core/milestone/1) and [holodeck-sdk](https://github.com/hyperdrive-technology/holodeck-sdk/milestone/1). The brewery demo currently uses a TypeScript interpreter. M1 runs it in the browser on the real Rust runtime compiled to WASM, with Holodeck imported as built packages.

Holodeck's immediate work is to fix built-package imports and ship usable GLB assets ([#7](https://github.com/hyperdrive-technology/holodeck/issues/7)), alongside scene validation, document-switch state, and rerouting fixes ([#8](https://github.com/hyperdrive-technology/holodeck/issues/8), [#9](https://github.com/hyperdrive-technology/holodeck/issues/9), [#10](https://github.com/hyperdrive-technology/holodeck/issues/10)). Core tracks package integration in [#34](https://github.com/hyperdrive-technology/core/issues/34). The demo path must not execute through an interpreter, mock, shim, or fallback.

The 2.5D process editor already has equipment models, routing, animation, and editing. The 2D editor and 3D viewer have implementations and tests; they are no longer empty rendering placeholders. Package build success does not yet prove host import and asset delivery work.

## M2 — Holodeck Studio: Arcentry parity on AWS

[M2](https://github.com/hyperdrive-technology/holodeck/milestone/2) makes Holodeck a standalone web builder that mirrors most of Arcentry. The base product is the `holodeck.iso` engine (React Three Fiber 2.5D) with an Arcentry-style theme, cloud archetype models carrying AWS icons, and live data from the `aws.cloudwatch` provider. Other clouds follow as more asset packs. Every piece ships as a package under the [SDK packaging contract](https://github.com/hyperdrive-technology/holodeck-sdk/blob/main/docs/PACKAGING.md). The feature-by-feature parity matrix and acceptance criteria are in [docs/ARCENTRY_PARITY.md](docs/ARCENTRY_PARITY.md).

## M3 — Flow engine: Node-RED-style logic

[M3](https://github.com/hyperdrive-technology/holodeck/milestone/3) adds the second engine, `holodeck.flow`: an xyflow editor with generic function blocks (AND, OR, NOT, XOR, compare, timers, latches). A flow is deployed to and run by a provider, either the in-browser `holodeck.flow.local` or a host product's runtime. Iso documents can bind to flow outputs like any other signal.

## Later tooling and extensions

The CLI remains incomplete: `generate` is partial, other command implementations are missing, and its build entry and dependency setup need restoration. Importer discovery, development preview, scene validation, and scene inspection remain future tooling work.

Importers and providers live in separate repositories and target `@holodeck/sdk`. Longer-term plans include Terraform import, Hyperdrive runtime data, telemetry adapters, extension templates, and commercial renderers and asset tiers under `@holodeck-pro/*`. Open packages do not depend on commercial packages. Native services belong in core and use Rust; browser packages use TypeScript.

## Tracking

Use [GitHub issues](https://github.com/hyperdrive-technology/holodeck/issues) and milestone pages for current priorities. The older [TODO.md](TODO.md) checklist predates the current milestones and contains superseded status and setup notes; use [CONTRIBUTING.md](CONTRIBUTING.md) for commands. Cross-repository runtime work is tracked in [core's backlog](https://github.com/hyperdrive-technology/core/blob/feat/brewery-extensions/.agents/TODO.md).
