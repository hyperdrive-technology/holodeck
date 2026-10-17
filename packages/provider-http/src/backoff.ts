import type { BackoffConfig } from './config';

/**
 * Delay before retry number `attempt` (1 = first retry): exponential growth
 * from `initialMs`, capped at `maxMs`, spread by ±`jitter` so many clients
 * that lost the same server do not reconnect in lockstep.
 */
export function backoffDelay(attempt: number, config: BackoffConfig, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  // Cap the exponent so factor ** n cannot overflow to Infinity.
  const base = Math.min(config.maxMs, config.initialMs * config.factor ** Math.min(n - 1, 64));
  const r = Math.min(1, Math.max(0, random()));
  const spread = 1 - config.jitter + 2 * config.jitter * r;
  return Math.round(Math.min(config.maxMs, Math.max(0, base * spread)));
}
