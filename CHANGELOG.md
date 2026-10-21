# Changelog

All notable changes to Holodeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`@holodeck/flow-runtime`**: `holodeck.flow.block` contract (`FlowBlockDefinition`), `holodeck.flow.graph.v1` validation, cyclic dataflow compiler and scheduler, built-in `flow.const` / `flow.delay` / `signal.in` / `signal.out` blocks, and the `holodeck.flow.local` deploy provider with hub signal bridges. Output quality propagates under a stated safety contract (worst of this scan's inputs, `bad` on fault or substitute; delays outside loops carry quality; every node on a feedback loop shares the loop's per-scan health, so loop state survives a bad scan but nothing read from the loop is good until its outside inputs are), checked by a property test against a taint oracle, and `signal.out` writes only good, non-null values, holding otherwise (#44)
- **`@holodeck/editor-2.5d-react`**: deterministic rendered signal (holodeck#34). `ProcessEditor` and `IsoCanvas` expose `data-holodeck-revision`, `data-holodeck-rendered` and `data-render-state` (`pending` / `ready` / `unsupported`) plus an `onRendered(revision)` callback, fired after a presented frame shows the current revision with every GLB part loaded, no camera animation running and (editor) the scene fitted.

- **`@holodeck/editor-2.5d-react`**: measured Arcentry fidelity test (holodeck#32). `scene-render.test.ts` scores the reference render against `reference-canvas.png` (pixelmatch over the drawn area, plus RMSE and a per-region breakdown), writes a heatmap, diff, overlay and `reference-metrics.json` to `artifacts/visual/`, and fails when the score drops below the ratchet in `tests/visual/reference-fidelity.json`. `pnpm visual`, `pnpm visual:record`, `pnpm visual:reference`; agent loop documented in the package README.

### Fixed

- **`@holodeck/editor-2.5d-react`**: pipe reroute follow-ups. Carried inline parts land on whole grid nodes (half cells when nothing else fits), so a branch drawn to one connects and pins it on the next reroute (holodeck#53); clearance and spacing use each part's own along-pipe body length, from the new optional `IsoPartDefinition.inlineLength` or the footprint's longer side (holodeck#54); carried parts keep their yaw relative to travel, so directional parts are never reversed (holodeck#57); coincident declared ports resolve to the original pipe's side via `resolveRouteEnd(..., { prefer })` (holodeck#47); occupancy rejects run endpoints a fraction past the scene limit instead of validating rounded bounds (holodeck#56).
- **`@holodeck/editor-2.5d-react`**: data-only part logos honour the GLB `logo` empty's rotation (local +Y = face normal, local −Z = image top), lifted along that normal, so `cloud:billboard`'s logo stands on the sign's front face instead of cutting through the panel. `LogoAnchor` gains optional `quaternion` and `normal` (omitted = a flat top-face slot, so host-built anchors for `LogoPlane` keep type-checking, holodeck#142); `logoPlaneQuaternion` builds the plane rotation (holodeck#138).
- **`@holodeck/editor-2.5d-react`**: connectors at the 64-waypoint limit show no "+" insert handles, and pressing one can no longer grab an existing waypoint; the reducer explains the limit (holodeck#126).
- **`@holodeck/editor-2.5d-react`**: late image aspects refit only the editor whose scene held that image at its last fit, and only while the user has not moved the view; the bounded aspect cache never evicts an image that is still mounted (ref-counted). `imageAspectVersion` is replaced by `imageAspectsKey` / `sceneImageSrcs` / `retainImageAspect` (holodeck#127, #132).
- **`@holodeck/editor-2.5d-react` / Studio**: disarming a host-armed Pipe (`placing` back to null, or clicking the library item again) leaves draw-pipe mode; Escape out of a host-armed pipe is reported through `onPlacingChange(null)` (holodeck#133).
- **Studio**: a document opens only after the camera has been re-read since mount, so a cached camera older than another tab's save is never restored (holodeck#134).
- **`@holodeck/editor-2.5d-react`**: the toolbar "N items" label now meets WCAG AA (was `#888` on `#fafafa`, 3.4:1; now the `BAR_MUTED` token, 5.5:1) (holodeck#72). All editor chrome colours are tokens in `editor-styles.ts`, and `editor-styles.test.ts` asserts every text/background pair is >= 4.5:1.
- **`@holodeck/editor-2.5d-react`**: `ProcessEditor` no longer grows past the box its host gives it (palette / inspector / canvas content no longer sets its intrinsic height), so the scene is fitted to the visible pane in any embedding (core#69). Palette section headings are 12 px.
- **`@holodeck/editor-2.5d-react`**: render tests no longer rewrite tracked files: `reference-canvas.png` is generated once by a script (no ImageMagick), `auto-route.png` is untracked and written to `artifacts/render/`, label boxes go to `artifacts/visual/` instead of `/tmp`.
- **`@holodeck/editor-2.5d-react`**: render (`*-render`) tests run in CI on the runner's preinstalled Google Chrome with SwiftShader WebGPU (`HOLODECK_CHROMIUM`, one launch path `launchRenderBrowser()`), wait on the rendered signal instead of fixed sleeps (`waitForRendered(page | locator)`, `settle`), need no ImageMagick, and upload `artifacts/` from CI.

## [0.1.0] - 2026-09-22

First tagged Holodeck monorepo release (formerly Starfleet).

### Added

- **`@holodeck/viewer-3d-react`**: R3F `HolodeckViewer3D` with primitives, orbit/pick, animation runner, ISA-101 default materials
- **`@holodeck/editor-2d-react`**: 2D scene editor package (renamed from viewer-2d)
- CLI package scripts and basic usage example
- README and ROADMAP

### Changed

- Rebranded packages and CLI from Starfleet → Holodeck (`@holodeck/*`, `holodeck` bin)

### Removed

- `@starfleet/viewer-2d-react` package name (replaced by `@holodeck/editor-2d-react`)

[Unreleased]: https://github.com/hyperdrive-technology/holodeck/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/hyperdrive-technology/holodeck/releases/tag/v0.1.0
