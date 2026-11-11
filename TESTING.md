# Testing Holodeck

One entry point runs the checks a change needs, from the repo root:

```sh
scripts/dev-check.sh [fast|push|full] [--base <ref>] [--list] [--e2e]
```

`--list` prints the plan (which steps, and which changed file selected each) and runs nothing.
Install the pre-push hook once per clone with `scripts/install-hooks.sh`.

Workspace-wide policy (the ladder, the shift-left rules, when CI runs):
`~/dev/hyperdrive/AGENTS.md` "Dev loop & shift-left" and
`~/dev/hyperdrive/.agents/plans/dev-loop-shift-left.md`. This file has the Holodeck specifics.

## The ladder

| Tier | When | What `dev-check` runs here | Budget (warm, M1 Pro) |
|---|---|---|---|
| L0 edit | every save | `pnpm exec vitest run <file>` (or `vitest` watch) in the package | seconds |
| L1 `fast` | before every push (pre-push hook) | each package with a changed file: `pnpm type-check` + `vitest related` on the changed files, render tests skipped; `scripts/` changes run the scripts' `node --test` suites | ≤ 60 s |
| L2 `push` | before opening a PR or asking for review | every CI job the diff selects (`JOBS` in `scripts/ci-scope.mjs`: the touched packages **and the ones that read them**): install, type check, all tests incl. render tests | ≤ 5 min |
| L3 `full` | before merging a minor PR; before reviews on a major one | every phase of every CI job, whatever the diff (`ci-package.sh` and `ci-studio.sh` phases) + the Blender rebuild check when Blender is installed; `--e2e` adds the studio's Playwright e2e | see timings |
| L4 heavy CI | once, on the final reviewed head of a major PR | `.github/workflows/ci.yml` + `blender-drift.yml` on boat (`~/dev/hyperdrive/scripts/ci-run.sh`) | — |

Escalation (fail closed): a file outside every package that is not known-inert (`blender/`,
`examples/`, root config, a new directory) turns `fast` into `push`; a workflow, `.node-version`,
`.github/holodeck-sdk-ref`, a package's `package.json` / lockfile / tsconfig / vitest / vite /
tsup / playwright config, or the CI scripts themselves turn any mode into `full`. Docs and
top-level Markdown are inert. Nothing changed → `fast`/`push` exit at once; `full` always runs.

Every step prints its wall time and writes its output to `.dev-check/logs/<step>.log` (a
failing step's last 60 lines are printed). The last line is

```
dev-check: <mode> PASS|FAIL in <N>s — <step>=<passed tests or ok|FAIL|skip>; …
```

and `.dev-check/last.json` records the run for `~/dev/hyperdrive/scripts/ci-local-status.sh`
(which posts `ci/local` for a minor PR from a clean, current `full` run).

### Environment it sets

- `HOLODECK_CHROMIUM`: your `HOLODECK_CHROMIUM`, else `/Applications/Google Chrome.app`. Render
  tests, the Vite consumer check and e2e run in `push`/`full` when a Chrome is found; without one
  they are skipped and the run prints a `SKIPPED` note (CI still runs them). Playwright's own
  Chromium download is not needed.
- `HOLODECK_SKIP_RENDER_TESTS=1` in `fast` (render tests are `push`+). Set it yourself
  (`HOLODECK_SKIP_RENDER_TESTS=1 scripts/dev-check.sh full`) to skip every browser step on purpose,
  with a note: when the Mac's GPU is shared with other sessions' WebGPU e2e, render files hang at
  random (holodeck#300); the boat CI run still covers them.
- `HOLODECK_SKIP_BLENDER=1` for the package tests (CI's package jobs have no Blender either); the
  Blender rebuild runs once, in the `blender:*` steps, with `HOLODECK_REQUIRE_BLENDER=1`.
- `DEV_CHECK_JOBS=<n>`: steps run in parallel, default a third of the CPUs (min 2). Steps that
  drive a browser hold a `browser` lock (one at a time: parallel WebGPU suites race for the GPU),
  steps in one package hold that package's lock (no concurrent install/build).
- The SDK (`../holodeck-sdk/ts`, a `file:` dependency) is built first if its `dist/` is missing.

## One source of truth with CI

- Package gates: `scripts/ci-package.sh <pkg> [--only <phases> | --phases]`. CI runs all phases;
  `dev-check` runs the same phases (builds before tests in `full`, so the studio can start early).
- Studio + MCP server: `scripts/ci-studio.sh [--only <phases> | --phases | --deps]`, called
  phase by phase from `ci.yml` and from `dev-check`.
- Scope ("which paths affect which job"): `JOBS` in `scripts/ci-scope.mjs`. The workflows pass
  `--job <name>`; `dev-check push` asks the same `decide()`.
- Pins: `scripts/ci-scope.test.mjs` (every workflow scope step names a `JOBS` entry, cross-reads)
  and `scripts/dev-check.test.mjs` (targets = `ci.yml` legs + small packages, the scripts and
  Blender commands are the workflow's, every `ci-studio.sh` phase is used once by `ci.yml`, every
  `ci-package.sh` phase runs once in `full`).

## Where tests go and what they may cost

- Colocated `*.test.ts(x)` next to the code. Browser tests are `*-render.test.ts` (headless
  Chrome + WebGPU via `src/test-support/render-harness.ts`); a browser-driving file with another
  name must be listed in `BROWSER_TESTS` in `packages/editor-2.5d-react/vitest.config.ts`
  (`src/test-support/browser-tests.test.ts` fails otherwise).
- editor-2.5d-react runs two vitest projects at once (`vitest.workspace.ts`): `unit`, every
  plain-Node file in parallel worker threads, and `browser`, the browser files one at a time, each in a
  fresh child process (never `singleFork`: one long-lived child accumulated every file's leftovers
  and ran 7x slower; pinned by `src/test-support/browser-tests.test.ts`).
- Performance budgets in unit tests measure the thread's CPU time, fastest of a few runs
  (`src/test-support/cpu-time.ts`), never wall time: the files run in parallel and several agent
  sessions share the machine, so wall time measured the load, not the code.
- Budgets (shift-left rule 5): a unit test over 1 s, or a tier over its budget, gets faster,
  split, or moved one tier right with a reason. Fixed sleeps are bugs: wait on
  `data-render-state="ready"` (`waitForRendered` / `settle`), never `waitForTimeout`.
- Known over-budget tests, kept on purpose:
  - `flow-runtime` `quality.property.test.ts` (~4-6 s): 400 random graphs × 60 scans against a
    taint oracle. `FLOW_FUZZ_RUNS` / `FLOW_FUZZ_SEED` tune it locally.
  - The `*-render` suites (15-50 s per file): real interaction in a real browser; they are the
    reason `push` has a 5-minute budget and run on the `browser` lock.
- Shift-left rule 2 here: a failure first seen on CI that `dev-check` could have caught gets
  its check added to the lowest tier that shows it, named in the PR body.

## Timings

Measured 2026-11-11/12. Mac = M1 Pro, 10 cores, 16 GB, shared with other agent sessions (load
varied 4-150; numbers are from quiet moments). boat = boat-large (8 vCPU), the size CI's legs
can use.

### Before → after, whole-repo gates

| What | Before (main 52db468) | After (this branch) |
|---|---|---|
| Every CI command, one after another, boat-large | 718 s (sum; editor-2.5d-react 526 s of it) | `dev-check full`: 681 s wall (a5236ae; editor-2.5d-react test 548 s) |
| Local whole-repo check on the Mac | none (per-package by hand) | `HOLODECK_SKIP_RENDER_TESTS=1 dev-check full`: **62 s** (7d3caa7, every non-browser CI step incl. Blender rebuild) |
| provider-http tests | 39 s (`secrets.property` 36 s) | 5.6 s (cases run concurrently per secret) |
| mcp package gate | 60 s (incl. real-studio render) | 22 s on boat |
| editor-2.5d-react unit files (81) | one at a time, behind the render suites | parallel threads, ~45 s with build on the Mac |

The editor-2.5d-react render suites are the critical path everywhere. They run one file at a time,
each in a fresh child process. That is main's isolation; the branch's interim `singleFork`
regressed it, see below. holds-render's 52 independent cases run 4 at a time on a Mac and 2 at a
time on Linux (340 s → 50-80 s on a Mac).

### Sample diffs (Mac, warm, `--base HEAD` + one edited file)

| Diff | `fast` | `push` | `full` |
|---|---|---|---|
| leaf: `packages/editor-2d-react/src/utils.ts` | 3 s (type check + 15 related tests) | 4 s (26 tests) | = `full` |
| shared: `packages/library-cloud/src/themes.ts` | 2 s (6 related tests) | selects editor-2.5d-react, the small packages, studio, mcp, Blender (≈ `full`) | 62 s without browser |
| editor source: `packages/editor-2.5d-react/src/iso/pose.ts` | 9 s (211 related tests) | editor-2.5d-react incl. render tests | |
| config: `packages/viewer-3d-react/vitest.config.ts` | escalates to `full` | escalates to `full` | 62 s without browser |

### Slowest test files (main, boat-large, 2026-11-11)

| File | Time |
|---|---|
| editor-2.5d-react `src/editor/holds-render.test.ts` (52 cases) | 219 s |
| editor-2.5d-react `src/editor/pipe-cutaway-render.test.ts` | 72 s |
| editor-2.5d-react `src/export/export-render.test.ts` | 64 s |
| editor-2.5d-react `src/editor/editing-ux-render.test.ts` | 44 s (Mac, quiet: 24 s) |
| editor-2.5d-react `src/editor/embed-render.test.ts` | 43 s |
| provider-http `src/secrets.property.test.ts` | 36 s (now ~1.5 s) |
| editor-2.5d-react `src/editor/follow-render.test.ts` | 27 s |
| editor-2.5d-react `src/objects/objects-render.test.ts` | 22 s |
| editor-2.5d-react `src/registry/registry-render.test.ts` | 19 s |
| editor-2.5d-react `src/editor/pan-render.test.ts` | 16 s |
| editor-2.5d-react `src/iso/vessels-render.test.ts` | 14 s |
| editor-2.5d-react `src/editor/routing-brewhouse-render.test.ts` | 8 s |
| editor-2.5d-react `src/iso/scene-render.test.ts` | 7 s |
| flow-runtime `src/quality.property.test.ts` | 5 s |
| editor-2.5d-react `src/iso/tank-tuner.test.ts` | 5 s |
| editor-2.5d-react `src/editor/routing-render.test.ts` | 5 s |
| editor-2.5d-react `src/editor/editor-render.test.ts` | 4 s |
| provider-http `src/provider.poll.test.ts` | 4 s |
| editor-2.5d-react `src/iso/parts-render.test.ts` | 3 s |
| editor-2.5d-react `src/test-support/render-harness.test.ts` | 2 s |

Every other test file is under 1 s.

### Lessons (keep them from coming back)

- `singleFork: true` for the browser project ran every render file in one long-lived child. Their
  leftovers piled up: embed/editing-ux/follow-render took 788 s on boat-large (114 s on main)
  and the child hit the 4 GB heap limit on a Mac. Pinned by `src/test-support/browser-tests.test.ts`.
- Render tests on a Mac hang at random while other sessions run WebGPU e2e on the same GPU
  (holodeck#300). `HOLODECK_SKIP_RENDER_TESTS=1 dev-check full` still covers everything else;
  the boat CI run covers the browser steps.
- On the Mac, a `timeout <n> pnpm exec vitest run` with a hung render file was seen running past
  its cap (twice, 2026-11-11); whether pnpm passes the signal to vitest's children is unverified.
  The CI job timeout is the backstop (holodeck#301).
