# Changelog

All notable changes to Holodeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`@holodeck/editor-2.5d-react`**: deterministic rendered signal (holodeck#34). `ProcessEditor` and `IsoCanvas` expose `data-holodeck-revision`, `data-holodeck-rendered` and `data-render-state` (`pending` / `ready` / `unsupported`) plus an `onRendered(revision)` callback, fired after a presented frame shows the current revision with every GLB part loaded, no camera animation running and (editor) the scene fitted.

- **`@holodeck/editor-2.5d-react`**: measured Arcentry fidelity test (holodeck#32). `scene-render.test.ts` scores the reference render against `reference-canvas.png` (pixelmatch over the drawn area, plus RMSE and a per-region breakdown), writes a heatmap, diff, overlay and `reference-metrics.json` to `artifacts/visual/`, and fails when the score drops below the ratchet in `tests/visual/reference-fidelity.json`. `pnpm visual`, `pnpm visual:record`, `pnpm visual:reference`; agent loop documented in the package README.

### Fixed

- **`@holodeck/editor-2.5d-react`**: `ProcessEditor` no longer grows past the box its host gives it (palette / inspector / canvas content no longer sets its intrinsic height), so the scene is fitted to the visible pane in any embedding (core#69). Palette section headings are 12 px.
- **`@holodeck/editor-2.5d-react`**: render tests no longer rewrite tracked files: `reference-canvas.png` is generated once by a script (no ImageMagick), `auto-route.png` is untracked and written to `artifacts/render/`, label boxes go to `artifacts/visual/` instead of `/tmp`.

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
