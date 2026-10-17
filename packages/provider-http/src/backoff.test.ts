import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

const cfg = { initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 };

describe('backoffDelay', () => {
  it('grows exponentially and caps', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, cfg))).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  it('treats attempts < 1 as the first', () => {
    expect(backoffDelay(0, cfg)).toBe(100);
    expect(backoffDelay(-3, cfg)).toBe(100);
  });

  it('spreads by ±jitter and never exceeds maxMs', () => {
    const j = { ...cfg, jitter: 0.5 };
    expect(backoffDelay(1, j, () => 0)).toBe(50);
    expect(backoffDelay(1, j, () => 1)).toBe(150);
    expect(backoffDelay(1, j, () => 0.5)).toBe(100);
    expect(backoffDelay(10, j, () => 1)).toBe(1000);
    // out-of-range random values are clamped
    expect(backoffDelay(1, j, () => 7)).toBe(150);
    expect(backoffDelay(1, j, () => -1)).toBe(50);
  });

  it('does not overflow for huge attempt counts', () => {
    expect(backoffDelay(1e9, { ...cfg, factor: 10 })).toBe(1000);
    expect(backoffDelay(Number.MAX_SAFE_INTEGER, cfg)).toBe(1000);
  });
});
