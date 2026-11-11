/**
 * CPU time for performance budgets in unit tests.
 *
 * Wall-clock budgets (`performance.now()`) failed whenever the machine was busy: the unit files
 * run in parallel (vitest.workspace.ts) and several agent sessions share the Mac, so a 10 ms
 * validation measured 50-180 ms at load average 40-60 while the code was waiting for a CPU, not
 * running. The calling thread's own CPU time (process.threadCpuUsage, Node >= 23.9; worker
 * threads included) only counts time spent running, so the budget measures the code. Still use
 * the fastest of a few runs: cache and memory-bandwidth contention inflate CPU time a little too.
 */

/** Milliseconds of CPU the current thread spent running `fn`, and its result. */
export function cpuTime<T>(fn: () => T): { ms: number; value: T } {
  const before = process.threadCpuUsage();
  const value = fn();
  const { user, system } = process.threadCpuUsage(before);
  return { ms: (user + system) / 1000, value };
}

/** The smallest CPU time of `runs` calls of `fn` (after one untimed warm-up call), and the last result. */
export function fastestCpuTime<T>(fn: () => T, runs = 3): { ms: number; value: T } {
  let value = fn();
  let ms = Infinity;
  for (let i = 0; i < runs; i += 1) {
    const r = cpuTime(fn);
    value = r.value;
    ms = Math.min(ms, r.ms);
  }
  return { ms, value };
}
