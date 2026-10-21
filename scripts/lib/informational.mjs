/**
 * Runs a check whose outcome is informational only: it may report, but it
 * must never fail the script that runs it (holodeck#48: the "no optimizeDeps"
 * repro in vite-consumer-check.mjs threw on a module-load timeout and exited
 * non-zero even though both required checks passed).
 *
 *   const r = await runInformational('dev (no exclude)', () => runDev(...));
 *   if (r.ok) use(r.value);
 *
 * A throw (or rejection) becomes a warning on `warn` and `{ ok: false, error }`.
 */
export async function runInformational(label, fn, { warn = console.warn } = {}) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`WARNING: ${label} (informational, not a failure) could not run: ${message}`);
    return { ok: false, error };
  }
}
