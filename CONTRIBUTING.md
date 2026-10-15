# Contributing to Holodeck

Start with the [organization contribution guide](https://github.com/hyperdrive-technology/.github/blob/main/CONTRIBUTING.md) for issue selection, labels, pull requests, and review. Human and agent contributions use the same process: CI must pass, and both `claude-review` and `gpt-review/sol-6.1` statuses must pass on the PR head before a squash merge. Include `Closes #N` in the PR body, regression tests for bug fixes, tests for new behavior, and before/after screenshots for UI changes.

## Local setup

Use Node 26 and pnpm 10.33.2, as in [CI](.github/workflows/ci.yml). Follow the [README quick start](README.md#quick-start) to clone sibling `holodeck-sdk` and `holodeck` directories and build `holodeck-sdk/ts` first. Each React package has its own manifest and pnpm lockfile. Run commands inside the package you are changing.

After SDK changes, rebuild `holodeck-sdk/ts`, then run `pnpm install` in each affected React package to refresh the copied `file:` dependency. Check the resulting lockfile changes into the same PR when needed. For a clean checkout without dependency changes, use `pnpm install --frozen-lockfile`.

CI chooses the SDK branch matching the Holodeck branch, then the ref in [.github/holodeck-sdk-ref](.github/holodeck-sdk-ref), then `main`, using the first branch that exists. Use the corresponding SDK ref locally when working on paired changes.

## Checks by area

From the Holodeck repository root, choose one of these package directories:

| Area | Working directory | Test locations |
| --- | --- | --- |
| 2.5D editor, routing, animation, models | `packages/editor-2.5d-react` | Colocated `*.test.ts` / `*.test.tsx` under `src/` and `assets/`; browser fixtures and screenshots under `tests/` |
| 2D editor and extension registry | `packages/editor-2d-react` | Colocated `src/**/*.test.ts` / `*.test.tsx`; jsdom setup in `vitest.setup.ts` |
| 3D viewer | `packages/viewer-3d-react` | Colocated tests under `src/`, including `HolodeckViewer3D.test.tsx` |
| Flow blocks, runtime, `holodeck.flow.local` | `packages/flow-runtime` | Colocated `src/**/*.test.ts` (Node, no browser); `pnpm smoke` after `pnpm build` |
| Blender parts | `blender/parts` and 2.5D assets | GLB contract tests under `packages/editor-2.5d-react/src/models/` |

For each affected React package, run this sequence from its directory:

```sh
pnpm install --frozen-lockfile
pnpm type-check
HOLODECK_SKIP_RENDER_TESTS=1 pnpm exec vitest run
pnpm build
```

The [CI workflow](.github/workflows/ci.yml) runs these checks separately for the three React packages and `flow-runtime` on pull requests and pushes to `main`, after installing and building the SDK. It sets `HOLODECK_SKIP_RENDER_TESTS=1` because hosted runners lack the GPU/WebGPU environment required by the render tests. CI does not run package lint scripts, Storybook, or a built-package import smoke test; built-package import and asset coverage is tracked in [#7](https://github.com/hyperdrive-technology/holodeck/issues/7).

The root manifest is a legacy CLI scaffold, not an aggregate runner. `packages/cli` is also excluded from CI: its `src/index.ts` build entry is absent, its `package-lock.json` contains no resolved dependencies, and its SDK dependency targets the registry. Restoring the CLI requires its own setup and verification; its advertised commands are not the supported onboarding path.

## Browser and model checks

For 2.5D visual changes, run render tests locally with a GPU and a Chromium build that supports headless WebGPU. From `packages/editor-2.5d-react`, install Playwright's Chromium if needed:

```sh
pnpm exec playwright install chromium
pnpm exec vitest run
```

Leave `HOLODECK_SKIP_RENDER_TESTS` unset to enable rendering. You can point `HOLODECK_CHROMIUM` at a browser executable explicitly. The [Chromium helper](packages/editor-2.5d-react/src/test-support/chromium.ts) skips render suites when no browser is found or when `CI` is set without an explicit browser path. Check the skipped-test output when reporting results.

Useful focused checks and previews, also from `packages/editor-2.5d-react`:

```sh
pnpm exec vitest run src/routing
pnpm exec vitest run src/editor/editor-state.test.ts
pnpm exec vitest run src/models
pnpm parts
pnpm tuner
```

For model changes, follow the [Blender guide](blender/README.md). `pnpm parts:build` and `pnpm parts:watch` invoke the checked-in build script; Blender is found through `BLENDER`, the macOS application path, or `PATH`. Model rebuild checks skip without Blender. Include both the model contract checks and render checks when reporting a model change.

## Choosing work

Prioritize [M1 — Brewery on WASM](https://github.com/hyperdrive-technology/holodeck/milestone/1), especially built-package imports and asset delivery. The demo's M1 execution path must use the real Rust WASM runtime; interpreter and mock execution paths do not meet that milestone. [M2 — Holodeck standalone scene builder](https://github.com/hyperdrive-technology/holodeck/milestone/2) follows it.

Use [open issues](https://github.com/hyperdrive-technology/holodeck/issues) for current work and [ROADMAP.md](ROADMAP.md) for direction. Coordinate SDK contract changes through [holodeck-sdk](https://github.com/hyperdrive-technology/holodeck-sdk), and runtime or host changes through [core](https://github.com/hyperdrive-technology/core).
