import { describe, expect, it } from 'vitest';
import { liveOverlayCopy } from './live-overlay';

describe('liveOverlayCopy', () => {
  it('renders Live · <selected target label>', () => {
    expect(
      liveOverlayCopy({
        state: 'live',
        targetId: 'inbound',
        targetLabel: 'inbound',
      }),
    ).toBe('Live · inbound');
  });

  it('keeps stale and disconnected on the same target label', () => {
    expect(
      liveOverlayCopy({
        state: 'stale',
        targetId: 'inbound',
        targetLabel: 'inbound',
      }),
    ).toBe('Stale values · inbound');
    expect(
      liveOverlayCopy({
        state: 'disconnected',
        targetId: 'inbound',
        targetLabel: 'inbound',
      }),
    ).toBe('Disconnected · inbound');
  });
});
