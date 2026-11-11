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
- `HOLODECK_SKIP_RENDER_TESTS=1` in `fast` (render tests are `push`+).
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

TIMINGS_PLACEHOLDER
