import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER, isTier, tierAllows, tierFromEnv } from './tiers';

describe('tiers', () => {
  it('are ordered read < author < exec', () => {
    expect(tierAllows('read', 'read')).toBe(true);
    expect(tierAllows('read', 'author')).toBe(false);
    expect(tierAllows('author', 'read')).toBe(true);
    expect(tierAllows('author', 'exec')).toBe(false);
    expect(tierAllows('exec', 'author')).toBe(true);
  });

  it('come from HOLODECK_MCP_TIER, defaulting to author; junk is an error, not a default', () => {
    expect(DEFAULT_TIER).toBe('author');
    expect(tierFromEnv({})).toBe('author');
    expect(tierFromEnv({ HOLODECK_MCP_TIER: ' read ' })).toBe('read');
    expect(tierFromEnv({ HOLODECK_MCP_TIER: '' })).toBe('author');
    expect(() => tierFromEnv({ HOLODECK_MCP_TIER: 'admin' })).toThrow(/read, author, exec/);
    expect(isTier('exec')).toBe(true);
    expect(isTier('EXEC')).toBe(false);
  });
});
