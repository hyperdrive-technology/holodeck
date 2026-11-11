import { defineWorkspace } from 'vitest/config';
import { ALL_TESTS, BROWSER_TESTS } from './vitest.config';

/**
 * Two projects, run at the same time by one `vitest run` (see BROWSER_TESTS in vitest.config.ts):
 *   unit     every plain-Node test file, in parallel (worker threads)
 *   browser  the files that drive Chromium + WebGPU, one at a time in a single child process
 * (`poolMatchGlobs` + `maxForks: 1` looked like the same thing but vitest 1.6 ignored it and ran
 * everything in parallel threads; checked with timestamped probe tests, 2026-11-11.)
 */
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: { name: 'unit', include: ALL_TESTS, exclude: ['**/node_modules/**', ...BROWSER_TESTS], pool: 'threads' },
  },
  {
    extends: './vitest.config.ts',
    test: { name: 'browser', include: BROWSER_TESTS, exclude: ['**/node_modules/**'], pool: 'forks', poolOptions: { forks: { singleFork: true } } },
  },
]);
