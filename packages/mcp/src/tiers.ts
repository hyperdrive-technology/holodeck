/**
 * Permission tiers. Each tool declares the lowest tier that may run it; the
 * server's tier comes from `HOLODECK_MCP_TIER` (default `author`).
 *
 *   read    library and scene inspection; nothing is written
 *   author  also creates and edits `.holodeck.json` documents under the workspace root
 *   exec    reserved for tools that run local programs (Blender part builds, a later
 *           group). No tool needs it yet; those tools will also require
 *           HOLODECK_MCP_ALLOW_BLENDER=1.
 *
 * A tool above the server's tier stays listed (so an agent can see what
 * exists) but refuses with a message that names the tier it needs.
 */

export const TIERS = ['read', 'author', 'exec'] as const;
export type Tier = (typeof TIERS)[number];

export const DEFAULT_TIER: Tier = 'author';

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/** Does a server at `server` allow a tool that needs `needed`? */
export function tierAllows(server: Tier, needed: Tier): boolean {
  return TIERS.indexOf(server) >= TIERS.indexOf(needed);
}

/** The tier from the environment; an unknown value is an error, not a silent default. */
export function tierFromEnv(env: NodeJS.ProcessEnv): Tier {
  const raw = env.HOLODECK_MCP_TIER?.trim();
  if (raw === undefined || raw === '') return DEFAULT_TIER;
  if (!isTier(raw)) throw new Error(`HOLODECK_MCP_TIER must be one of ${TIERS.join(', ')}; got ${JSON.stringify(raw)}`);
  return raw;
}
