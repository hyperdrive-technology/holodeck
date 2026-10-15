/**
 * The one CI check shared by the fidelity gate (visual/fidelity.ts) and the
 * browser resolution (chromium.ts), so both agree on what "CI" means
 * (holodeck#79). Dependency-free: scripts/make-reference-canvas.mjs loads it
 * through chromium.ts with Node's built-in TypeScript type stripping.
 */

/**
 * True when running under CI. GitHub Actions (and most CI systems) set CI=true;
 * an empty value, "0" or "false" counts as not CI so a stray export can be undone.
 */
export function isCi(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const v = env.CI?.trim().toLowerCase();
  return !!v && v !== '0' && v !== 'false';
}
