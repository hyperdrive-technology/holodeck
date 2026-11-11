import { defineWorkspace } from 'vitest/config';
import { ALL_TESTS, BROWSER_TESTS } from './vitest.config';

/**
 * Two projects, run at the same time by one `vitest run` (see BROWSER_TESTS in vitest.config.ts):
 *   unit     every plain-Node test file, in parallel (worker threads)
 *   browser  the files that drive Chromium + WebGPU, one at a time, each in a FRESH child process
 *            (the forks pool is capped at one in vitest.config.ts; vitest's default `isolate`
 *            starts a new child per file)
 * Not `singleFork: true`: that ran every browser file in ONE long-lived child, so what each file
 * leaves behind (Vite dev servers, Playwright connections, heap) piled up. On boat-large the
 * embed/editing-ux/follow render files went from 114 s (main) to 788 s and the test step hit its
 * 15-minute cap; on a Mac the child hit the 4 GB heap limit (2026-11-12). Fresh-process-per-file
 * is what main's `fileParallelism: false` gave. Checked with timestamped probe files: one at a
 * time, a new pid each. (`poolMatchGlobs` + `maxForks: 1` in a single project was ignored by
 * vitest 1.6 and ran everything in parallel threads, 2026-11-11.)
 */
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: { name: 'unit', include: ALL_TESTS, exclude: ['**/node_modules/**', ...BROWSER_TESTS], pool: 'threads' },
  },
  {
    extends: './vitest.config.ts',
    test: { name: 'browser', include: BROWSER_TESTS, exclude: ['**/node_modules/**'], pool: 'forks' },
  },
]);
