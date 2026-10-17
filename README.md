# Holodeck

[![CI](https://github.com/hyperdrive-technology/holodeck/actions/workflows/ci.yml/badge.svg)](https://github.com/hyperdrive-technology/holodeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Holodeck provides browser editors and a viewer for live, animated process scenes. Its TypeScript and React packages handle scene editing, pipe routing, equipment models, and visual overlays for Hyperdrive's HMI/SCADA. The [Holodeck SDK](https://github.com/hyperdrive-technology/holodeck-sdk) defines scene and extension contracts; [Hyperdrive core](https://github.com/hyperdrive-technology/core) owns the PLC compiler and Rust runtime (currently private).

## Project status

As of 2026-10-14, the current milestone is [M1 — Brewery on WASM](https://github.com/hyperdrive-technology/holodeck/milestone/1). The 2.5D process editor supports equipment scenes, animation, pipe routing, and interactive editing. The 2D editor and 3D viewer also have implementations and tests. Hyperdrive's brewery demo currently runs on a TypeScript interpreter; M1 replaces that execution path with the real Rust runtime compiled to WASM and consumes Holodeck as built packages.

Current work:

- [#7: built-package import and asset fixes](https://github.com/hyperdrive-technology/holodeck/issues/7), required for M1 package consumption ([core #34](https://github.com/hyperdrive-technology/core/issues/34)). A successful build alone does not yet establish that the package can be imported by a host.
- Review fixes: [#8](https://github.com/hyperdrive-technology/holodeck/issues/8), [#9](https://github.com/hyperdrive-technology/holodeck/issues/9), and [#10](https://github.com/hyperdrive-technology/holodeck/issues/10) cover scene validation, editor state reset, and pipe rerouting.
- [M2 — Holodeck standalone scene builder](https://github.com/hyperdrive-technology/holodeck/milestone/2) follows M1.

The CLI is incomplete and excluded from CI: its build entry is missing, its lockfile is empty, and it still expects a registry SDK dependency. Start with a React package.

## Quick start

Use **Node 26** (see [.node-version](.node-version)) and **pnpm 10.33.2**, matching CI. Packages install independently; the repository root is not a pnpm workspace and has no working aggregate build or test command.

Clone the SDK and Holodeck into sibling directories named `holodeck-sdk` and `holodeck`. The React packages use `file:../../../holodeck-sdk/ts`; build the SDK before installing a package because pnpm copies its built files at install time.

```sh
git clone https://github.com/hyperdrive-technology/holodeck-sdk.git
git clone https://github.com/hyperdrive-technology/holodeck.git
cd holodeck-sdk/ts
pnpm install --frozen-lockfile
pnpm build

cd ../../holodeck/packages/editor-2.5d-react
pnpm install --frozen-lockfile
pnpm type-check
HOLODECK_SKIP_RENDER_TESTS=1 pnpm exec vitest run
pnpm build
pnpm parts
```

`pnpm parts` opens the local equipment preview. The test command above matches CI's GPU-test exclusions. See [CONTRIBUTING.md](CONTRIBUTING.md) for browser render tests, other packages, and refreshing the SDK dependency after changes.

## Repository map

| Path | Purpose |
| --- | --- |
| [packages/editor-2.5d-react](packages/editor-2.5d-react) | `@holodeck/editor-2.5d-react`: orthographic process editor, routing, animation, and equipment assets |
| [packages/editor-2d-react](packages/editor-2d-react) | `@holodeck/editor-2d-react`: editable 2D diagrams using React Flow |
| [packages/viewer-3d-react](packages/viewer-3d-react) | `@holodeck/viewer-3d-react`: read-only 3D scenes using React Three Fiber |
| [packages/flow-runtime](packages/flow-runtime) | `@holodeck/flow-runtime`: flow block contract, cyclic dataflow runtime and the `holodeck.flow.local` provider (no React) |
| [packages/provider-http](packages/provider-http) | `@holodeck/provider-http`: the `holodeck.http` provider, live JSON over HTTP polling, SSE or WebSocket with pointer / JSONPath-lite sources and HTTP writes (no React) |
| [packages/cli](packages/cli) | `@holodeck/cli`: incomplete command-line tooling |
| [blender](blender/README.md) | Python scripts that build fixed-shape equipment as GLB models |
| [docs](docs) | Design notes and dated audits |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Per-package type checks, tests, and builds |

## Extensions and documentation

Extensions target `@holodeck/sdk`; open packages do not depend on commercial `@holodeck-pro/*` packages. Importers and providers live outside this repository, including [holodeck-importer-brainboard](https://github.com/hyperdrive-technology/holodeck-importer-brainboard). Future extension plans include Hyperdrive and Terraform adapters and commercial asset tiers.

- [Contributing and local checks](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)
- [Pipe routing](packages/editor-2.5d-react/docs/routing.md)
- [Blender model workflow and contract](blender/README.md)
- [Changelog](CHANGELOG.md)
- [MIT license](LICENSE)

To pick up work, browse [good first issues](https://github.com/hyperdrive-technology/holodeck/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22) or the [current issues](https://github.com/hyperdrive-technology/holodeck/issues).
