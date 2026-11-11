import { defineConfig } from 'vitest/config';

/** Every test file (assets/ holds colocated part tests: style tokens, apply-style). */
export const ALL_TESTS = ['src/**/*.{test,spec}.{ts,tsx}', 'assets/**/*.{test,spec}.{ts,tsx}'];

/**
 * Test files that drive headless Chromium + WebGPU (a Vite dev server and a browser per file).
 * Run in parallel they race for the GPU and time out at random (tank-tuner, scene-render,
 * parts-render), so vitest.workspace.ts runs them one at a time in their own `browser` project,
 * next to the `unit` project, whose plain-Node files run in parallel. Before this split the whole
 * package ran one file at a time (`fileParallelism: false`), so ~80 unit files waited behind the
 * render suites (dev-loop shift-left, 2026-11-11; timings in TESTING.md).
 *
 * A new browser-driving test must be named `*-render.test.ts` or added here; the guard in
 * src/test-support/browser-tests.test.ts fails on one that is neither.
 */
export const BROWSER_TESTS = ['**/*-render.test.ts', 'src/iso/tank-tuner.test.ts', 'src/test-support/render-harness.test.ts'];

/**
 * Shared by both projects in vitest.workspace.ts. No `include` here: a project that `extends`
 * this file would get its include list concatenated with this one (vitest merges arrays).
 */
export default defineConfig({
  // `vitest related` (dev-check fast) walks each test's import graph and transforms
  // `assets/models/*.glb?url` dependencies WITHOUT the `?url` query (vitest 1.6), so Vite tried
  // to parse the binary GLB as JS and the run failed with an unhandled error. Treating .glb as an
  // asset gives that walk a URL module; normal runs import with `?url` and are unaffected.
  assetsInclude: ['**/*.glb'],
  test: {
    environment: 'node',
    testTimeout: 60_000,
    // The browser project's pool (vitest.workspace.ts): one child process at a time. A root-level
    // pool limit; the unit project uses the threads pool and keeps its parallelism.
    poolOptions: { forks: { maxForks: 1, minForks: 1 } },
  },
});
